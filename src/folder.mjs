// A cortex kept as a folder. The files are the cortex: what a person reads and edits by hand is
// what an agent is given, and nothing here holds a second copy.
//
//   agents/  identity.md  vault.md  memory/  skills/  tools/      what is in force
//   .cortex/                                                       the journal, what was replaced, and machinery
//
// Agents edit directly, and every edit is a change line in the journal that says who made it: the
// person, or an agent by name. The person reads an agent's changes in history and reverts what
// they do not want. What needs trust is the person's alone: an identity fact is proposed with
// evidence and set only when the person confirms it, a skill is used only once the person approves
// it, and a tool is only ever asked for: the person adds it and switches it on.
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { checkField, checkSource, FIELDS, forAgent, IDENTITY, proposalForAgent, readIdentity, shownValue, statesValue, writeIdentity } from './identity.mjs';
import { vaultFrom } from './vault.mjs';
import { checkWords, gone, parseMap, writeMap } from './vaultmap.mjs';
import { actorOf, openJournal, order, PEOPLE } from './journal.mjs';
import { cleanMemory, cortexVersion, evidenceProblem, InvalidMemory, KINDS, memoryFile, memoryVersion, NAME, readMemoryFile, Refused, splitFront, writeFront } from './core.mjs';

const bytes = text => new TextEncoder().encode(text).length;
const missing = problem => problem?.code === 'ENOENT' || problem?.code === 'ENOTDIR';
const text = path => readFile(path, 'utf8').catch(problem => { if (missing(problem)) return null; throw problem; });
const names = path => readdir(path, { withFileTypes: true }).catch(problem => { if (missing(problem)) return []; throw problem; });
const changed = (what, current) => new Refused('Changed', `The ${what} has changed since the version this request names. Read it again.`, { current });
const known = (name, what = 'memory') => {
  if (typeof name !== 'string' || name.length > 100 || !NAME.test(name)) throw new Refused('InvalidRequest', `Say which ${what} with its lowercase, hyphenated name`);
  return name;
};
const oneLine = (value, max = 500) => typeof value === 'string' && value.trim() && [...value].length <= max && !/[\r\n]/.test(value);

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, content);
  await rename(partial, path);
}

// What makes a note a note. Checked before anything is written, so a batch is refused whole.
function checkNote({ id, note, session, project, evidence } = {}) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Refused('InvalidRequest', 'A note has an ID made where it was seen, at most 200 characters');
  if (typeof note !== 'string' || !note.trim() || [...note].length > 500 || /[\r\n]/.test(note)) throw new Refused('InvalidRequest', `A note is one line, at most 500 characters${typeof id === 'string' ? ` (${id})` : ''}`);
  if (typeof session !== 'string' || !session || session.length > 200) throw new Refused('InvalidRequest', 'A note names the session it was seen in');
  if (project !== undefined && (typeof project !== 'string' || project.length > 2000)) throw new Refused('InvalidRequest', 'project is text, at most 2,000 characters');
  if (evidence !== undefined && evidenceProblem(evidence)) throw new Refused('InvalidRequest', evidenceProblem(evidence));
}
const checkReason = reason => {
  if (reason !== undefined && !oneLine(reason)) throw new Refused('InvalidRequest', 'reason is one line, at most 500 characters');
  return reason?.trim();
};

// Names that mean the person, or the signed-in account. An agent never writes under one of them.
export const RESERVED = PEOPLE;
export const agentName = given => {
  const name = typeof given === 'string' && given.trim() ? given.trim().slice(0, 100) : 'agent';
  return RESERVED.includes(name.toLowerCase()) ? `agent:${name}` : name;
};

// Hooks keep their own checkpoints (a session's start, an ask, a distill) to know when to ask for a
// distill. They are bookkeeping for this machine, not history, so they are not in the journal.
export const hooksLog = dir => join(dir, '.cortex', 'hooks.jsonl');

// A new cortex is a copy of the template. An existing one is never written over.
export async function initCortex(dir, template, { account } = {}) {
  // Checked before anything is copied, so a refusal leaves the folder as it was.
  const checked = account === undefined ? undefined : checkField('account', account);
  if ((await names(dir)).some(entry => !entry.name.startsWith('.'))) throw new Refused('NameTaken', `${dir} already holds files. A cortex is started in an empty folder.`);
  await cp(template, dir, { recursive: true, filter: source => !source.endsWith('.gitkeep') });
  for (const folder of ['agents/secrets', 'memory', 'skills', 'tools', '.cortex']) await mkdir(join(dir, folder), { recursive: true });
  const cortex = openCortex(dir, { actor: 'account' });
  if (checked !== undefined) await cortex.setAccount(checked);
  await cortex.reindex();
  return { dir };
}

// `vault`, when given, is the vault this cortex reads; otherwise it is the one .cortex/vault.json names.
export function openCortex(dir, { actor = 'member', now = () => new Date(), vault: givenVault } = {}) {
  const at = (...parts) => join(dir, ...parts);
  const journal = openJournal(dir, { now });
  const person = actorOf(actor).kind === 'human';
  const memoryPath = name => at('memory', `${name}.md`);

  // Every replaced or removed file is kept, named by when it was replaced and the version it was.
  async function keep(kind, name, content, version) {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    await put(at('.cortex', 'history', kind, name, `${stamp}_${version}.md`), content);
  }
  const fileVersion = content => cortexVersion({ file: content });
  const earlier = async (kind, name) => (await names(at('.cortex', 'history', kind, name)))
    .filter(entry => entry.isFile()).map(entry => entry.name).filter(file => file.endsWith('.md')).sort().reverse()
    .map(file => ({ file, version: file.slice(file.indexOf('_') + 1, -3), replacedAt: file.slice(0, file.indexOf('_')) }));

  async function held(name) {
    const content = await text(memoryPath(name));
    if (content === null) return null;
    let memory;
    try { memory = readMemoryFile(content); } catch (problem) {
      if (problem instanceof InvalidMemory) throw new Refused('Unreadable', `memory/${name}.md cannot be read as a memory: ${problem.message}`);
      throw problem;
    }
    if (memory.name !== name) throw new Refused('Unreadable', `memory/${name}.md says its name is ${memory.name}. The file name and the name must agree.`);
    return { memory, version: await memoryVersion(memory), content };
  }

  async function all() {
    const memories = [];
    const problems = [];
    for (const entry of await names(at('memory'))) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue;
      try {
        const { memory, version } = await held(known(entry.name.slice(0, -3)));
        memories.push({ memory, version });
      } catch (problem) {
        // A file that cannot be opened is reported, not thrown, so a session or status still answers.
        if (!(problem instanceof Refused) && problem?.code) { problems.push(`memory/${entry.name} cannot be read: ${problem.code}`); continue; }
        if (!(problem instanceof Refused)) throw problem;
        problems.push(`memory/${entry.name}: ${problem.message}`);
      }
    }
    memories.sort((a, b) => a.memory.name.localeCompare(b.memory.name));
    return { memories, problems };
  }

  async function reindex() {
    const { memories } = await all();
    const lines = memories.map(({ memory }) => `- [${memory.name}](${memory.name}.md) — ${memory.description}`);
    await put(at('memory', 'MEMORY.md'), `<!-- Generated from each memory's description. Do not edit. -->\n${lines.join('\n')}${lines.length ? '\n' : ''}`);
  }

  // Observations and host events are note lines in the journal, and what became of each is a
  // settled line. A cortex made before the journal kept them in .cortex/notes.jsonl: that file is
  // still read, first, and never written.
  const oldNotes = at('.cortex', 'notes.jsonl');
  async function notes() {
    const found = new Map();
    for (const line of ((await text(oldNotes)) ?? '').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === 'note') found.set(entry.id, { id: entry.id, text: entry.text, session: entry.session, ...(entry.project ? { project: entry.project } : {}), source: entry.source, writtenBy: entry.writtenBy, when: entry.when });
      else if (entry.type === 'settled' && found.has(entry.id)) Object.assign(found.get(entry.id), { outcome: entry.outcome, settledAt: entry.when });
    }
    for (const entry of await journal.read()) {
      // Two machines may both hold a note after a merge. The first one stands.
      if (entry.type === 'note' && typeof entry.note === 'string' && !found.has(entry.note)) {
        found.set(entry.note, { id: entry.note, text: entry.text, session: entry.session, ...(entry.project ? { project: entry.project } : {}), source: entry.source, writtenBy: entry.actor?.name, when: entry.at, ...(entry.evidence ? { evidence: entry.evidence } : {}) });
      } else if (entry.type === 'settled' && typeof entry.note === 'string' && found.has(entry.note)) {
        Object.assign(found.get(entry.note), { outcome: entry.outcome, settledAt: entry.at });
      }
    }
    return found;
  }
  const recordNote = ({ id, text: said, session, project, source, evidence }) =>
    journal.append(actor, 'note', { note: id, text: said, ...(project ? { project } : {}), source, ...(evidence ? { evidence } : {}) }, { session });

  async function folderOf(root) {
    const files = [];
    async function walk(relative) {
      for (const entry of await names(join(root, relative))) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && path !== 'SKILL.md') files.push({ path, text: await readFile(join(root, path), 'utf8') });
      }
    }
    await walk('');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  async function skillAt(root) {
    const content = await text(join(root, 'SKILL.md'));
    if (content === null) return null;
    const skill = { text: content, files: await folderOf(root) };
    const { name, description } = splitFront(content).properties;
    return { name, description, skill, version: await cortexVersion(skill) };
  }
  async function listed(root, read) {
    const found = [];
    for (const entry of await names(root)) {
      const item = await read(entry);
      if (item) found.push(item);
    }
    return found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  const skillsIn = root => listed(root, async entry => {
    if (!entry.isDirectory()) return null;
    const found = await skillAt(join(root, entry.name));
    return found && { name: entry.name, description: String(found.description ?? ''), version: found.version };
  });
  const toolsIn = root => listed(root, async entry => {
    if (!entry.isFile() || !entry.name.endsWith('.md')) return null;
    const { properties } = splitFront(await readFile(join(root, entry.name), 'utf8'));
    return { name: entry.name.slice(0, -3), description: String(properties.description ?? ''), on: properties.on === true };
  });

  // The vault this cortex reads, if one is connected. Read through the contract only.
  let openedVault;
  async function theVault() {
    if (givenVault) return givenVault;
    if (openedVault !== undefined) return openedVault;
    const config = await text(at('.cortex', 'vault.json'));
    let parsed = null;
    if (config) {
      try { parsed = JSON.parse(config); } catch { throw new Refused('InvalidVault', '.cortex/vault.json cannot be read. Connect the vault again with cortex vault connect'); }
    }
    openedVault = parsed ? vaultFrom(parsed) : null;
    return openedVault;
  }
  const short = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  // Which words in vault.md an agent wrote, so the person's own words are never written over.
  const meaningsLog = at('.cortex', 'vault-meanings.jsonl');
  async function agentWords() {
    const last = new Map();
    for (const line of ((await text(meaningsLog)) ?? '').split('\n')) {
      if (!line.trim()) continue;
      // Lines from before channels name the channel `section`.
      try { const entry = JSON.parse(line); last.set(`${entry.channel ?? entry.section}\u0000${entry.field}`, entry.text); } catch {}
    }
    return last;
  }

  const identityLog = at('.cortex', 'identity.jsonl');
  const factKey = (field, value) => JSON.stringify([field, value ?? null]);
  const recordIdentity = async entry => {
    await mkdir(dirname(identityLog), { recursive: true });
    await appendFile(identityLog, `${JSON.stringify({ ...entry, by: actor, when: now().toISOString() })}\n`);
  };
  async function waitingFor(ref) {
    const waiting = await cortex.identityProposals();
    const named = (await cortex.identityLog()).find(entry => entry.type === 'proposed' && entry.id === ref);
    const byId = named && waiting.find(proposal => factKey(proposal.field, proposal.value) === factKey(named.field, named.value));
    if (byId) return byId;
    const forField = waiting.filter(proposal => proposal.field === ref);
    if (forField.length === 1) return forField[0];
    if (forField.length > 1) throw new Refused('Ambiguous', `More than one proposal is waiting for ${ref}. Name one by its ID: ${forField.map(proposal => `${proposal.id} (${JSON.stringify(proposal.value)})`).join(', ')}`);
    throw new Refused('NotFound', `No identity proposal is waiting for ${ref}`);
  }

  // Working memory: one file for each agent, named for it, so two agents never write over each other.
  const fileName = agent => String(agent).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'agent';
  const workingPath = agent => at('.cortex', 'working', `${fileName(agent)}.md`);
  async function workingOf(agent) {
    const content = await text(workingPath(agent));
    if (content === null) return null;
    const { mtime } = await stat(workingPath(agent));
    return { agent: fileName(agent), text: content, version: await cortexVersion({ working: content }), updated: mtime.toISOString() };
  }

  // Nodes. Every file of the cortex is a node, named the same way in every change line:
  //   identity          identity.md
  //   playbook          agents/AGENTS.md
  //   memory/<name>     memory/<name>.md
  //   working/<agent>   .cortex/working/<agent>.md
  //   skill/<name>      skills/<name>/, SKILL.md and the files beside it
  //   tool/<name>       tools/<name>.md
  //   channel/<path>    what vault.md says a channel means and how blocks there are filed
  // Each knows how to read itself now, write and remove itself, the version of a content, and where
  // its earlier versions are kept. An agent never writes a personOnly node, not even to restore it:
  // identity is confirmed fact by fact, the playbook is the person's, a skill is used only once
  // approved, and an earlier version of a tool could switch it on.
  const SLUG = '[a-z]+(?:-[a-z]+)*';
  const fileNode = (node, path, kept, extra = {}) => ({
    node, kept, ...extra,
    live: async () => { const content = await text(path); return content === null ? null : { content, version: await fileVersion(content) }; },
    version: content => fileVersion(content),
    write: content => put(path, content),
    remove: () => rm(path, { force: true }),
  });
  function channelNode(node, channel) {
    const words = async () => {
      const content = await text(at('vault.md'));
      const found = parseMap(content, new Set([channel])).get(channel);
      return { content, found };
    };
    const version = content => cortexVersion({ channel: { meaning: content.meaning ?? '', conventions: content.conventions ?? '' } });
    const write = async (content, by = actor) => {
      const vault = await theVault();
      if (!vault) throw new Refused('NoVault', 'No vault is connected to this cortex');
      const shape = await vault.shape();
      const map = await text(at('vault.md'));
      const written = parseMap(map, new Set(shape.channels.map(item => item.channel)));
      const was = written.get(channel) ?? { meaning: '', conventions: '', extra: [] };
      const next = { ...was, meaning: content.meaning ?? '', conventions: content.conventions ?? '' };
      written.set(channel, next);
      await put(at('vault.md'), writeMap(shape, written));
      // An agent's words are logged as its own, so it may rewrite them, and the person's stand.
      if (actorOf(by).kind !== 'human') {
        await mkdir(dirname(meaningsLog), { recursive: true });
        for (const field of ['meaning', 'conventions']) if (next[field] !== was[field] && next[field]) await appendFile(meaningsLog, `${JSON.stringify({ channel, field, text: next[field], by, when: now().toISOString() })}\n`);
      }
    };
    // What the person wrote by hand stands: an agent may not write over it, by restoring either.
    const guard = async content => {
      const { found } = await words();
      const last = await agentWords();
      for (const field of ['meaning', 'conventions']) {
        const current = found?.[field] ?? '';
        if (current && current !== (content[field] ?? '') && current !== last.get(`${channel}\u0000${field}`)) throw new Refused('PersonWrote', `The person wrote the ${field} of ${channel} themselves, and what they wrote stands. Suggest a change to them instead`, { current });
      }
    };
    return {
      node, channel, kept: ['channels', channel], guard,
      encode: content => JSON.stringify(content), decode: kept => JSON.parse(kept),
      live: async () => {
        const { found } = await words();
        if (!found || (!found.meaning && !found.conventions)) return null;
        const content = { meaning: found.meaning, conventions: found.conventions };
        return { content, version: await version(content) };
      },
      version, write,
      remove: by => write({ meaning: '', conventions: '' }, by),
    };
  }
  function nodeOf(node) {
    if (typeof node !== 'string' || !node || node.length > 300) throw new Refused('InvalidRequest', 'Name a node as cortex_history lists it, such as memory/<name>, identity or channel/<path>');
    let found;
    if (node === 'identity') {
      return { ...fileNode(node, at('identity.md'), ['identity', 'identity'], { personOnly: true }),
        live: async () => { const content = await text(at('identity.md')); return content === null ? null : { content, version: (await readIdentity(content)).version }; },
        version: async content => (await readIdentity(content)).version };
    }
    if (node === 'playbook') return fileNode(node, at('agents', 'AGENTS.md'), ['playbook', 'playbook'], { personOnly: true });
    if ((found = new RegExp(`^memory/(${SLUG})$`).exec(node))) {
      const name = found[1];
      return {
        node, memory: name, kept: ['memory', name],
        live: async () => { const live = await held(name); return live && { content: live.content, version: live.version }; },
        version: content => memoryVersion(readMemoryFile(content)),
        write: async content => { await put(memoryPath(name), content); await reindex(); },
        remove: async () => { await rm(memoryPath(name), { force: true }); await reindex(); },
      };
    }
    if ((found = /^working\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(node))) {
      const agent = found[1];
      return {
        node, agent, kept: ['working', agent],
        live: async () => { const live = await workingOf(agent); return live && { content: live.text, version: live.version }; },
        version: content => cortexVersion({ working: content }),
        write: content => put(workingPath(agent), content),
        remove: () => rm(workingPath(agent), { force: true }),
      };
    }
    if ((found = new RegExp(`^skill/(${SLUG})$`).exec(node))) {
      const root = at('skills', found[1]);
      return {
        node, kept: ['skills', found[1]], personOnly: true,
        // Kept as the whole skill; a skill kept before this was its SKILL.md alone.
        encode: content => JSON.stringify(content),
        decode: kept => { try { const parsed = JSON.parse(kept); if (typeof parsed?.text === 'string') return parsed; } catch {} return kept; },
        live: async () => { const live = await skillAt(root); return live && { content: live.skill, version: live.version }; },
        version: content => cortexVersion(typeof content === 'string' ? { text: content, files: [] } : content),
        write: async content => {
          // SKILL.md alone, from before skills were kept whole, leaves the files beside it as they are.
          if (typeof content === 'string') return put(join(root, 'SKILL.md'), content);
          await rm(root, { recursive: true, force: true });
          await put(join(root, 'SKILL.md'), content.text);
          for (const file of content.files) await put(join(root, normalize(file.path)), file.text);
        },
        remove: () => rm(root, { recursive: true, force: true }),
      };
    }
    if ((found = new RegExp(`^tool/(${SLUG})$`).exec(node))) return fileNode(node, at('tools', `${found[1]}.md`), ['tools', found[1]], { personOnly: true });
    if ((found = /^channel\/(.+)$/.exec(node)) && !found[1].split('/').some(part => !part || part === '.' || part === '..')) return channelNode(node, found[1]);
    throw new Refused('NotFound', `There is no node ${node}. A node is identity, playbook, memory/<name>, working/<agent>, skill/<name>, tool/<name> or channel/<path>`);
  }
  const encode = (spec, content) => (spec.encode ? spec.encode(content) : content);
  // The content of a node at one of its versions: as it is now, or the copy kept when it was
  // replaced. A journal from when agents' edits waited for the person may hold proposal lines that
  // carried their content; those versions can be read back too.
  async function contentAt(spec, version, lines) {
    const live = await spec.live();
    if (live?.version === version) return live.content;
    const file = (await earlier(...spec.kept)).find(item => item.version === version)?.file;
    if (file) {
      const kept = await readFile(at('.cortex', 'history', ...spec.kept, file), 'utf8');
      return spec.decode ? spec.decode(kept) : kept;
    }
    const proposed = (lines ?? await journal.read()).find(line => line.type === 'proposal' && line.node === spec.node && line.after === version && line.content !== undefined);
    return proposed ? proposed.content : null;
  }

  // Writes a node: what it replaces is kept, then the new content, or nothing to remove it.
  async function apply(spec, content, by = actor) {
    const live = await spec.live();
    if (live) await keep(...spec.kept, encode(spec, live.content), live.version);
    if (content === null) await spec.remove(by); else await spec.write(content, by);
    return (await spec.live())?.version ?? null;
  }

  // Whether this actor may write a node. The person may write any. An agent never writes a
  // personOnly node, nor another agent's working memory.
  function mayWrite(spec, what) {
    if (person) return;
    if (spec.personOnly) throw new Refused('PersonOnly', `Only the person ${what} ${spec.node}, from the command line`);
    if (spec.agent !== undefined && spec.agent !== fileName(actor)) throw new Refused('PersonOnly', 'An agent writes only its own working memory');
  }

  // The one way an edit is made, by the person or an agent alike: what it replaces is kept, the node
  // is written, and a change line says who made it, with its versions before and after, why, and
  // what it was drawn from. `before` is the version the edit applies to, already checked by the caller.
  async function edit(spec, op, content, { before = null, reason, evidence, session, extra = {} } = {}) {
    mayWrite(spec, op === 'restore' ? 'restores' : 'changes');
    if (!person && spec.guard) await spec.guard(content ?? {});
    const after = await apply(spec, content);
    const line = await journal.append(actor, 'change', { node: spec.node, op, before, after, ...(reason ? { reason } : {}), ...(evidence ? { evidence } : {}), ...extra }, { session });
    return { node: spec.node, op, version: after, change: line.id, seq: line.seq };
  }

  // Changes one field of identity.md and keeps the rest of the file, the person's own fields and
  // anything they wrote that cannot be read, as it was. Only the person does this; `extra` names the
  // agent and the proposal behind a confirmed fact.
  async function setField(field, value, { extra = {} } = {}) {
    const spec = nodeOf('identity');
    const content = await text(at('identity.md')) ?? '';
    const { properties, body, version } = await readIdentity(content);
    const next = { ...properties };
    if (value === undefined) delete next[field]; else next[field] = value;
    const after = await apply(spec, writeIdentity(next, body));
    await journal.append(actor, 'change', { node: 'identity', op: content ? 'update' : 'create', before: content ? version : null, after, reason: `${field} ${value === undefined ? 'cleared' : 'set'}`, ...extra });
  }

  // What cited evidence points at must be there where cortex can look. A node of the cortex must
  // hold that version now, have it kept, or have had it in the journal. Any other node is a block in
  // the vault, and must still be in the vault when one is connected; the contract has no versions,
  // so its version is not checked. Sessions are named by the agent, so they cannot be looked up.
  async function checkCited(evidence) {
    if (evidence === undefined) return;
    let lines;
    const blocks = [];
    for (const { node, version } of evidence.filter(pointer => pointer.node !== undefined)) {
      let spec;
      try { spec = nodeOf(node); } catch (problem) {
        if (!(problem instanceof Refused) || problem.code !== 'NotFound') throw problem;
        blocks.push(node);
        continue;
      }
      lines ??= await journal.read();
      if (await contentAt(spec, version, lines) !== null) continue;
      if (!lines.some(line => line.type === 'change' && line.node === node && (line.before === version || line.after === version))) throw new Refused('NoEvidence', `The cortex has no version ${version} of ${node}`);
    }
    if (!blocks.length) return;
    const vault = await theVault();
    if (!vault) return;
    const where = await vault.exists(blocks);
    const missing = blocks.filter(id => !where[id]?.exists);
    if (missing.length) throw new Refused('NoEvidence', `The vault has no ${missing.join(', ')}`);
  }

  // A point in the journal: a save's name, a date or a time, or a seq. A date with no time means
  // the end of that day, in UTC.
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  function pointOf(when, lines) {
    if (Number.isSafeInteger(when) || (typeof when === 'string' && /^\d+$/.test(when))) {
      const seq = Number(when);
      return { said: { seq }, holds: line => line.seq <= seq };
    }
    if (typeof when !== 'string' || !when.trim() || when.length > 100) throw new Refused('InvalidRequest', 'Say when: a save\'s name, a date such as 2026-11-19, a time, or a seq');
    if (/^\d{4}-\d{2}-\d{2}/.test(when)) {
      const time = DAY.test(when) ? `${when}T23:59:59.999Z` : when;
      if (!Number.isFinite(Date.parse(time))) throw new Refused('InvalidRequest', `${when} is not a date or a time`);
      const until = new Date(time).toISOString();
      return { said: { at: until }, holds: line => line.at <= until };
    }
    const saved = lines.filter(line => line.type === 'save' && line.name === when).at(-1);
    if (!saved) throw new Refused('NotFound', `There is no save named ${when}`);
    return { said: { save: saved.name, seq: saved.seq, at: saved.at }, holds: line => order(line, saved) <= 0 };
  }
  const SAVE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const onlyPerson = what => { if (!person) throw new Refused('PersonOnly', `Only the person ${what}, from the command line`); };

  // A memory as it would be written: checked, with who wrote it and how often it was seen kept by
  // cortex, whatever the request says.
  async function memoryFor(given, live) {
    let memory;
    try { memory = cleanMemory(given); } catch (problem) {
      if (problem instanceof InvalidMemory) throw new Refused('InvalidMemory', problem.message);
      throw problem;
    }
    memory.writtenBy = actor;
    memory.seen = live?.memory.seen ?? { count: 0, last: null };
    if (memory.notes) {
      const kept = await notes();
      if (memory.notes.some(id => !kept.has(id))) throw new Refused('InvalidMemory', 'A source note must be one recorded in this cortex');
    }
    await checkCited(memory.evidence);
    return memory;
  }

  // Sessions: what an agent writes when it finishes a task, or gives it up.
  function checkSession({ summary, outcome = 'done', made = [], deadEnds = [], resolved = [], project, session } = {}) {
    if (!oneLine(summary, 300)) throw new Refused('InvalidRequest', 'summary is one line of what was done, at most 300 characters');
    if (!['done', 'stopped'].includes(outcome)) throw new Refused('InvalidRequest', 'outcome is done, or stopped when the task was given up');
    if (!Array.isArray(made) || made.length > 100 || made.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new Refused('InvalidRequest', 'made is up to 100 IDs of the changes this task made');
    if (!Array.isArray(deadEnds) || deadEnds.length > 20) throw new Refused('InvalidRequest', 'deadEnds is up to 20 things tried and dropped');
    for (const item of deadEnds) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['tried', 'why', 'check'].includes(key)) || !oneLine(item.tried) || !oneLine(item.why) || (item.check !== undefined && !oneLine(item.check))) {
        throw new Refused('InvalidRequest', 'A dead end has tried and why, one line each, and may have check: a command that shows whether it still holds');
      }
    }
    if (!Array.isArray(resolved) || resolved.length > 50 || resolved.some(id => typeof id !== 'string' || !id)) throw new Refused('InvalidRequest', 'resolved is up to 50 IDs of dead ends that no longer hold');
    if (project !== undefined && !oneLine(project, 2000)) throw new Refused('InvalidRequest', 'project is the folder or project the task was in, on one line');
    if (session !== undefined && !oneLine(session, 200)) throw new Refused('InvalidRequest', 'session is one line, at most 200 characters');
  }
  // Two paths are near when one is the other or holds it.
  const near = (a, b) => {
    const trim = path => String(path).replace(/\/+$/, '');
    const [x, y] = [trim(a), trim(b)];
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  };

  const cortex = {
    dir, reindex, nodeOf,

    // The changes recorded in the journal, oldest first, and the saves among them. node is a node,
    // or a prefix ending in / for every node under it. since is a seq (changes after it) or a date or
    // time (changes from then on). actor is a name, or human or agent.
    async history({ node, since, actor: who, limit = 50 } = {}) {
      if (node !== undefined && (typeof node !== 'string' || !node || node.length > 300)) throw new Refused('InvalidRequest', 'node is a node, such as memory/<name>, or a prefix ending in /, such as memory/');
      if (who !== undefined && (typeof who !== 'string' || !who || who.length > 100)) throw new Refused('InvalidRequest', 'actor is a name, or human or agent');
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Refused('InvalidRequest', 'limit is a whole number from 1 to 500');
      let after = () => true;
      if (since !== undefined) {
        if (Number.isSafeInteger(since) || (typeof since === 'string' && /^\d+$/.test(since))) after = line => line.seq > Number(since);
        else {
          const from = typeof since === 'string' && /^\d{4}-\d{2}-\d{2}/.test(since) ? Date.parse(DAY.test(since) ? `${since}T00:00:00.000Z` : since) : NaN;
          if (!Number.isFinite(from)) throw new Refused('InvalidRequest', 'since is a seq, or a date such as 2026-11-19, or a time');
          const start = new Date(from).toISOString();
          after = line => line.at >= start;
        }
      }
      const by = line => who === undefined || line.actor?.name === who || line.actor?.kind === who;
      const lines = (await journal.read()).filter(line => after(line) && by(line));
      const on = line => node === undefined || (node.endsWith('/') ? String(line.node).startsWith(node) : line.node === node);
      const changes = lines.filter(line => line.type === 'change' && on(line)).map(({ type, ...line }) => line);
      const saves = lines.filter(line => line.type === 'save').map(({ type, ...line }) => line);
      return { changes: changes.slice(-limit), saves, ...(changes.length > limit ? { more: changes.length - limit } : {}) };
    },

    // A node as it was at a point, read back from the journal and the kept versions. Nothing changes.
    async asOf({ node, at: when } = {}) {
      const spec = nodeOf(node);
      const lines = await journal.read();
      const point = pointOf(when, lines);
      const changes = lines.filter(line => line.type === 'change' && line.node === node);
      const upto = changes.filter(point.holds);
      const later = changes.filter(line => !point.holds(line));
      // The version then is what the last change up to that point left. With no change before it, it
      // is what the first change after it found, or, with no change at all, the version now.
      const live = await spec.live();
      const version = upto.length ? upto.at(-1).after : later.length ? later[0].before : live?.version ?? null;
      const answer = { node, as: point.said, ...(upto.length ? { change: upto.at(-1).seq } : {}) };
      if (version === null) return { ...answer, exists: false };
      const content = await contentAt(spec, version, lines);
      if (content === null) return { ...answer, version, kept: false };
      // An agent never sees the hidden identity fields, now or as they were.
      if (node === 'identity' && !person) return { ...answer, version, identity: forAgent(await readIdentity(content)) };
      return { ...answer, version, ...(typeof content === 'string' ? { text: content } : { content }) };
    },

    // Names this point in the journal, so the cortex can be read as it was here. It changes nothing.
    async save({ name, note } = {}) {
      if (typeof name !== 'string' || name.length > 100 || !SAVE_NAME.test(name) || /^\d+$/.test(name) || /^\d{4}-\d{2}-\d{2}/.test(name)) throw new Refused('InvalidRequest', 'A save\'s name is lowercase letters and digits joined by hyphens, at most 100 characters, and not a number or a date');
      if (!oneLine(note)) throw new Refused('InvalidRequest', 'A save has a note: one line, at most 500 characters');
      if ((await journal.read()).some(line => line.type === 'save' && line.name === name)) throw new Refused('NameTaken', `There is already a save named ${name}`);
      const line = await journal.append(actor, 'save', { name, note: note.trim() });
      return { name, seq: line.seq, at: line.at };
    },

    // Brings a node back to an earlier version, as a new change: what it replaces is kept, and no
    // line of the journal is rewritten. Identity, the playbook, skills and tools are restored only
    // by the person; an agent restores only its own working memory, and never over what the person
    // wrote in vault.md. `replaces`, when given, is the version read now, and the restore is refused
    // if it changed.
    async restore({ node, version, replaces, reason, extra = {} } = {}) {
      const spec = nodeOf(node);
      if (typeof version !== 'string' || !version) throw new Refused('InvalidRequest', 'Name the version to bring back');
      if (!person && spec.personOnly) throw new Refused('PersonOnly', `Only the person restores ${node}. Ask them to run: cortex restore ${node} ${version}`);
      mayWrite(spec, 'restores');
      const why = checkReason(reason);
      const live = await spec.live();
      if (replaces !== undefined && (live?.version ?? null) !== (replaces ?? null)) throw changed(node, live?.version ?? null);
      if (live?.version === version) return { node, version, unchanged: true };
      const content = await contentAt(spec, version);
      if (content === null) throw new Refused('NotFound', `No version ${version} of ${node} is kept`);
      if (spec.memory) {
        let memory;
        try { memory = readMemoryFile(content); } catch { throw new Refused('Unreadable', `The kept version ${version} cannot be read as a memory`); }
        if (memory.name !== spec.memory) throw new Refused('Unreadable', `The kept version ${version} is of another memory`);
      }
      const done = await edit(spec, 'restore', content, { before: live?.version ?? null, reason: why ?? `restored ${version}`, extra: { restores: version, ...extra } });
      return { ...done, restored: version };
    },

    // Undoes one change, as a new change: the node goes back to what it was before that change. It
    // is refused once the node has changed again since; restore a version instead.
    async revert({ change, reason } = {}) {
      if ((typeof change !== 'string' || !change) && !Number.isSafeInteger(change)) throw new Refused('InvalidRequest', 'Name the change by its seq or ID');
      const lines = await journal.read();
      const target = lines.find(line => line.type === 'change' && (line.id === change || String(line.seq) === String(change)));
      if (!target) throw new Refused('NotFound', `There is no change ${change}`);
      const spec = nodeOf(target.node);
      if (!person && spec.personOnly) throw new Refused('PersonOnly', `Only the person reverts a change to ${target.node}. Ask them to run: cortex revert ${target.seq}`);
      mayWrite(spec, 'reverts');
      const live = await spec.live();
      if ((live?.version ?? null) !== target.after) throw new Refused('Changed', `${target.node} has changed since change ${target.seq}. Restore a version instead`, { current: live?.version ?? null });
      const why = checkReason(reason) ?? `reverts change ${target.seq}`;
      if (target.before === null) {
        return { ...await edit(spec, 'remove', null, { before: live?.version ?? null, reason: why, extra: { reverts: target.id } }), reverted: target.id };
      }
      return { ...await cortex.restore({ node: target.node, version: target.before, reason: why, extra: { reverts: target.id } }), reverted: target.id };
    },

    // An agent records a task it finished, or gave up: one line of what was done, the changes it
    // made, grouped by their IDs, and the dead ends, each with what was tried, why it was dropped, and
    // a command that would show whether it still holds. Only agents write sessions.
    async recordSession(given = {}) {
      if (person) throw new Refused('InvalidRequest', 'A session is written by the agent that did the task');
      checkSession(given);
      const { summary, outcome = 'done', made = [], deadEnds = [], resolved = [], project, session } = given;
      const lines = await journal.read();
      for (const id of made) {
        const found = lines.find(line => line.type === 'change' && line.id === id);
        if (!found) throw new Refused('NotFound', `There is no change ${id}`);
        if (found.actor?.name !== actor) throw new Refused('InvalidRequest', `${id} was made by ${found.actor?.name}, not by you`);
      }
      const open = new Set((await cortex.deadEnds()).map(item => item.id));
      for (const id of resolved) if (!open.has(id)) throw new Refused('NotFound', `There is no open dead end ${id}`);
      const ends = deadEnds.map(item => ({ id: `d${randomBytes(6).toString('hex')}`, tried: item.tried.trim(), why: item.why.trim(), ...(item.check ? { check: item.check.trim() } : {}) }));
      const line = await journal.append(actor, 'session', { summary: summary.trim(), outcome, made, deadEnds: ends, ...(resolved.length ? { resolved } : {}), ...(project ? { project: project.trim() } : {}) }, { session });
      return { id: line.id, seq: line.seq, deadEnds: ends.map(item => item.id) };
    },

    // Dead ends no later session resolved, newest first. With a project, only those near it.
    async deadEnds({ project, limit = 20 } = {}) {
      const sessions = (await journal.read()).filter(line => line.type === 'session' && Array.isArray(line.deadEnds));
      const resolved = new Set(sessions.flatMap(line => line.resolved ?? []));
      const open = sessions.flatMap(line => line.deadEnds.filter(item => !resolved.has(item.id)).map(item => ({ ...item, agent: line.actor?.name, at: line.at, ...(line.project ? { project: line.project } : {}) })));
      return open.filter(item => project === undefined || (item.project && near(item.project, project))).reverse().slice(0, limit);
    },

    // This agent's working memory, and every other agent's, newest first.
    async working() {
      const mine = await workingOf(actor);
      const others = [];
      for (const entry of await names(at('.cortex', 'working'))) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === `${fileName(actor)}.md`) continue;
        const other = await workingOf(entry.name.slice(0, -3));
        if (other) others.push(other);
      }
      return { mine: mine ?? { agent: fileName(actor), text: '', version: null }, others: others.sort((a, b) => b.updated.localeCompare(a.updated) || a.agent.localeCompare(b.agent)) };
    },

    // Rewrites this agent's own working memory, as it works. Another agent's is never written.
    writeWorking: (given, { replaces = null } = {}) => putWorking(given, replaces),

    // The end of a session: the agent has read every agent's working memory together and records,
    // as notes for this session, what it judges seen often enough to become memory. Then it leaves
    // its own working memory as "last time" for the next session; the one it replaces is kept.
    async distill({ session, notes: seen = [], working, version } = {}) {
      if (typeof session !== 'string' || !session || session.length > 200) throw new Refused('InvalidRequest', 'Name the session being distilled');
      if (!Array.isArray(seen) || seen.length > 50) throw new Refused('InvalidRequest', 'notes is up to 50 things seen');
      const held = await workingOf(actor);
      if (held && version !== held.version) throw changed('working memory', held.version);
      if (typeof working !== 'string' || bytes(working) > 8192) throw new Refused('InvalidRequest', 'Leave working memory as Markdown, at most 8 KB');
      // Every note is checked first, against the others and against what is kept, so a refused
      // distill writes nothing.
      const kept = await notes();
      const ids = new Set();
      for (const item of seen) {
        checkNote({ ...item, session });
        if (ids.has(item.id)) throw new Refused('InvalidRequest', `Two notes have the ID ${item.id}`);
        ids.add(item.id);
        if (kept.has(item.id) && kept.get(item.id).text !== item.note) throw new Refused('Changed', `Another note already has the ID ${item.id}`);
        await checkCited(item.evidence);
      }
      const recorded = [];
      for (const item of seen) recorded.push(await cortex.addNote({ id: item.id, note: item.note, session, ...(item.project ? { project: item.project } : {}), ...(item.evidence ? { evidence: item.evidence } : {}) }));
      const left = await putWorking(working, held?.version ?? null, { keepEarlier: true });
      // The model does not know the client's session ID, so a distill is recorded for the hooks by
      // agent, time and the version of working memory it left. The stop hook asks whether the
      // working memory it sees is one a distill left, since its session started.
      // The notes and working memory are already saved, so a failed record never fails the distill.
      try {
        await mkdir(at('.cortex'), { recursive: true });
        await appendFile(hooksLog(dir), `${JSON.stringify({ agent: actor, distilled: now().toISOString(), version: left.version ?? null })}\n`);
      } catch {}
      return { session, noted: recorded.map(item => item.id), working: left };
    },

    async start() {
      const vault = await cortex.syncVault().catch(problem => {
        if (!(problem instanceof Refused)) throw problem;
        return { connected: true, reachable: false, problem: problem.message };
      });
      await reindex();
      return cortex.inspect(vault);
    },

    // A read-only view for the person. Unlike starting an agent session, inspecting must not
    // sync the vault, regenerate the index, or record observations just by looking at them.
    async inspect(synced) {
      let vault = synced;
      if (!vault) {
        try {
          const connected = await theVault();
          vault = { connected: Boolean(connected) };
          if (connected) {
            const shape = await connected.shape();
            const map = parseMap(await text(at('vault.md')), new Set(shape.channels.map(item => item.channel)));
            const { memories } = await all();
            const pointed = memories.flatMap(({ memory }) => memory.blocks ?? []);
            const where = pointed.length ? await connected.exists(pointed) : {};
            vault = { connected: true, channels: shape.channels.map(item => ({ ...item, meaning: map.get(item.channel)?.meaning, conventions: map.get(item.channel)?.conventions })), gone: gone(shape, map), broken: memories.flatMap(({ memory }) => (memory.blocks ?? []).filter(id => !where[id]?.exists).map(block => ({ memory: memory.name, block }))), problems: shape.problems };
          }
        } catch (problem) {
          vault = { connected: true, reachable: false, problem: problem.message };
        }
      }
      const { memories, problems } = await all();
      const identity = await cortex.identity();
      const pending = [...(await notes()).values()].filter(note => !note.settledAt);
      const found = [...identity.problems, ...problems, ...(vault.problem ? [`vault: ${vault.problem}`] : []), ...(vault.problems ?? []).map(problem => `vault: ${problem}`)];
      return {
        rules: await cortex.rules(),
        identity: forAgent(identity),
        vault: vault.connected && vault.reachable !== false ? { connected: true, channels: vault.channels, ...(vault.broken.length ? { broken: vault.broken } : {}), ...(vault.gone?.length ? { gone: vault.gone } : {}) } : { connected: vault.connected, ...(vault.reachable === false ? { reachable: false } : {}) },
        always: memories.filter(({ memory }) => memory.always),
        memories: memories.filter(({ memory }) => !memory.always).map(({ memory: { name, description, kind } }) => ({ name, description, kind })),
        // Only what the person has approved or switched on is handed over as usable.
        skills: (await skillsIn(at('skills'))).map(({ name, description }) => ({ name, description })),
        tools: (await toolsIn(at('tools'))).filter(tool => tool.on).map(({ name, description }) => ({ name, description })),
        notes: pending,
        working: await cortex.working(),
        // What only the person can settle: identity facts to confirm, skills to approve, tools asked for.
        waiting: {
          identity: (await cortex.identityProposals()).map(proposalForAgent),
          skills: (await skillsIn(at('.cortex', 'proposed', 'skills'))).map(skill => skill.name),
          tools: (await toolsIn(at('.cortex', 'proposed', 'tools'))).map(tool => tool.name),
        },
        deadEnds: await cortex.deadEnds(),
        ...(found.length ? { problems: found } : {}),
      };
    },

    async identity() {
      let content;
      try { content = await text(at('identity.md')); } catch (problem) {
        if (!problem?.code) throw problem;
        const empty = await readIdentity(null);
        return { ...empty, problems: [`identity.md cannot be read: ${problem.code}`] };
      }
      return readIdentity(content);
    },

    // The person names the vault this cortex reads. It is opened and read once to check it answers.
    async connectVault(config) {
      const vault = vaultFrom(config);
      await vault.shape();
      await put(at('.cortex', 'vault.json'), `${JSON.stringify(config, null, 2)}\n`);
      await rm(at('.cortex', 'vault-cursor.json'), { force: true });
      openedVault = vault;
      return cortex.syncVault();
    },

    // Brings the cortex in step with the vault: the channels and counts in vault.md, notes for the
    // changes an agent has to act on, and the memories that point at blocks no longer there. The
    // headings and counts follow the vault and are derived, like the memory index, so they are not
    // changes; what a channel means is a channel node, and is not touched here.
    async syncVault() {
      const vault = await theVault();
      if (!vault) return { connected: false };
      const cursorPath = at('.cortex', 'vault-cursor.json');
      // A cursor that cannot be read, say after a merge, is started again: the vault is read afresh
      // and nothing that happened before is reported.
      let before = null;
      try { before = JSON.parse(await text(cursorPath) ?? 'null'); } catch {}
      const { changes, cursor } = await vault.changes(before);
      const shape = await vault.shape();
      const content = await text(at('vault.md'));
      const known = new Set(shape.channels.map(item => item.channel));
      const written = parseMap(content, known);
      const next = writeMap(shape, written);
      if (next !== content) {
        if (content !== null) await keep('vault-map', 'vault', content, short(content));
        await put(at('vault.md'), next);
      }

      const { memories } = await all();
      const pointing = id => memories.filter(({ memory }) => memory.blocks?.includes(id)).map(({ memory }) => memory.name);
      const noted = [];
      const note = async (key, line) => {
        const id = `vault-${short(key)}`;
        if (!(await notes()).has(id)) { await recordNote({ id, text: line.slice(0, 500), session: 'vault', source: 'vault' }); noted.push(id); }
      };
      // Only what an agent has to act on becomes a note. A block saved in a known channel needs nothing.
      // A note's ID is made from what it is about, and kept from before channels, so nothing is noted twice.
      for (const change of changes) {
        const names = pointing(change.id);
        if (change.type === 'removed' && names.length) await note([change.type, change.id], `Block "${change.title}" (${change.id}) was removed from ${change.channel}. These memories pointed at it: ${names.join(', ')}`);
        if (change.type === 'moved' && names.length) await note([change.type, change.id, change.channel], `Block "${change.title}" (${change.id}) moved from ${change.from} to ${change.channel}. These memories point at it: ${names.join(', ')}`);
      }
      for (const { channel } of shape.channels) if (!written.has(channel)) await note(['section', channel], `The vault has a channel, ${channel}, that vault.md does not describe yet`);
      for (const key of gone(shape, written)) await note(['gone', key], `The channel ${key} is no longer in the vault. What vault.md said about it is kept`);

      const pointed = memories.flatMap(({ memory }) => memory.blocks ?? []);
      const where = pointed.length ? await vault.exists(pointed) : {};
      const broken = memories.flatMap(({ memory }) => (memory.blocks ?? []).filter(id => !where[id]?.exists).map(id => ({ memory: memory.name, block: id })));
      if (JSON.stringify(before) !== JSON.stringify(cursor)) await put(cursorPath, JSON.stringify(cursor));
      const map = parseMap(next, known);
      return {
        connected: true,
        channels: shape.channels.map(({ channel, blocks }) => ({ channel, blocks, ...(map.get(channel)?.meaning ? { meaning: map.get(channel).meaning } : {}), ...(map.get(channel)?.conventions ? { conventions: map.get(channel).conventions } : {}) })),
        changes: changes.length, noted, broken, gone: gone(shape, map), ...(shape.problems?.length ? { problems: shape.problems } : {}),
      };
    },

    // What a channel means and how blocks there are filed. The agent writes it without being asked.
    // Once the person has written over it by hand, theirs stands, and the agent's write is refused.
    async describeChannel({ channel, meaning, conventions } = {}) {
      const vault = await theVault();
      if (!vault) throw new Refused('NoVault', 'No vault is connected to this cortex');
      const shape = await vault.shape();
      const content = await text(at('vault.md'));
      const written = parseMap(content, new Set(shape.channels.map(item => item.channel)));
      if (typeof channel !== 'string' || !channel || (!shape.channels.some(item => item.channel === channel) && !written.has(channel))) throw new Refused('NotFound', `There is no channel ${channel} in the vault`);
      const given = Object.entries({ meaning, conventions }).filter(([, value]) => value !== undefined);
      if (!given.length) throw new Refused('InvalidRequest', 'Give a meaning, conventions, or both');
      const words = written.get(channel) ?? { meaning: '', conventions: '', extra: [] };
      const last = await agentWords();
      const next = { meaning: words.meaning, conventions: words.conventions };
      const changes = [];
      for (const [field, value] of given) {
        const checked = checkWords(field, value);
        const current = words[field];
        if (!person && current && current !== last.get(`${channel}\u0000${field}`)) throw new Refused('PersonWrote', `The person wrote the ${field} of ${channel} themselves, and what they wrote stands. Suggest a change to them instead`, { current });
        if (current !== checked) { changes.push([field, checked]); next[field] = checked; }
      }
      if (!changes.length) return { channel, unchanged: true };
      const spec = nodeOf(`channel/${channel}`);
      const live = await spec.live();
      const done = await edit(spec, live ? 'update' : 'create', next, { before: live?.version ?? null, reason: `${changes.map(([field]) => field).join(' and ')} of ${channel}` });
      return { channel, ...Object.fromEntries(changes), ...done };
    },
    // The name from before channels. It answers as it did, with `section`.
    async describeSection({ section, ...rest } = {}) {
      const { channel, ...done } = await cortex.describeChannel({ channel: section, ...rest });
      return { section: channel, ...done };
    },

    // The playbook, as the person keeps it, their own rules included.
    rules: async () => (await text(at('agents', 'AGENTS.md'))) ?? '',
    vaultMap: () => text(at('vault.md')),
    // The vault this cortex reads, or null. For operations that only read it, such as filing advice.
    connectedVault: () => theVault(),

    // Every proposal, confirmation, rejection and clearing, in the order it happened.
    async identityLog() {
      return ((await text(identityLog)) ?? '').split('\n').filter(Boolean).flatMap(entry => { try { return [JSON.parse(entry)]; } catch { return []; } });
    },

    // A proposal is known by its field and value: two with different evidence for the same value
    // are one, and the first one's evidence is shown. Read in order, so a fact confirmed, cleared
    // and then proposed again is waiting again. One the field already holds is not waiting.
    async identityProposals() {
      const waiting = new Map();
      for (const entry of await cortex.identityLog()) {
        const key = factKey(entry.field, entry.value);
        if (entry.type === 'proposed') { if (!waiting.has(key)) waiting.set(key, entry); }
        else if (entry.type === 'confirmed' || entry.type === 'rejected') waiting.delete(key);
      }
      const { fields } = await cortex.identity();
      return [...waiting.values()].filter(entry => factKey(entry.field, fields[entry.field]) !== factKey(entry.field, entry.value));
    },

    // An agent proposes. Nothing it proposes changes identity.md until the person confirms it. The
    // proposal is kept in .cortex/identity.jsonl; the journal records the change once it is confirmed.
    async proposeIdentity({ field, value, source } = {}) {
      if (!Object.hasOwn(IDENTITY, field)) throw new Refused('InvalidIdentity', `${field} is not an identity field. The fields are: ${FIELDS.join(', ')}`);
      const evidence = checkSource(field, source);
      const checked = checkField(field, value);
      if (!statesValue(field, checked, evidence.quote ?? evidence.passage)) throw new Refused('NoEvidence', `The ${evidence.kind === 'person' ? 'quote' : 'passage'} does not say ${JSON.stringify(checked)}. Quote where it is stated`);
      // With a vault connected, the block must be there and must say what is quoted from it.
      if (evidence.kind === 'vault') {
        const vault = await theVault();
        if (vault) {
          const block = await vault.read(evidence.block);
          if (!block) throw new Refused('NoEvidence', `There is no block ${evidence.block} in the vault`);
          const plain = words => words.toLowerCase().replace(/\s+/g, ' ').trim();
          if (!plain(`${block.title}\n${block.body}`).includes(plain(evidence.passage))) throw new Refused('NoEvidence', `Block ${evidence.block} does not say what is quoted from it. Quote the passage as it is written`);
        }
      }
      const id = `i${(await cortexVersion({ field, value: checked, source: evidence })).slice(1, 13)}`;
      const key = factKey(field, checked);
      // A no stands for the value, whatever evidence comes with it next time.
      if ((await cortex.identityLog()).some(entry => entry.type === 'rejected' && factKey(entry.field, entry.value) === key)) {
        throw new Refused('AlreadyRejected', `The person already said no to ${field} being ${JSON.stringify(checked)}. Do not propose it again`);
      }
      const { fields } = await cortex.identity();
      if (factKey(field, fields[field]) === key) return { id, field, confirmed: true, unchanged: true };
      const same = (await cortex.identityProposals()).find(proposal => factKey(proposal.field, proposal.value) === key);
      if (same) return { id: same.id, field, waiting: true, unchanged: true };
      await recordIdentity({ type: 'proposed', id, field, value: checked, source: evidence });
      return { id, field, waiting: true, ...(fields[field] !== undefined ? { current: shownValue(field, fields[field]) } : {}) };
    },

    // The person's answer to a proposal, by its ID, or by the field when only one is waiting for it.
    // Confirming is the person's change, and names the agent that proposed the fact. A rejection
    // changes nothing, so it is kept in .cortex/identity.jsonl alone.
    async confirmIdentity(ref) {
      onlyPerson('confirms an identity fact');
      const proposal = await waitingFor(ref);
      await setField(proposal.field, proposal.value, { extra: { proposedBy: proposal.by ?? 'agent', identityProposal: proposal.id } });
      await recordIdentity({ type: 'confirmed', id: proposal.id, field: proposal.field, value: proposal.value, source: proposal.source });
      return { id: proposal.id, field: proposal.field, value: proposal.value, confirmed: true };
    },

    async rejectIdentity(ref) {
      onlyPerson('rejects an identity fact');
      const proposal = await waitingFor(ref);
      await recordIdentity({ type: 'rejected', id: proposal.id, field: proposal.field, value: proposal.value });
      return { id: proposal.id, field: proposal.field, rejected: true };
    },

    async clearIdentity(field) {
      onlyPerson('clears an identity field');
      if (!Object.hasOwn(IDENTITY, field)) throw new Refused('InvalidIdentity', `${field} is not an identity field`);
      const { properties } = await cortex.identity();
      if (properties[field] === undefined) return { field, cleared: true, unchanged: true };
      await setField(field, undefined);
      await recordIdentity({ type: 'cleared', field });
      return { field, cleared: true };
    },

    // The one field set without a proposal: it is what the signed-in account says it is.
    async setAccount(value) {
      onlyPerson('sets the account');
      const checked = checkField('account', value);
      await setField('account', checked);
      await recordIdentity({ type: 'confirmed', field: 'account', value: checked, source: { kind: 'account' } });
      return { field: 'account', value: checked };
    },

    async list({ kind } = {}) {
      if (kind !== undefined && !KINDS.includes(kind)) throw new Refused('InvalidRequest', `kind is one of: ${KINDS.join(', ')}`);
      const { memories, problems } = await all();
      return {
        memories: memories.filter(({ memory }) => !kind || memory.kind === kind).map(({ memory, version }) => ({ name: memory.name, version, description: memory.description, kind: memory.kind, writtenBy: memory.writtenBy })),
        ...(problems.length ? { problems } : {}),
      };
    },

    async read(name, { version, history = false } = {}) {
      const live = await held(known(name));
      const versions = history || (version !== undefined && live?.version !== version) ? await earlier('memory', name) : [];
      let found = live && (version === undefined || live.version === version) ? live : null;
      if (!found && version !== undefined) {
        const kept = versions.find(item => item.version === version);
        if (kept) found = { memory: readMemoryFile(await readFile(at('.cortex', 'history', 'memory', name, kept.file), 'utf8')), version };
      }
      if (!found) throw new Refused('NotFound', 'There is no such memory version');
      return { memory: found.memory, version: found.version, ...(history ? { earlier: versions.map(({ version, replacedAt }) => ({ version, replacedAt })) } : {}) };
    },

    // A memory, whole, written at once and recorded as a change by whoever wrote it. It names the
    // version it replaces, and is refused if the memory has changed since.
    async write(given, { replaces = null, reason } = {}) {
      const name = given?.name;
      const live = typeof name === 'string' && NAME.test(name) && name.length <= 100 ? await held(name) : null;
      const memory = await memoryFor(given, live);
      const version = await memoryVersion(memory);
      if (live?.version === version) return { name: memory.name, version, unchanged: true };
      if (live && replaces === null) throw new Refused('NameTaken', 'A memory already has this name. Read it and name its version to replace it.', { name: memory.name, current: live.version });
      if ((live?.version ?? null) !== replaces) throw changed('memory', live?.version ?? null);
      const done = await edit(nodeOf(`memory/${memory.name}`), live ? 'update' : 'create', memoryFile(memory), { before: live?.version ?? null, reason: checkReason(reason), evidence: memory.evidence });
      return { name: memory.name, ...done, version };
    },

    async remove(name, { replaces = null, reason } = {}) {
      const live = await held(known(name));
      if (!live) return { name, removed: true, unchanged: true };
      if (live.version !== replaces) throw changed('memory', live.version);
      const done = await edit(nodeOf(`memory/${name}`), 'remove', null, { before: live.version, reason: checkReason(reason) });
      return { name, ...done, removed: true };
    },

    async search({ q, limit = 10 } = {}) {
      if (typeof q !== 'string' || !q.trim() || q.length > 2000) throw new Refused('InvalidRequest', 'Give one or more words, at most 2,000 characters');
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Refused('InvalidRequest', 'limit is a whole number from 1 to 50');
      const words = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 12);
      const count = (within, word) => within.toLowerCase().split(word).length - 1;
      const scored = [];
      for (const { memory } of (await all()).memories) {
        // A description counts for more than the body: it is what was written to be found by.
        const scores = words.map(word => 5 * count(memory.description, word) + count(memory.body, word) + count(memory.name, word));
        if (scores.every(Boolean)) scored.push({ memory, score: scores.reduce((sum, each) => sum + each, 0) });
      }
      scored.sort((a, b) => b.score - a.score || a.memory.name.localeCompare(b.memory.name));
      return { memories: scored.slice(0, limit).map(({ memory: { name, description, kind, body } }) => {
        const first = Math.min(...words.map(word => body.toLowerCase().indexOf(word)).filter(index => index >= 0), body.length);
        const from = Math.max(0, first - 80);
        return { name, description, kind, passage: `${from ? '…' : ''}${body.slice(from, first + 160).replace(/\s+/g, ' ').trim()}${first + 160 < body.length ? '…' : ''}` };
      }) };
    },

    // `source` says where a note came from: the agent that noticed it, or a host reporting a change.
    async addNote({ id, note, session, project, source, evidence } = {}) {
      checkNote({ id, note, session, project, evidence });
      const before = (await notes()).get(id);
      if (before) {
        if (before.text !== note) throw new Refused('Changed', 'Another note already has this ID');
        return { id, unchanged: true };
      }
      await checkCited(evidence);
      await recordNote({ id, text: note, session, project, source: source ?? actor, evidence });
      return { id };
    },

    async listNotes({ settled = false } = {}) {
      return { notes: [...(await notes()).values()].filter(note => settled || !note.settledAt) };
    },

    // Says what became of each note, and rewrites the memories they went into. Each memory it
    // touches, its rewrite and its seen count together, is one change; what became of each note is a
    // settled line. Every outcome is checked before anything is written, so a refused batch leaves
    // the cortex as it was.
    async settle({ changes = [], notes: outcomes } = {}) {
      if (!Array.isArray(outcomes) || !outcomes.length || outcomes.length > 100) throw new Refused('InvalidRequest', 'Give 1 to 100 notes, each with what became of it');
      if (!Array.isArray(changes) || changes.length > 100) throw new Refused('InvalidRequest', 'changes is at most 100 rewritten memories');
      const kept = await notes();
      const seen = new Set();
      const targets = new Map();
      const writing = new Set(changes.map(change => change?.memory?.name));
      for (const item of outcomes) {
        if (!item || typeof item.id !== 'string' || seen.has(item.id)) throw new Refused('InvalidRequest', 'Every note is named once, by its ID');
        seen.add(item.id);
        const note = kept.get(item.id);
        if (!note) throw new Refused('NotFound', `There is no note ${item.id}`);
        if (note.settledAt && note.outcome !== 'kept') throw new Refused('Changed', `Note ${item.id} was already settled as ${note.outcome}`);
        if (item.outcome === 'kept' || item.outcome === 'dropped') continue;
        known(item.outcome, 'memory a note went into');
        if (!writing.has(item.outcome) && !await held(item.outcome)) throw new Refused('NotFound', `There is no memory ${item.outcome} for note ${item.id} to go into`);
        targets.set(item.outcome, (targets.get(item.outcome) ?? 0) + 1);
      }
      if (changes.some(change => !targets.has(change?.memory?.name))) throw new Refused('InvalidRequest', 'Each rewritten memory must be where at least one of these notes went');
      // Each memory as it will be, checked before anything is written.
      const when = now().toISOString();
      const planned = [];
      for (const [name, count] of targets) {
        const live = await held(name);
        const change = changes.find(item => item.memory.name === name);
        let memory;
        if (change) {
          if ((live?.version ?? null) !== (change.version ?? null)) {
            if (live && change.version === undefined) throw new Refused('NameTaken', 'A memory already has this name. Read it and name its version to replace it.', { name, current: live.version });
            throw changed('memory', live?.version ?? null);
          }
          memory = await memoryFor(change.memory, live);
        } else memory = { ...live.memory };
        memory.seen = { count: (memory.seen?.count ?? 0) + count, last: when };
        planned.push({ name, live, memory, count, rewritten: Boolean(change) });
      }
      const memories = [];
      for (const { name, live, memory, count, rewritten } of planned) {
        const done = await edit(nodeOf(`memory/${name}`), live ? 'update' : 'create', memoryFile(memory), { before: live?.version ?? null, reason: `${rewritten ? 'rewritten, and ' : ''}seen again in ${count} settled note${count === 1 ? '' : 's'}`, evidence: memory.evidence });
        memories.push({ name, ...done, seen: memory.seen });
      }
      for (const item of outcomes) await journal.append(actor, 'settled', { note: item.id, outcome: item.outcome });
      const remaining = (await cortex.listNotes()).notes;
      return { settled: outcomes.length, memories, remaining, complete: remaining.length === 0 };
    },

    listSkills: () => skillsIn(at('skills')),

    async getSkill(name) {
      const found = await skillAt(at('skills', known(name, 'skill')));
      if (found) return { skill: found.skill, version: found.version };
      if (await skillAt(at('.cortex', 'proposed', 'skills', name))) throw new Refused('SkillNotApproved', 'This skill is waiting for the person to approve it, and is not used before');
      throw new Refused('NotFound', 'There is no such skill');
    },

    // A skill, whole: SKILL.md and the files beside it. It is kept apart from skills/, so nothing
    // reads it as a skill until the person approves it. It changes no node, so it is not a change.
    async proposeSkill({ text: content, files = [] } = {}) {
      const { properties, found } = splitFront(typeof content === 'string' ? content : '');
      if (!found || typeof properties.name !== 'string' || !NAME.test(properties.name) || properties.name.length > 100) throw new Refused('InvalidSkill', 'SKILL.md starts with a lowercase, hyphenated name between --- lines');
      if (typeof properties.description !== 'string' || !properties.description.trim()) throw new Refused('InvalidSkill', 'SKILL.md needs a one-line description');
      if (bytes(content) > 65536 || !Array.isArray(files) || files.length > 20) throw new Refused('InvalidSkill', 'A skill is at most 64 KB, with at most 20 files beside it');
      for (const file of files) {
        const path = typeof file?.path === 'string' ? normalize(file.path) : '';
        if (!path || path.startsWith('..') || path.startsWith(sep) || path.split(sep).some(part => part.startsWith('.')) || path === 'SKILL.md' || typeof file.text !== 'string' || bytes(file.text) > 65536) throw new Refused('InvalidSkill', 'Each file beside a skill has a path inside its folder and text of at most 64 KB');
      }
      const root = at('.cortex', 'proposed', 'skills', properties.name);
      await rm(root, { recursive: true, force: true });
      await put(join(root, 'SKILL.md'), content);
      for (const file of files) await put(join(root, normalize(file.path)), file.text);
      await put(join(root, '.proposal.json'), JSON.stringify({ by: actor, when: now().toISOString() }));
      return { name: properties.name, version: (await skillAt(root)).version, approved: false };
    },

    // Only the person does this. The skill moves into skills/, whole; the one it replaces is kept,
    // and the change is the person's, naming the agent that proposed it.
    async approveSkill(name) {
      onlyPerson('approves a skill');
      const root = at('.cortex', 'proposed', 'skills', known(name, 'skill'));
      const proposed = await skillAt(root);
      if (!proposed) throw new Refused('NotFound', 'No skill of that name is waiting');
      let by;
      try { by = JSON.parse(await text(join(root, '.proposal.json')) ?? 'null')?.by; } catch {}
      const spec = nodeOf(`skill/${name}`);
      const live = await spec.live();
      if (live) await keep(...spec.kept, encode(spec, live.content), live.version);
      await rm(join(root, '.proposal.json'), { force: true });
      await rm(at('skills', name), { recursive: true, force: true });
      await mkdir(at('skills'), { recursive: true });
      await rename(root, at('skills', name));
      const after = (await spec.live()).version;
      const line = await journal.append(actor, 'change', { node: spec.node, op: live ? 'update' : 'create', before: live?.version ?? null, after, reason: 'approved', ...(typeof by === 'string' && by ? { proposedBy: by } : {}) });
      return { name, approved: true, version: after, change: line.id };
    },

    listTools: () => toolsIn(at('tools')),

    // A proposed tool does nothing and cannot be switched on. It is a request for one to be built,
    // kept in .cortex/proposed/tools/ until the person builds it and adds it to tools/.
    async proposeTool({ name, description, inputs, outputs } = {}) {
      known(name, 'tool');
      for (const [field, value] of Object.entries({ description, inputs, outputs })) {
        if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Refused('InvalidRequest', `${field} is text, at most 2,000 characters`);
      }
      if (await text(at('tools', `${name}.md`)) !== null) throw new Refused('NameTaken', 'A tool already has this name');
      await put(at('.cortex', 'proposed', 'tools', `${name}.md`), writeFront({ name, description, on: false, proposedBy: actor }, `## Takes\n\n${inputs}\n\n## Gives\n\n${outputs}\n`));
      return { name, proposed: true };
    },
  };

  async function putWorking(textGiven, replaces, { keepEarlier = false } = {}) {
    if (typeof textGiven !== 'string' || bytes(textGiven) > 8192) throw new Refused('InvalidRequest', 'Working memory is Markdown, at most 8 KB');
    const spec = nodeOf(`working/${fileName(actor)}`);
    const held = await workingOf(actor);
    if (held && held.text === textGiven) return { agent: held.agent, version: held.version, unchanged: true };
    if (held && replaces !== held.version) throw changed('working memory', held.version);
    if (held && keepEarlier) await keep('working', held.agent, held.text, held.version);
    // Empty is cleared: the file goes, so other agents see nothing rather than a blank entry.
    if (!textGiven.trim()) {
      if (!held) return { agent: fileName(actor), version: null, unchanged: true };
      if (!keepEarlier) await keep('working', held.agent, held.text, held.version);
      await rm(workingPath(actor));
      await journal.append(actor, 'change', { node: spec.node, op: 'remove', before: held.version, after: null });
      return { agent: fileName(actor), version: null, cleared: true };
    }
    // Rewrites within a session are not kept; what a distill replaces is.
    await put(workingPath(actor), textGiven);
    const { version } = await workingOf(actor);
    await journal.append(actor, 'change', { node: spec.node, op: held ? 'update' : 'create', before: held?.version ?? null, after: version });
    return { agent: fileName(actor), version };
  }

  return cortex;
}

// A cortex kept as a folder. The files are the cortex: what a person reads and edits by hand is
// what an agent is given, and nothing here holds a second copy.
//
//   agents/  identity.md  memory/  skills/  tools/      what is in force
//   .cortex/                                             what is waiting, and what was replaced
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { checkField, checkSource, FIELDS, forAgent, IDENTITY, proposalForAgent, readIdentity, shownValue, statesValue, writeIdentity } from './identity.mjs';
import { sectionOf, vaultFrom } from './vault.mjs';
import { checkWords, gone, parseMap, writeMap } from './vaultmap.mjs';
import { createHash } from 'node:crypto';
import { cleanMemory, cortexVersion, InvalidMemory, KINDS, memoryFile, memoryVersion, NAME, readMemoryFile, Refused, splitFront, writeFront } from './core.mjs';

const bytes = text => new TextEncoder().encode(text).length;
const missing = problem => problem?.code === 'ENOENT' || problem?.code === 'ENOTDIR';
const text = path => readFile(path, 'utf8').catch(problem => { if (missing(problem)) return null; throw problem; });
const names = path => readdir(path, { withFileTypes: true }).catch(problem => { if (missing(problem)) return []; throw problem; });
const changed = (what, current) => new Refused('Changed', `The ${what} has changed since the version this request names. Read it again.`, { current });
const known = (name, what = 'memory') => {
  if (typeof name !== 'string' || name.length > 100 || !NAME.test(name)) throw new Refused('InvalidRequest', `Say which ${what} with its lowercase, hyphenated name`);
  return name;
};

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, content);
  await rename(partial, path);
}

// What makes a note a note. Checked before anything is written, so a batch is refused whole.
function checkNote({ id, note, session, project } = {}) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Refused('InvalidRequest', 'A note has an ID made where it was seen, at most 200 characters');
  if (typeof note !== 'string' || !note.trim() || [...note].length > 500 || /[\r\n]/.test(note)) throw new Refused('InvalidRequest', `A note is one line, at most 500 characters${typeof id === 'string' ? ` (${id})` : ''}`);
  if (typeof session !== 'string' || !session || session.length > 200) throw new Refused('InvalidRequest', 'A note names the session it was seen in');
  if (project !== undefined && (typeof project !== 'string' || project.length > 2000)) throw new Refused('InvalidRequest', 'project is text, at most 2,000 characters');
}

// Names that mean the person, or the signed-in account. An agent never writes under one of them.
export const RESERVED = ['member', 'account'];
export const agentName = given => {
  const name = typeof given === 'string' && given.trim() ? given.trim().slice(0, 100) : 'agent';
  return RESERVED.includes(name.toLowerCase()) ? `agent:${name}` : name;
};

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
  const memoryPath = name => at('memory', `${name}.md`);

  // Every replaced or removed file is kept, named by when it was replaced and the version it was.
  async function keep(kind, name, content, version) {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    await put(at('.cortex', 'history', kind, name, `${stamp}_${version}.md`), content);
  }
  const earlier = async (kind, name) => (await names(at('.cortex', 'history', kind, name)))
    .map(entry => entry.name).filter(file => file.endsWith('.md')).sort().reverse()
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

  // Observations and host events are one append-only log. A line records a note, or what became of one.
  const log = at('.cortex', 'notes.jsonl');
  async function notes() {
    const found = new Map();
    for (const line of ((await text(log)) ?? '').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === 'note') found.set(entry.id, { id: entry.id, text: entry.text, session: entry.session, ...(entry.project ? { project: entry.project } : {}), source: entry.source, writtenBy: entry.writtenBy, when: entry.when });
      else if (entry.type === 'settled' && found.has(entry.id)) Object.assign(found.get(entry.id), { outcome: entry.outcome, settledAt: entry.when });
    }
    return found;
  }
  const record = async entry => { await mkdir(dirname(log), { recursive: true }); await appendFile(log, `${JSON.stringify(entry)}\n`); };

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
  const meaningsLog = at('.cortex', 'vault-meanings.jsonl');
  async function agentWords() {
    const last = new Map();
    for (const line of ((await text(meaningsLog)) ?? '').split('\n')) {
      if (!line.trim()) continue;
      try { const entry = JSON.parse(line); last.set(`${entry.section}\u0000${entry.field}`, entry.text); } catch {}
    }
    return last;
  }

  const identityLog = at('.cortex', 'identity.jsonl');
  const factKey = (field, value) => JSON.stringify([field, value ?? null]);
  const recordIdentity = async entry => {
    await mkdir(dirname(identityLog), { recursive: true });
    await appendFile(identityLog, `${JSON.stringify({ ...entry, by: actor, when: now().toISOString() })}\n`);
  };
  // Changes one field of identity.md and keeps the rest of the file, the person's own fields and
  // anything they wrote that cannot be read, as it was. The earlier file is kept in history.
  async function setField(field, value) {
    const content = await text(at('identity.md')) ?? '';
    const { properties, body, version } = await readIdentity(content);
    const next = { ...properties };
    if (value === undefined) delete next[field]; else next[field] = value;
    if (content) await keep('identity', 'identity', content, version);
    await put(at('identity.md'), writeIdentity(next, body));
  }
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
  async function putWorking(textGiven, replaces, { keepEarlier = false } = {}) {
    if (typeof textGiven !== 'string' || bytes(textGiven) > 8192) throw new Refused('InvalidRequest', 'Working memory is Markdown, at most 8 KB');
    const held = await workingOf(actor);
    if (held && held.text === textGiven) return { agent: held.agent, version: held.version, unchanged: true };
    if (held && replaces !== held.version) throw changed('working memory', held.version);
    if (held && keepEarlier) await keep('working', held.agent, held.text, held.version);
    // Empty is cleared: the file goes, so other agents see nothing rather than a blank entry.
    if (!textGiven.trim()) {
      if (!held) return { agent: fileName(actor), version: null, unchanged: true };
      if (!keepEarlier) await keep('working', held.agent, held.text, held.version);
      await rm(workingPath(actor));
      return { agent: fileName(actor), version: null, cleared: true };
    }
    await put(workingPath(actor), textGiven);
    return { agent: fileName(actor), version: (await workingOf(actor)).version };
  }

  const cortex = {
    dir, reindex,

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
      }
      const recorded = [];
      for (const item of seen) recorded.push(await cortex.addNote({ id: item.id, note: item.note, session, ...(item.project ? { project: item.project } : {}) }));
      const left = await putWorking(working, held?.version ?? null, { keepEarlier: true });
      // The model does not know the client's session ID, so a distill is recorded by agent, time and
      // the version of working memory it left. The stop hook asks whether the working memory it sees
      // is one a distill left, since its session started.
      // The notes and working memory are already saved, so a failed record never fails the distill.
      const sessions = at('.cortex', 'sessions.jsonl');
      try {
        await mkdir(dirname(sessions), { recursive: true });
        await appendFile(sessions, `${JSON.stringify({ agent: actor, distilled: now().toISOString(), version: left.version ?? null })}\n`);
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
            const map = parseMap(await text(at('vault.md')), new Set(shape.sections.map(item => item.section)));
            const { memories } = await all();
            const pointed = memories.flatMap(({ memory }) => memory.posts ?? []);
            const where = pointed.length ? await connected.exists(pointed) : {};
            vault = { connected: true, sections: shape.sections.map(item => ({ ...item, meaning: map.get(item.section)?.meaning, conventions: map.get(item.section)?.conventions })), gone: gone(shape, map), broken: memories.flatMap(({ memory }) => (memory.posts ?? []).filter(id => !where[id]?.exists).map(post => ({ memory: memory.name, post }))), problems: shape.problems };
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
        vault: vault.connected && vault.reachable !== false ? { connected: true, sections: vault.sections, ...(vault.broken.length ? { broken: vault.broken } : {}), ...(vault.gone?.length ? { gone: vault.gone } : {}) } : { connected: vault.connected, ...(vault.reachable === false ? { reachable: false } : {}) },
        always: memories.filter(({ memory }) => memory.always),
        memories: memories.filter(({ memory }) => !memory.always).map(({ memory: { name, description, kind } }) => ({ name, description, kind })),
        // Only what the person has approved or switched on is handed over as usable.
        skills: (await skillsIn(at('skills'))).map(({ name, description }) => ({ name, description })),
        tools: (await toolsIn(at('tools'))).filter(tool => tool.on).map(({ name, description }) => ({ name, description })),
        notes: pending,
        working: await cortex.working(),
        waiting: {
          identity: (await cortex.identityProposals()).map(proposalForAgent),
          skills: (await skillsIn(at('.cortex', 'proposed', 'skills'))).map(skill => skill.name),
          tools: (await toolsIn(at('.cortex', 'proposed', 'tools'))).map(tool => tool.name),
        },
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

    // Brings the cortex in step with the vault: the structure and counts in vault.md, notes for the
    // changes an agent has to act on, and the memories that point at posts no longer there.
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
      const known = new Set(shape.sections.map(item => item.section));
      const written = parseMap(content, known);
      const next = writeMap(shape, written);
      if (next !== content) await put(at('vault.md'), next);

      const { memories } = await all();
      const pointing = id => memories.filter(({ memory }) => memory.posts?.includes(id)).map(({ memory }) => memory.name);
      const noted = [];
      const note = async (key, line) => {
        const id = `vault-${short(key)}`;
        if (!(await notes()).has(id)) { await record({ type: 'note', id, text: line.slice(0, 500), session: 'vault', source: 'vault', writtenBy: 'vault', when: now().toISOString() }); noted.push(id); }
      };
      // Only what an agent has to act on becomes a note. A post saved in a known section needs nothing.
      for (const change of changes) {
        const names = pointing(change.id);
        if (change.type === 'removed' && names.length) await note([change.type, change.id], `Post "${change.title}" (${change.id}) was removed from ${sectionOf(change)}. These memories pointed at it: ${names.join(', ')}`);
        if (change.type === 'moved' && names.length) await note([change.type, change.id, sectionOf(change)], `Post "${change.title}" (${change.id}) moved from ${change.from} to ${sectionOf(change)}. These memories point at it: ${names.join(', ')}`);
      }
      for (const { section } of shape.sections) if (!written.has(section)) await note(['section', section], `The vault has a section, ${section}, that vault.md does not describe yet`);
      for (const key of gone(shape, written)) await note(['gone', key], `The section ${key} is no longer in the vault. What vault.md said about it is kept`);

      const pointed = memories.flatMap(({ memory }) => memory.posts ?? []);
      const where = pointed.length ? await vault.exists(pointed) : {};
      const broken = memories.flatMap(({ memory }) => (memory.posts ?? []).filter(id => !where[id]?.exists).map(id => ({ memory: memory.name, post: id })));
      if (JSON.stringify(before) !== JSON.stringify(cursor)) await put(cursorPath, JSON.stringify(cursor));
      const map = parseMap(next, known);
      return {
        connected: true,
        sections: shape.sections.map(({ section, posts }) => ({ section, posts, ...(map.get(section)?.meaning ? { meaning: map.get(section).meaning } : {}), ...(map.get(section)?.conventions ? { conventions: map.get(section).conventions } : {}) })),
        changes: changes.length, noted, broken, gone: gone(shape, map), ...(shape.problems?.length ? { problems: shape.problems } : {}),
      };
    },

    // The agent writes what a section means and how posts there are filed, without asking. Once the
    // person has written over it by hand, theirs stands, and the agent's write is refused.
    async describeSection({ section, meaning, conventions } = {}) {
      const vault = await theVault();
      if (!vault) throw new Refused('NoVault', 'No vault is connected to this cortex');
      const shape = await vault.shape();
      const content = await text(at('vault.md'));
      const written = parseMap(content, new Set(shape.sections.map(item => item.section)));
      if (typeof section !== 'string' || !section || (!shape.sections.some(item => item.section === section) && !written.has(section))) throw new Refused('NotFound', `There is no section ${section} in the vault`);
      const given = Object.entries({ meaning, conventions }).filter(([, value]) => value !== undefined);
      if (!given.length) throw new Refused('InvalidRequest', 'Give a meaning, conventions, or both');
      const words = written.get(section) ?? { meaning: '', conventions: '', extra: [] };
      const last = await agentWords();
      const changes = [];
      for (const [field, value] of given) {
        const checked = checkWords(field, value);
        const current = words[field];
        if (current && current !== last.get(`${section}\u0000${field}`)) throw new Refused('PersonWrote', `The person wrote the ${field} of ${section} themselves, and what they wrote stands. Suggest a change to them instead`, { current });
        if (current !== checked) changes.push([field, checked]);
      }
      if (!changes.length) return { section, unchanged: true };
      for (const [field, value] of changes) words[field] = value;
      written.set(section, words);
      if (content) await keep('vault-map', 'vault', content, short(content));
      await put(at('vault.md'), writeMap(shape, written));
      await mkdir(dirname(meaningsLog), { recursive: true });
      for (const [field, value] of changes) await appendFile(meaningsLog, `${JSON.stringify({ section, field, text: value, by: actor, when: now().toISOString() })}\n`);
      return { section, ...Object.fromEntries(changes) };
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

    // An agent proposes. Nothing it proposes changes identity.md until the person confirms it.
    async proposeIdentity({ field, value, source } = {}) {
      if (!Object.hasOwn(IDENTITY, field)) throw new Refused('InvalidIdentity', `${field} is not an identity field. The fields are: ${FIELDS.join(', ')}`);
      const evidence = checkSource(field, source);
      const checked = checkField(field, value);
      if (!statesValue(field, checked, evidence.quote ?? evidence.passage)) throw new Refused('NoEvidence', `The ${evidence.kind === 'person' ? 'quote' : 'passage'} does not say ${JSON.stringify(checked)}. Quote where it is stated`);
      // With a vault connected, the post must be there and must say what is quoted from it.
      if (evidence.kind === 'vault') {
        const vault = await theVault();
        if (vault) {
          const post = await vault.read(evidence.post);
          if (!post) throw new Refused('NoEvidence', `There is no post ${evidence.post} in the vault`);
          const plain = words => words.toLowerCase().replace(/\s+/g, ' ').trim();
          if (!plain(`${post.title}\n${post.body}`).includes(plain(evidence.passage))) throw new Refused('NoEvidence', `Post ${evidence.post} does not say what is quoted from it. Quote the passage as it is written`);
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
    async confirmIdentity(ref) {
      const proposal = await waitingFor(ref);
      await setField(proposal.field, proposal.value);
      await recordIdentity({ type: 'confirmed', id: proposal.id, field: proposal.field, value: proposal.value, source: proposal.source });
      return { id: proposal.id, field: proposal.field, value: proposal.value, confirmed: true };
    },

    async rejectIdentity(ref) {
      const proposal = await waitingFor(ref);
      await recordIdentity({ type: 'rejected', id: proposal.id, field: proposal.field, value: proposal.value });
      return { id: proposal.id, field: proposal.field, rejected: true };
    },

    async clearIdentity(field) {
      if (!Object.hasOwn(IDENTITY, field)) throw new Refused('InvalidIdentity', `${field} is not an identity field`);
      const { properties } = await cortex.identity();
      if (properties[field] === undefined) return { field, cleared: true, unchanged: true };
      await setField(field, undefined);
      await recordIdentity({ type: 'cleared', field });
      return { field, cleared: true };
    },

    // The one field set without a proposal: it is what the signed-in account says it is.
    async setAccount(value) {
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

    async write(given, { replaces = null } = {}) {
      let memory;
      try { memory = cleanMemory(given); } catch (problem) {
        if (problem instanceof InvalidMemory) throw new Refused('InvalidMemory', problem.message);
        throw problem;
      }
      const live = await held(memory.name);
      // Who wrote it and how often it was seen are kept by cortex, whatever the request says.
      memory.writtenBy = actor;
      memory.seen = live?.memory.seen ?? { count: 0, last: null };
      if (memory.notes) {
        const kept = await notes();
        if (memory.notes.some(id => !kept.has(id))) throw new Refused('InvalidMemory', 'A source note must be one recorded in this cortex');
      }
      const version = await memoryVersion(memory);
      if (live?.version === version) return { name: memory.name, version, unchanged: true };
      if (live && replaces === null) throw new Refused('NameTaken', 'A memory already has this name. Read it and name its version to replace it.', { name: memory.name, current: live.version });
      if ((live?.version ?? null) !== replaces) throw changed('memory', live?.version ?? null);
      if (live) await keep('memory', memory.name, live.content, live.version);
      await put(memoryPath(memory.name), memoryFile(memory));
      await reindex();
      return { name: memory.name, version };
    },

    async remove(name, { replaces = null } = {}) {
      const live = await held(known(name));
      if (!live) return { name, removed: true, unchanged: true };
      if (live.version !== replaces) throw changed('memory', live.version);
      await keep('memory', name, live.content, live.version);
      await rm(memoryPath(name));
      await reindex();
      return { name, removed: true };
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
    async addNote({ id, note, session, project, source } = {}) {
      checkNote({ id, note, session, project });
      const before = (await notes()).get(id);
      if (before) {
        if (before.text !== note) throw new Refused('Changed', 'Another note already has this ID');
        return { id, unchanged: true };
      }
      await record({ type: 'note', id, text: note, session, ...(project ? { project } : {}), source: source ?? actor, writtenBy: actor, when: now().toISOString() });
      return { id };
    },

    async listNotes({ settled = false } = {}) {
      return { notes: [...(await notes()).values()].filter(note => settled || !note.settledAt) };
    },

    // Rewrites memory from the notes and says what became of each one. Every outcome is checked
    // before anything is written, so a refused batch leaves the cortex as it was.
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
      const written = [];
      for (const change of changes) written.push(await cortex.write(change.memory, { replaces: change.version ?? null }));
      const when = now().toISOString();
      for (const [name, count] of targets) {
        const live = await held(name);
        const memory = { ...live.memory, seen: { count: (live.memory.seen?.count ?? 0) + count, last: when } };
        await put(memoryPath(name), memoryFile(memory));
      }
      for (const item of outcomes) await record({ type: 'settled', id: item.id, outcome: item.outcome, when });
      const memories = [];
      for (const name of targets.keys()) { const { memory, version } = await held(name); memories.push({ name, version, seen: memory.seen }); }
      const remaining = (await cortex.listNotes()).notes;
      return { settled: outcomes.length, written, memories, remaining, complete: remaining.length === 0 };
    },

    listSkills: () => skillsIn(at('skills')),

    async getSkill(name) {
      const found = await skillAt(at('skills', known(name, 'skill')));
      if (found) return { skill: found.skill, version: found.version };
      if (await skillAt(at('.cortex', 'proposed', 'skills', name))) throw new Refused('SkillNotApproved', 'This skill is waiting for the person to approve it, and is not used before');
      throw new Refused('NotFound', 'There is no such skill');
    },

    // A proposal is kept apart from skills/, so nothing reads it as a skill until it is approved.
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

    // Only the person does this. No tool an agent is given reaches it.
    async approveSkill(name) {
      const root = at('.cortex', 'proposed', 'skills', known(name, 'skill'));
      const proposed = await skillAt(root);
      if (!proposed) throw new Refused('NotFound', 'No skill of that name is waiting');
      const live = await skillAt(at('skills', name));
      if (live) await keep('skills', name, live.skill.text, live.version);
      await rm(join(root, '.proposal.json'), { force: true });
      await rm(at('skills', name), { recursive: true, force: true });
      await mkdir(at('skills'), { recursive: true });
      await rename(root, at('skills', name));
      return { name, approved: true, version: proposed.version };
    },

    listTools: () => toolsIn(at('tools')),

    // A proposed tool does nothing and cannot be switched on. It is a request for one to be built.
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
  return cortex;
}

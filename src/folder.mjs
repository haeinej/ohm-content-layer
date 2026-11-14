// A cortex kept as a folder. The files are the cortex: what a person reads and edits by hand is
// what an agent is given, and nothing here holds a second copy.
//
//   agents/  identity.md  memory/  skills/  tools/      what is in force
//   .cortex/                                             what is waiting, and what was replaced
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { checkField, checkSource, FIELDS, IDENTITY, readIdentity, writeIdentity } from './identity.mjs';
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

// A new cortex is a copy of the template. An existing one is never written over.
export async function initCortex(dir, template, { account } = {}) {
  if ((await names(dir)).some(entry => !entry.name.startsWith('.'))) throw new Refused('NameTaken', `${dir} already holds files. A cortex is started in an empty folder.`);
  await cp(template, dir, { recursive: true, filter: source => !source.endsWith('.gitkeep') });
  for (const folder of ['agents/secrets', 'memory', 'skills', 'tools', '.cortex']) await mkdir(join(dir, folder), { recursive: true });
  const cortex = openCortex(dir, { actor: 'account' });
  if (account !== undefined) await cortex.setAccount(account);
  await cortex.reindex();
  return { dir };
}

export function openCortex(dir, { actor = 'member', now = () => new Date() } = {}) {
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

  const identityLog = at('.cortex', 'identity.jsonl');
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
    const byId = waiting.find(proposal => proposal.id === ref);
    if (byId) return byId;
    const forField = waiting.filter(proposal => proposal.field === ref);
    if (forField.length === 1) return forField[0];
    if (forField.length > 1) throw new Refused('Ambiguous', `More than one proposal is waiting for ${ref}. Name one by its ID: ${forField.map(proposal => `${proposal.id} (${JSON.stringify(proposal.value)})`).join(', ')}`);
    throw new Refused('NotFound', `No identity proposal is waiting for ${ref}`);
  }

  const cortex = {
    dir, reindex,

    async start() {
      await reindex();
      const { memories, problems } = await all();
      const { fields, own, about, problems: identityProblems } = await cortex.identity();
      const pending = [...(await notes()).values()].filter(note => !note.settledAt);
      const found = [...identityProblems, ...problems];
      return {
        rules: await text(at('agents', 'AGENTS.md')) ?? '',
        identity: { ...fields, ...(Object.keys(own).length ? { own } : {}), about },
        always: memories.filter(({ memory }) => memory.always),
        memories: memories.filter(({ memory }) => !memory.always).map(({ memory: { name, description, kind } }) => ({ name, description, kind })),
        // Only what the person has approved or switched on is handed over as usable.
        skills: (await skillsIn(at('skills'))).map(({ name, description }) => ({ name, description })),
        tools: (await toolsIn(at('tools'))).filter(tool => tool.on).map(({ name, description }) => ({ name, description })),
        notes: pending,
        waiting: {
          identity: (await cortex.identityProposals()).map(({ id, field, value, source }) => ({ id, field, value, source })),
          skills: (await skillsIn(at('.cortex', 'proposed', 'skills'))).map(skill => skill.name),
          tools: (await toolsIn(at('.cortex', 'proposed', 'tools'))).map(tool => tool.name),
        },
        ...(found.length ? { problems: found } : {}),
      };
    },

    identity: async () => readIdentity(await text(at('identity.md'))),

    // Every proposal, confirmation, rejection and clearing, in the order it happened.
    async identityLog() {
      return ((await text(identityLog)) ?? '').split('\n').filter(Boolean).flatMap(entry => { try { return [JSON.parse(entry)]; } catch { return []; } });
    },

    async identityProposals() {
      // Read in order, so a fact confirmed, cleared and then proposed again is waiting again.
      const waiting = new Map();
      for (const entry of await cortex.identityLog()) {
        if (entry.type === 'proposed') waiting.set(entry.id, entry);
        else if (entry.type === 'confirmed' || entry.type === 'rejected') waiting.delete(entry.id);
      }
      return [...waiting.values()];
    },

    // An agent proposes. Nothing it proposes changes identity.md until the person confirms it.
    async proposeIdentity({ field, value, source } = {}) {
      if (!Object.hasOwn(IDENTITY, field)) throw new Refused('InvalidIdentity', `${field} is not an identity field. The fields are: ${FIELDS.join(', ')}`);
      const evidence = checkSource(field, source);
      const checked = checkField(field, value);
      const id = `i${(await cortexVersion({ field, value: checked, source: evidence })).slice(1, 13)}`;
      const log = await cortex.identityLog();
      if (log.some(entry => entry.type === 'rejected' && entry.id === id)) throw new Refused('AlreadyRejected', 'The person already said no to this, from this same evidence. Do not propose it again');
      const { fields } = await cortex.identity();
      if (JSON.stringify(fields[field]) === JSON.stringify(checked)) return { id, field, confirmed: true, unchanged: true };
      if ((await cortex.identityProposals()).some(proposal => proposal.id === id)) return { id, field, waiting: true, unchanged: true };
      await recordIdentity({ type: 'proposed', id, field, value: checked, source: evidence });
      return { id, field, waiting: true, ...(fields[field] !== undefined ? { current: fields[field] } : {}) };
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
      await recordIdentity({ type: 'rejected', id: proposal.id, field: proposal.field });
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
      if (typeof id !== 'string' || !id || id.length > 200) throw new Refused('InvalidRequest', 'A note has an ID made where it was seen, at most 200 characters');
      if (typeof note !== 'string' || !note.trim() || [...note].length > 500 || /[\r\n]/.test(note)) throw new Refused('InvalidRequest', 'A note is one line, at most 500 characters');
      if (typeof session !== 'string' || !session || session.length > 200) throw new Refused('InvalidRequest', 'A note names the session it was seen in');
      if (project !== undefined && (typeof project !== 'string' || project.length > 2000)) throw new Refused('InvalidRequest', 'project is text, at most 2,000 characters');
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

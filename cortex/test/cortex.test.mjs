import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { memoryFile, readMemoryFile } from '../src/core.mjs';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createServer } from '../src/protocol.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';

const template = fileURLToPath(new URL('../template', import.meta.url));
const fresh = async (options = { actor: 'test-agent' }) => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return { dir, cortex: openCortex(dir, options) };
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;
const likes = { name: 'prefers-short-titles', description: 'Titles are four words or fewer', kind: 'preference', stated: true, body: 'Keep every title short.' };

test('a memory written as a file reads back the same', () => {
  const memory = { ...likes, always: true, writtenBy: 'someone', seen: { count: 2, last: '2026-01-01T00:00:00.000Z' } };
  assert.deepEqual(readMemoryFile(memoryFile(memory)), memory);
});

test('a new cortex has the rulebook, an identity, one starting memory and an index', async () => {
  const { dir, cortex } = await fresh();
  const start = await cortex.start();
  assert.match(start.rules, /How to keep this cortex/);
  assert.deepEqual(start.identity, { about: '' });
  assert.deepEqual(start.waiting.identity, []);
  assert.deepEqual(start.always.map(item => item.memory.name), ['working-style']);
  assert.deepEqual([start.memories, start.skills.map(skill => skill.name), start.tools, start.observations], [[], ['file-a-source'], [], []]);
  assert.match(await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8'), /\[working-style\]\(working-style\.md\)/);
  await assert.rejects(initCortex(dir, template), refused('NameTaken'));
});

test('secrets have one place, and git is told never to take them', async () => {
  const { dir, cortex } = await fresh();
  assert.deepEqual(await readdir(join(dir, 'agents')), ['AGENTS.md', 'secrets']);
  assert.deepEqual(await readdir(join(dir, 'agents', 'secrets')), []);
  assert.match((await cortex.start()).rules, /Never copy what a secret says/);
  await writeFile(join(dir, 'agents', 'secrets', 'calendar.key'), 'not-a-real-key');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  const tracked = git('ls-files').split('\n');
  assert.equal(tracked.some(file => file.startsWith('agents/secrets/')), false);
  assert.equal(['agents/AGENTS.md', '.gitignore', '.gitattributes', 'memory/working-style.md'].every(file => tracked.includes(file)), true);
  assert.match(git('check-attr', 'merge', '--', '.cortex/notes.jsonl'), /merge: union/);
});

test('a memory is one file, indexed, and a save names the version it replaces', async () => {
  const { dir, cortex } = await fresh();
  const saved = await cortex.write(likes);
  // An agent's memory is written at once, as a change marked with the agent.
  assert.deepEqual([saved.node, saved.op, typeof saved.change], ['memory/prefers-short-titles', 'create', 'string']);
  assert.equal(readMemoryFile(await readFile(join(dir, 'memory', 'prefers-short-titles.md'), 'utf8')).writtenBy, 'test-agent');
  assert.match(await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8'), /prefers-short-titles.*four words/);
  assert.equal((await cortex.write(likes)).unchanged, true);
  const longer = { ...likes, body: 'Keep every title short. Never use a colon.' };
  await assert.rejects(cortex.write(longer), refused('NameTaken'));
  await assert.rejects(cortex.write(longer, { replaces: 'cstale' }), refused('Changed'));
  const next = await cortex.write(longer, { replaces: saved.version });
  assert.notEqual(next.version, saved.version);
  // What was replaced is kept, and can be read back to restore.
  const read = await cortex.read(likes.name, { history: true });
  assert.deepEqual(read.earlier.map(item => item.version), [saved.version]);
  assert.equal((await cortex.read(likes.name, { version: saved.version })).memory.body, likes.body);
  assert.deepEqual((await cortex.search({ q: 'colon' })).memories.map(item => item.name), [likes.name]);
});

test('a file the person edited by hand is what the agent is given', async () => {
  const { dir, cortex } = await fresh();
  await writeFile(join(dir, 'memory', 'lives-in-seoul.md'), '---\nname: "lives-in-seoul"\ndescription: "Where they are"\nkind: "person"\nstated: true\n---\nSeoul.');
  await writeFile(join(dir, 'memory', 'broken.md'), 'no properties here');
  const start = await cortex.start();
  assert.deepEqual(start.memories.map(item => item.name), ['lives-in-seoul']);
  assert.equal(start.problems.length, 1);
  assert.match(await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8'), /lives-in-seoul/);
});

test('a removed memory is kept in history and gone from the index', async () => {
  const { dir, cortex } = await fresh();
  const { version } = await cortex.write(likes);
  await assert.rejects(cortex.remove(likes.name, { replaces: 'cstale' }), refused('Changed'));
  assert.equal((await cortex.remove(likes.name, { replaces: version })).removed, true);
  assert.doesNotMatch(await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8'), /prefers-short-titles/);
  assert.equal((await cortex.read(likes.name, { version })).memory.body, likes.body);
  await assert.rejects(cortex.read(likes.name), refused('NotFound'));
});

test('an observation changes no memory, is kept once, and is settled one way or another', async () => {
  const { cortex } = await fresh();
  const note = { id: 'n1', text: 'Asked for the reasoning behind a rejection', session: 's1' };
  assert.deepEqual(await cortex.observe(note), { id: 'n1' });
  assert.equal((await cortex.observe(note)).unchanged, true);
  await assert.rejects(cortex.observe({ ...note, text: 'Something else' }), refused('Changed'));
  await cortex.observe({ id: 'n2', text: 'Asked why again', session: 's2' });
  await cortex.observe({ id: 'n3', text: 'Was in a hurry today', session: 's2' });
  assert.equal((await cortex.start()).observations.length, 3);

  await assert.rejects(cortex.settle({ observations: [{ id: 'n1', outcome: 'no-such-memory' }] }), refused('NotFound'));
  assert.equal((await cortex.listObservations()).observations.length, 3);

  // Seen once: kept, and still there for a later session to count.
  await cortex.settle({ observations: [{ id: 'n1', outcome: 'kept' }] });
  const wants = { name: 'wants-the-reasoning', description: 'Show why, not only the answer', kind: 'preference', stated: false, body: 'Asked why in two sessions.', observations: ['n1', 'n2'] };
  const done = await cortex.settle({ changes: [{ memory: wants }], observations: [{ id: 'n1', outcome: wants.name }, { id: 'n2', outcome: wants.name }, { id: 'n3', outcome: 'dropped' }] });
  assert.equal(done.complete, true);
  assert.deepEqual([done.memories[0].seen.count, typeof done.memories[0].change], [2, 'string']);
  await assert.rejects(cortex.settle({ observations: [{ id: 'n3', outcome: 'kept' }] }), refused('Changed'));
  await assert.rejects(cortex.write({ ...likes, observations: ['never-recorded'] }), refused('InvalidMemory'));
});

test('a skill an agent wrote is not used until the person approves it', async () => {
  const { dir, cortex } = await fresh();
  const text = '---\nname: publish-an-essay\ndescription: The steps for publishing an essay\n---\n1. Check the title.\n';
  const proposed = await cortex.proposeSkill({ text, files: [{ path: 'checklist.md', text: 'Title, date.' }] });
  assert.equal(proposed.approved, false);
  assert.deepEqual(await readdir(join(dir, 'skills')), ['file-a-source']);
  await assert.rejects(cortex.getSkill('publish-an-essay'), refused('SkillNotApproved'));
  const start = await cortex.start();
  assert.deepEqual([start.skills.map(skill => skill.name), start.waiting.skills], [['file-a-source'], ['publish-an-essay']]);
  await assert.rejects(cortex.proposeSkill({ text, files: [{ path: '../outside.md', text: 'x' }] }), refused('InvalidSkill'));

  // Only the person approves.
  await assert.rejects(cortex.approveSkill('publish-an-essay'), refused('PersonOnly'));
  await openCortex(dir, { actor: 'member' }).approveSkill('publish-an-essay');
  const read = await cortex.getSkill('publish-an-essay');
  assert.equal(read.skill.text, text);
  assert.deepEqual(read.skill.files, [{ path: 'checklist.md', text: 'Title, date.' }]);
  const { skills } = await cortex.start();
  assert.deepEqual(skills.map(skill => skill.name), ['file-a-source', 'publish-an-essay']);
  assert.deepEqual(skills[1], { name: 'publish-an-essay', description: 'The steps for publishing an essay' });
});

test('an agent can ask for a tool, and cannot add one or switch one on', async () => {
  const { dir, cortex } = await fresh();
  await cortex.proposeTool({ name: 'calendar', description: 'Read the calendar', inputs: 'A date', outputs: 'Events' });
  assert.deepEqual((await cortex.start()).tools, []);
  assert.deepEqual(await readdir(join(dir, 'tools')), []);
  assert.deepEqual((await cortex.start()).waiting.tools, ['calendar']);
  assert.equal(TOOLS.some(tool => /approve|enable|put_tool/.test(tool.name)), false);
  // The person adds one by putting a file in tools/.
  await writeFile(join(dir, 'tools', 'calendar.md'), '---\nname: calendar\ndescription: Read the calendar\non: true\n---\n');
  await writeFile(join(dir, 'tools', 'mail.md'), '---\nname: mail\ndescription: Send mail\non: false\n---\n');
  assert.deepEqual((await cortex.start()).tools, [{ name: 'calendar', description: 'Read the calendar' }]);
  await assert.rejects(cortex.proposeTool({ name: 'calendar', description: 'x', inputs: 'x', outputs: 'x' }), refused('NameTaken'));
});

test('an agent keeps a cortex through the tools alone', async () => {
  const { cortex } = await fresh({ actor: 'claude-code' });
  let seen;
  const handle = createServer({ tools: createTools(cortex), list: TOOLS, instructions: INSTRUCTIONS, onClient: name => { seen = name; } });
  const ask = async (name, args = {}) => {
    const { result } = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return { ...result, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
  };
  const hello = await handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } });
  assert.match(hello.result.instructions, /cortex_start before anything else/);
  assert.equal(seen, 'claude-code');
  // Other tools are added over time; these are the ones this test relies on.
  const offered = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(tool => tool.name);
  for (const name of ['cortex_start', 'cortex_remember', 'cortex_recall', 'cortex_observe', 'cortex_settle', 'cortex_forget']) assert.ok(offered.includes(name), name);

  assert.match((await ask('cortex_start')).value.rules, /What you may not do/);
  const saved = (await ask('cortex_remember', { memory: likes })).value;
  assert.equal(saved.done, true);
  assert.equal((await ask('cortex_history', { node: `memory/${likes.name}` })).value.changes[0].id, saved.change);
  assert.equal((await ask('cortex_recall', { name: likes.name })).value.memory.writtenBy, 'claude-code');
  const clash = await ask('cortex_remember', { memory: { ...likes, body: 'Different.' } });
  assert.equal(clash.isError, true);
  assert.equal(JSON.parse(clash.value).current, saved.version);

  await ask('cortex_observe', { id: 'a', text: 'Rewrote my title to be shorter', session: 's1' });
  assert.equal((await ask('cortex_settle')).value.observations.length, 1);
  assert.equal((await ask('cortex_settle', { observations: [{ id: 'a', outcome: likes.name }] })).value.complete, true);

  const first = (await ask('cortex_forget', { name: likes.name })).value;
  assert.equal(first.done, false);
  assert.equal((await ask('cortex_forget', { name: likes.name, confirm: 'made-up' })).isError, true);
  // A confirmation is used once, and removes the version that was shown.
  assert.equal((await ask('cortex_forget', { name: likes.name, confirm: first.confirm })).value.done, true);
  assert.equal((await ask('cortex_forget', { name: likes.name, confirm: first.confirm })).isError, true);
  assert.equal((await ask('cortex_recall', { name: likes.name })).isError, true);
});

test('a memory written with notes, before observations were named, is read with observations', () => {
  const text = memoryFile({ name: 'short-titles', description: 'Wants short titles', kind: 'preference', stated: false, body: 'Short.', observations: ['n-1'] })
    .replace('observations:', 'notes:');
  assert.match(text, /^notes:/m);
  const memory = readMemoryFile(text);
  assert.deepEqual(memory.observations, ['n-1']);
  assert.equal(memory.notes, undefined);
});

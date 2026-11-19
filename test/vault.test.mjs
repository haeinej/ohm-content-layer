import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';
import { checkVault, folderVault } from '../src/vault.mjs';

// Every person and block here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const refused = code => problem => problem.code === code;
const writeBlock = async (root, path, { id, title, body = '' }) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\n${id ? `id: ${id}\n` : ''}${title ? `title: ${title}\n` : ''}---\n${body}`);
};
async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'cortex-vault-'));
  const vault = join(base, 'vault');
  await writeBlock(vault, 'essays/on-maps.md', { id: 'p1', title: 'On maps', body: 'I moved to Lisbon last spring and started drawing maps.' });
  await writeBlock(vault, 'essays/on-rivers.md', { id: 'p2', title: 'On rivers' });
  await writeBlock(vault, 'notes/reading/atlas.md', { id: 'p3', title: 'Reading: an atlas' });
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const person = openCortex(dir, { actor: 'member' });
  await person.connectVault({ kind: 'folder', path: vault });
  return { vault, dir, person, agent: openCortex(dir, { actor: 'claude-code' }) };
}
const map = dir => readFile(join(dir, 'vault.md'), 'utf8');

test('a folder vault answers the contract', async () => {
  const { vault } = await setup();
  await writeBlock(vault, 'loose.md', { title: 'A loose note' });
  const folder = folderVault(vault);
  assert.equal(checkVault(folder), folder);
  assert.throws(() => checkVault({ shape() {} }), refused('InvalidVault'));
  assert.deepEqual(await folder.shape(), { blocks: 4, channels: [{ channel: 'essays', blocks: 2 }, { channel: 'notes', blocks: 1 }, { channel: 'notes/reading', blocks: 1 }, { channel: 'other', blocks: 1 }] });
  assert.deepEqual(await folder.read('p3'), { id: 'p3', title: 'Reading: an atlas', channel: 'notes/reading', body: '' });
  assert.equal((await folder.read('path:loose.md')).channel, 'other');
  assert.deepEqual(await folder.exists(['p9', 'p1', 'p9']), { p9: { exists: false }, p1: { exists: true, title: 'On maps', channel: 'essays' } });

  const { changes: none, cursor } = await folder.changes(null);
  assert.deepEqual(none, []);
  await rename(join(vault, 'essays/on-rivers.md'), join(vault, 'notes/on-rivers.md'));
  await rm(join(vault, 'notes/reading/atlas.md'));
  await writeBlock(vault, 'essays/on-maps.md', { id: 'p1', title: 'On maps', body: 'Edited.' });
  await writeBlock(vault, 'essays/on-tides.md', { id: 'p4', title: 'On tides' });
  const { changes } = await folder.changes(cursor);
  assert.deepEqual(changes.map(change => [change.type, change.id, change.from]).sort(), [['moved', 'p2', 'essays'], ['removed', 'p3', undefined], ['saved', 'p1', undefined], ['saved', 'p4', undefined]].sort());
  await assert.rejects(folderVault(join(vault, 'missing')).shape(), refused('VaultUnreachable'));
});

test('connecting a vault writes vault.md, and asks the agent to describe each channel', async () => {
  const { dir, agent } = await setup();
  const text = await map(dir);
  assert.match(text, /^# How to read the vault/);
  assert.match(text, /## essays\n2 blocks\./);
  assert.match(text, /### notes\/reading\n1 block\./);
  const start = await agent.start();
  assert.deepEqual(start.vault.channels.map(channel => [channel.channel, channel.blocks]), [['essays', 2], ['notes', 1], ['notes/reading', 1]]);
  assert.deepEqual(start.notes.filter(note => note.source === 'vault').map(note => note.text).sort(), [
    'The vault has a channel, essays, that vault.md does not describe yet',
    'The vault has a channel, notes, that vault.md does not describe yet',
    'The vault has a channel, notes/reading, that vault.md does not describe yet',
  ]);
  // Asked again, nothing is noted twice.
  assert.equal((await agent.start()).notes.length, 3);
});

test('the agent describes a channel without asking, and what the person writes stands', async () => {
  const { dir, vault, agent, person } = await setup();
  const tools = createTools(agent);
  await tools.call('cortex_describe_channel', { channel: 'essays', meaning: 'Finished long-form writing, one idea each', conventions: 'Titles start with "On"' });
  assert.match(await map(dir), /## essays\n2 blocks\.\nMeaning: Finished long-form writing, one idea each\nConventions: Titles start with "On"/);
  assert.deepEqual((await agent.start()).vault.channels[0], { channel: 'essays', blocks: 2, meaning: 'Finished long-form writing, one idea each', conventions: 'Titles start with "On"' });
  // The agent may rewrite its own words.
  await agent.describeChannel({ channel: 'essays', meaning: 'Finished essays, one idea each' });
  assert.equal((await agent.describeChannel({ channel: 'essays', meaning: 'Finished essays, one idea each' })).unchanged, true);

  // The person writes over it by hand, and adds a line of their own.
  await writeFile(join(dir, 'vault.md'), (await map(dir)).replace('Meaning: Finished essays, one idea each', 'Meaning: Essays I am proud of\nOnly the ones I would show a stranger.').replace('-->\n', '-->\nMost of what matters is in essays.\n'));
  await assert.rejects(agent.describeChannel({ channel: 'essays', meaning: 'Something else' }), refused('PersonWrote'));
  await agent.describeChannel({ channel: 'essays', conventions: 'Titles start with "On", in sentence case' });

  // The counts follow the vault; the words stay.
  await writeBlock(vault, 'essays/on-tides.md', { id: 'p4', title: 'On tides' });
  await person.syncVault();
  const text = await map(dir);
  assert.match(text, /## essays\n3 blocks\.\nMeaning: Essays I am proud of\nConventions: Titles start with "On", in sentence case\nOnly the ones I would show a stranger\./);
  assert.match(text, /-->\n\nMost of what matters is in essays\.\n\n## essays/, 'what the person wrote above the channels is kept');
  assert.equal((await agent.start()).vault.channels.length, 3);
  await assert.rejects(agent.describeChannel({ channel: 'nowhere', meaning: 'x' }), refused('NotFound'));
  await assert.rejects(agent.describeChannel({ channel: '', meaning: 'x' }), refused('NotFound'));
  await assert.rejects(agent.describeChannel({ channel: 'notes', meaning: 'two\nlines' }), refused('InvalidRequest'));
});

test('removing a block flags the memory that pointed at it', async () => {
  const { vault, agent, person } = await setup();
  await agent.write({ name: 'map-essays', description: 'Where their essays about maps are', kind: 'reference', stated: false, body: 'Their essay on maps.', blocks: ['p1'] });
  await agent.write({ name: 'river-essay', description: 'Where the river essay is', kind: 'reference', stated: false, body: 'The river essay.', blocks: ['p2'] });
  assert.equal((await agent.start()).vault.broken, undefined);

  await rm(join(vault, 'essays/on-maps.md'));
  await rename(join(vault, 'essays/on-rivers.md'), join(vault, 'notes/on-rivers.md'));
  const start = await agent.start();
  assert.deepEqual(start.vault.broken, [{ memory: 'map-essays', block: 'p1' }]);
  const reported = start.notes.filter(note => note.source === 'vault').map(note => note.text);
  assert.ok(reported.includes('Block "On maps" (p1) was removed from essays. These memories pointed at it: map-essays'));
  assert.ok(reported.includes('Block "On rivers" (p2) moved from essays to notes. These memories point at it: river-essay'));
  assert.equal((await person.syncVault()).changes, 0, 'a change is reported once');
});

test('a channel that leaves the vault keeps what was written about it', async () => {
  const { dir, vault, agent } = await setup();
  await agent.describeChannel({ channel: 'notes/reading', meaning: 'Notes on books' });
  await rm(join(vault, 'notes'), { recursive: true });
  const start = await agent.start();
  assert.match(await map(dir), /### notes\/reading\nNot in the vault any more\.\nMeaning: Notes on books/);
  assert.ok(start.notes.some(note => note.text === 'The channel notes/reading is no longer in the vault. What vault.md said about it is kept'));
});

test('with a vault connected, identity evidence must be in the block it names', async () => {
  const { agent } = await setup();
  const propose = passage => agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'vault', block: 'p1', passage } });
  await assert.rejects(agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'vault', block: 'p9', passage: 'Lisbon' } }), refused('NoEvidence'));
  await assert.rejects(propose('I moved to Porto last spring'), refused('NoEvidence'));
  assert.equal((await propose('i moved to   Lisbon last spring')).waiting, true);
});

test('a memory points at blocks by ID, and keeps them when rewritten without them', async () => {
  const { agent } = await setup();
  await assert.rejects(agent.write({ name: 'bad', description: 'x', kind: 'reference', stated: false, body: 'x', blocks: [] }), refused('InvalidMemory'));
  await assert.rejects(agent.write({ name: 'bad', description: 'x', kind: 'reference', stated: false, body: 'x', blocks: ['p1', 'p1'] }), refused('InvalidMemory'));
  const tools = createTools(agent);
  const saved = await tools.call('cortex_remember', { memory: { name: 'map-essays', description: 'Where the map essays are', kind: 'reference', stated: false, body: 'One.', blocks: ['p1'] } });
  await tools.call('cortex_remember', { memory: { name: 'map-essays', description: 'Where the map essays are', kind: 'reference', stated: false, body: 'One essay.' }, version: saved.version });
  assert.deepEqual((await agent.read('map-essays')).memory.blocks, ['p1']);
});

test('the person connects a vault from the command line', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-cli-'));
  await writeBlock(join(base, 'vault'), 'essays/one.md', { id: 'p1', title: 'One' });
  const dir = join(base, 'cortex');
  execFileSync('node', [cli, 'init', dir]);
  assert.throws(() => execFileSync('node', [cli, 'vault', dir], { stdio: 'pipe' }), 'no vault is connected yet');
  assert.match(execFileSync('node', [cli, 'vault', 'connect', join(base, 'vault'), dir], { encoding: 'utf8' }), /1 channel$/m);
  assert.equal(JSON.parse(execFileSync('node', [cli, 'vault', 'sync', dir], { encoding: 'utf8' })).channels[0].channel, 'essays');
  assert.match(await readFile(join(dir, 'vault.md'), 'utf8'), /## essays\n1 block\./);
});

test('a heading the person writes in vault.md is kept as theirs', async () => {
  const { dir, agent } = await setup();
  await writeFile(join(dir, 'vault.md'), (await map(dir)).replace('## essays\n2 blocks.', '## essays\n2 blocks.\n### Examples\nThe best one is On maps.'));
  const start = await agent.start();
  assert.match(await map(dir), /## essays\n2 blocks\.\n### Examples\nThe best one is On maps\.\n\n## notes/);
  assert.equal(start.notes.some(note => /Examples/.test(note.text)), false);
  assert.deepEqual(start.vault.channels.map(channel => channel.channel), ['essays', 'notes', 'notes/reading']);
});

test('a damaged cursor is started again, and the machine-local files stay out of git', async () => {
  const { dir, agent } = await setup();
  await writeFile(join(dir, '.cortex', 'vault-cursor.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n');
  assert.equal((await agent.start()).vault.connected, true);
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, '.cortex', 'vault-cursor.json'), 'utf8')));
  await writeFile(join(dir, '.cortex', 'vault.json'), 'not json');
  const start = await openCortex(dir).start();
  assert.equal(start.vault.reachable, false);
  assert.match(start.problems.join(), /vault\.json cannot be read/);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  const tracked = git('ls-files');
  assert.doesNotMatch(tracked, /vault\.json|vault-cursor\.json/);
  assert.match(tracked, /vault\.md/);
});

test('two blocks with one ID: the first stands and the clash is reported', async () => {
  const { vault, agent } = await setup();
  await writeBlock(vault, 'notes/copy.md', { id: 'p1', title: 'A copy' });
  const start = await agent.start();
  assert.ok(start.problems.some(problem => /essays\/on-maps\.md and notes\/copy\.md have the same id, p1/.test(problem)), start.problems.join('\n'));
});

test('one session start reads the vault a fixed number of times, however many pointers there are', async () => {
  const { dir, vault, agent } = await setup();
  for (const name of ['ref-a', 'ref-b', 'ref-c', 'ref-d', 'ref-e', 'ref-f']) await agent.write({ name, description: 'x', kind: 'reference', stated: false, body: 'x', blocks: ['p1', 'p2'] });
  const real = folderVault(vault);
  let calls = 0;
  const counted = Object.fromEntries(Object.entries(real).map(([key, value]) => [key, typeof value === 'function' ? (...args) => { calls += 1; return value(...args); } : value]));
  await openCortex(dir, { vault: counted }).start();
  assert.equal(calls, 3);
});

test('cortex_describe_channel replaces cortex_describe_section, which still answers and is no longer listed', async () => {
  const { dir, agent } = await setup();
  const tools = createTools(agent);
  assert.ok(tools.list.some(tool => tool.name === 'cortex_describe_channel'));
  assert.equal(tools.list.some(tool => tool.name === 'cortex_describe_section'), false);
  assert.deepEqual(await tools.call('cortex_describe_section', { section: 'essays', meaning: 'Finished essays' }), { section: 'essays', meaning: 'Finished essays' });
  assert.match(await map(dir), /## essays\n2 blocks\.\nMeaning: Finished essays/);
  assert.equal((await tools.call('cortex_describe_section', { section: 'essays', meaning: 'Finished essays' })).unchanged, true);
  await assert.rejects(tools.call('cortex_describe_section', { section: 'nowhere', meaning: 'x' }), problem => JSON.parse(problem.message).error === 'NotFound');
  await assert.rejects(tools.call('cortex_describe_section', { meaning: 'x' }), refused('InvalidRequest'));
  // The folder's old name answers too.
  assert.deepEqual(await agent.describeSection({ section: 'notes', meaning: 'Short notes' }), { section: 'notes', meaning: 'Short notes' });
});

test('a cortex made before channels keeps its vault.md, memories, identity sources and cursor', async () => {
  const { dir, vault, person } = await setup();
  // vault.md as it was written before: the old header, counts in posts, and the agent's words logged by section.
  const old = [
    '# How to read the vault',
    '',
    '<!-- Kept by cortex. The count under each heading follows the vault and is rewritten. Meaning and Conventions are written by your agent: edit them freely, and what you write outranks what it wrote. Anything else you add under a heading is kept as you wrote it. -->',
    '',
    '## essays',
    '2 posts.',
    'Meaning: Finished essays',
    '',
    '## notes',
    '1 post.',
    '',
    '### notes/reading',
    '1 post.',
    '',
  ].join('\n');
  await writeFile(join(dir, 'vault.md'), old);
  await writeFile(join(dir, '.cortex', 'vault-meanings.jsonl'), `${JSON.stringify({ section: 'essays', field: 'meaning', text: 'Finished essays', by: 'claude-code', when: '2026-11-01T00:00:00.000Z' })}\n`);
  // A memory that points at blocks under the old name.
  await writeFile(join(dir, 'memory', 'map-essays.md'), '---\nname: "map-essays"\ndescription: "Where the map essays are"\nkind: "reference"\nstated: false\nposts: ["p1"]\n---\nOne.');
  // A cursor from before, naming places by label and sublabel.
  const cursor = JSON.parse(await readFile(join(dir, '.cortex', 'vault-cursor.json'), 'utf8'));
  cursor.p3 = { title: 'Reading: an atlas', label: 'notes', sublabel: 'reading', hash: cursor.p3.hash };
  delete cursor.p3.channel;
  await writeFile(join(dir, '.cortex', 'vault-cursor.json'), JSON.stringify(cursor));

  const agent = openCortex(dir, { actor: 'claude-code' });
  const start = await agent.start();
  const text = await map(dir);
  assert.match(text, /## essays\n2 blocks\.\nMeaning: Finished essays/);
  assert.equal(text.split('<!--').length, 2, 'the old header is not kept as the person\'s words');
  assert.deepEqual(start.vault.channels.map(channel => channel.channel), ['essays', 'notes', 'notes/reading']);
  // The agent's own words, logged by section, are still the agent's: it may rewrite them.
  await agent.describeChannel({ channel: 'essays', meaning: 'Finished essays, one idea each' });
  // The old memory reads with blocks, and a missing block is flagged.
  assert.deepEqual((await agent.read('map-essays')).memory.blocks, ['p1']);
  await rm(join(vault, 'essays/on-maps.md'));
  assert.deepEqual((await agent.start()).vault.broken, [{ memory: 'map-essays', block: 'p1' }]);
  // The old cursor's places are read; moving the atlas is a move, not a removal.
  await rename(join(vault, 'notes/reading/atlas.md'), join(vault, 'essays/atlas.md'));
  await agent.write({ name: 'atlas', description: 'Where the atlas note is', kind: 'reference', stated: false, body: 'x', blocks: ['p3'] });
  await writeFile(join(dir, '.cortex', 'vault-cursor.json'), JSON.stringify(cursor));
  const synced = await person.syncVault();
  assert.ok((await agent.listNotes()).notes.some(note => note.text.startsWith('Block "Reading: an atlas" (p3) moved from notes/reading to essays')), JSON.stringify(synced));
  // An identity source naming a post is taken, and kept as a block.
  const proposed = await agent.proposeIdentity({ field: 'organization', value: 'Tide Atlas', source: { kind: 'vault', post: 'p2', passage: 'Tide Atlas' } }).catch(problem => problem);
  assert.equal(proposed.code, 'NoEvidence', 'the passage is checked against the block, as before');
  await writeBlock(vault, 'essays/on-rivers.md', { id: 'p2', title: 'On rivers', body: 'I work at Tide Atlas.' });
  assert.equal((await openCortex(dir, { actor: 'claude-code' }).proposeIdentity({ field: 'organization', value: 'Tide Atlas', source: { kind: 'vault', post: 'p2', passage: 'I work at Tide Atlas' } })).waiting, true);
  assert.deepEqual((await person.identityProposals())[0].source, { kind: 'vault', block: 'p2', passage: 'I work at Tide Atlas' });
});

test('a client still sending posts on a memory has them kept as blocks', async () => {
  const { agent } = await setup();
  const tools = createTools(agent);
  await tools.call('cortex_remember', { memory: { name: 'map-essays', description: 'Where the map essays are', kind: 'reference', stated: false, body: 'One.', posts: ['p1'] } });
  const { memory } = await agent.read('map-essays');
  assert.deepEqual([memory.blocks, memory.posts], [['p1'], undefined]);
  await assert.rejects(agent.write({ name: 'both', description: 'x', kind: 'reference', stated: false, body: 'x', posts: ['p1'], blocks: ['p2'] }), refused('InvalidMemory'));
});

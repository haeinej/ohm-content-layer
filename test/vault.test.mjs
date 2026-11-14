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

// Every person and post here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const refused = code => problem => problem.code === code;
const writePost = async (root, path, { id, title, body = '' }) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\n${id ? `id: ${id}\n` : ''}${title ? `title: ${title}\n` : ''}---\n${body}`);
};
async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'cortex-vault-'));
  const vault = join(base, 'vault');
  await writePost(vault, 'essays/on-maps.md', { id: 'p1', title: 'On maps', body: 'I moved to Lisbon last spring and started drawing maps.' });
  await writePost(vault, 'essays/on-rivers.md', { id: 'p2', title: 'On rivers' });
  await writePost(vault, 'notes/reading/atlas.md', { id: 'p3', title: 'Reading: an atlas' });
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const person = openCortex(dir, { actor: 'member' });
  await person.connectVault({ kind: 'folder', path: vault });
  return { vault, dir, person, agent: openCortex(dir, { actor: 'claude-code' }) };
}
const map = dir => readFile(join(dir, 'vault.md'), 'utf8');

test('a folder vault answers the contract', async () => {
  const { vault } = await setup();
  await writePost(vault, 'loose.md', { title: 'A loose note' });
  const folder = folderVault(vault);
  assert.equal(checkVault(folder), folder);
  assert.throws(() => checkVault({ shape() {} }), refused('InvalidVault'));
  assert.deepEqual(await folder.shape(), { posts: 4, sections: [{ section: 'essays', posts: 2 }, { section: 'notes', posts: 1 }, { section: 'notes/reading', posts: 1 }, { section: 'other', posts: 1 }] });
  assert.deepEqual(await folder.read('p3'), { id: 'p3', title: 'Reading: an atlas', label: 'notes', sublabel: 'reading', body: '' });
  assert.equal((await folder.read('path:loose.md')).label, 'other');
  assert.deepEqual(await folder.exists(['p9', 'p1', 'p9']), { p9: { exists: false }, p1: { exists: true, title: 'On maps', label: 'essays' } });

  const { changes: none, cursor } = await folder.changes(null);
  assert.deepEqual(none, []);
  await rename(join(vault, 'essays/on-rivers.md'), join(vault, 'notes/on-rivers.md'));
  await rm(join(vault, 'notes/reading/atlas.md'));
  await writePost(vault, 'essays/on-maps.md', { id: 'p1', title: 'On maps', body: 'Edited.' });
  await writePost(vault, 'essays/on-tides.md', { id: 'p4', title: 'On tides' });
  const { changes } = await folder.changes(cursor);
  assert.deepEqual(changes.map(change => [change.type, change.id, change.from]).sort(), [['moved', 'p2', 'essays'], ['removed', 'p3', undefined], ['saved', 'p1', undefined], ['saved', 'p4', undefined]].sort());
  await assert.rejects(folderVault(join(vault, 'missing')).shape(), refused('VaultUnreachable'));
});

test('connecting a vault writes vault.md, and asks the agent to describe each section', async () => {
  const { dir, agent } = await setup();
  const text = await map(dir);
  assert.match(text, /^# How to read the vault/);
  assert.match(text, /## essays\n2 posts\./);
  assert.match(text, /### notes\/reading\n1 post\./);
  const start = await agent.start();
  assert.deepEqual(start.vault.sections.map(section => [section.section, section.posts]), [['essays', 2], ['notes', 1], ['notes/reading', 1]]);
  assert.deepEqual(start.notes.filter(note => note.source === 'vault').map(note => note.text).sort(), [
    'The vault has a section, essays, that vault.md does not describe yet',
    'The vault has a section, notes, that vault.md does not describe yet',
    'The vault has a section, notes/reading, that vault.md does not describe yet',
  ]);
  // Asked again, nothing is noted twice.
  assert.equal((await agent.start()).notes.length, 3);
});

test('the agent describes a section without asking, and what the person writes stands', async () => {
  const { dir, vault, agent, person } = await setup();
  const tools = createTools(agent);
  await tools.call('cortex_describe_section', { section: 'essays', meaning: 'Finished long-form writing, one idea each', conventions: 'Titles start with "On"' });
  assert.match(await map(dir), /## essays\n2 posts\.\nMeaning: Finished long-form writing, one idea each\nConventions: Titles start with "On"/);
  assert.deepEqual((await agent.start()).vault.sections[0], { section: 'essays', posts: 2, meaning: 'Finished long-form writing, one idea each', conventions: 'Titles start with "On"' });
  // The agent may rewrite its own words.
  await agent.describeSection({ section: 'essays', meaning: 'Finished essays, one idea each' });
  assert.equal((await agent.describeSection({ section: 'essays', meaning: 'Finished essays, one idea each' })).unchanged, true);

  // The person writes over it by hand, and adds a line of their own.
  await writeFile(join(dir, 'vault.md'), (await map(dir)).replace('Meaning: Finished essays, one idea each', 'Meaning: Essays I am proud of\nOnly the ones I would show a stranger.').replace('-->\n', '-->\nMost of what matters is in essays.\n'));
  await assert.rejects(agent.describeSection({ section: 'essays', meaning: 'Something else' }), refused('PersonWrote'));
  await agent.describeSection({ section: 'essays', conventions: 'Titles start with "On", in sentence case' });

  // The counts follow the vault; the words stay.
  await writePost(vault, 'essays/on-tides.md', { id: 'p4', title: 'On tides' });
  await person.syncVault();
  const text = await map(dir);
  assert.match(text, /## essays\n3 posts\.\nMeaning: Essays I am proud of\nConventions: Titles start with "On", in sentence case\nOnly the ones I would show a stranger\./);
  assert.match(text, /-->\n\nMost of what matters is in essays\.\n\n## essays/, 'what the person wrote above the sections is kept');
  assert.equal((await agent.start()).vault.sections.length, 3);
  await assert.rejects(agent.describeSection({ section: 'nowhere', meaning: 'x' }), refused('NotFound'));
  await assert.rejects(agent.describeSection({ section: '', meaning: 'x' }), refused('NotFound'));
  await assert.rejects(agent.describeSection({ section: 'notes', meaning: 'two\nlines' }), refused('InvalidRequest'));
});

test('removing a post flags the memory that pointed at it', async () => {
  const { vault, agent, person } = await setup();
  await agent.write({ name: 'map-essays', description: 'Where their essays about maps are', kind: 'reference', stated: false, body: 'Their essay on maps.', posts: ['p1'] });
  await agent.write({ name: 'river-essay', description: 'Where the river essay is', kind: 'reference', stated: false, body: 'The river essay.', posts: ['p2'] });
  assert.equal((await agent.start()).vault.broken, undefined);

  await rm(join(vault, 'essays/on-maps.md'));
  await rename(join(vault, 'essays/on-rivers.md'), join(vault, 'notes/on-rivers.md'));
  const start = await agent.start();
  assert.deepEqual(start.vault.broken, [{ memory: 'map-essays', post: 'p1' }]);
  const reported = start.notes.filter(note => note.source === 'vault').map(note => note.text);
  assert.ok(reported.includes('Post "On maps" (p1) was removed from essays. These memories pointed at it: map-essays'));
  assert.ok(reported.includes('Post "On rivers" (p2) moved from essays to notes. These memories point at it: river-essay'));
  assert.equal((await person.syncVault()).changes, 0, 'a change is reported once');
});

test('a section that leaves the vault keeps what was written about it', async () => {
  const { dir, vault, agent } = await setup();
  await agent.describeSection({ section: 'notes/reading', meaning: 'Notes on books' });
  await rm(join(vault, 'notes'), { recursive: true });
  const start = await agent.start();
  assert.match(await map(dir), /### notes\/reading\nNot in the vault any more\.\nMeaning: Notes on books/);
  assert.ok(start.notes.some(note => note.text === 'The section notes/reading is no longer in the vault. What vault.md said about it is kept'));
});

test('with a vault connected, identity evidence must be in the post it names', async () => {
  const { agent } = await setup();
  const propose = passage => agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'vault', post: 'p1', passage } });
  await assert.rejects(agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'vault', post: 'p9', passage: 'Lisbon' } }), refused('NoEvidence'));
  await assert.rejects(propose('I moved to Porto last spring'), refused('NoEvidence'));
  assert.equal((await propose('i moved to   Lisbon last spring')).waiting, true);
});

test('a memory points at posts by ID, and keeps them when rewritten without them', async () => {
  const { agent } = await setup();
  await assert.rejects(agent.write({ name: 'bad', description: 'x', kind: 'reference', stated: false, body: 'x', posts: [] }), refused('InvalidMemory'));
  await assert.rejects(agent.write({ name: 'bad', description: 'x', kind: 'reference', stated: false, body: 'x', posts: ['p1', 'p1'] }), refused('InvalidMemory'));
  const tools = createTools(agent);
  const saved = await tools.call('cortex_remember', { memory: { name: 'map-essays', description: 'Where the map essays are', kind: 'reference', stated: false, body: 'One.', posts: ['p1'] } });
  await tools.call('cortex_remember', { memory: { name: 'map-essays', description: 'Where the map essays are', kind: 'reference', stated: false, body: 'One essay.' }, version: saved.version });
  assert.deepEqual((await agent.read('map-essays')).memory.posts, ['p1']);
});

test('the person connects a vault from the command line', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-cli-'));
  await writePost(join(base, 'vault'), 'essays/one.md', { id: 'p1', title: 'One' });
  const dir = join(base, 'cortex');
  execFileSync('node', [cli, 'init', dir]);
  assert.throws(() => execFileSync('node', [cli, 'vault', dir], { stdio: 'pipe' }), 'no vault is connected yet');
  assert.match(execFileSync('node', [cli, 'vault', 'connect', join(base, 'vault'), dir], { encoding: 'utf8' }), /1 sections/);
  assert.equal(JSON.parse(execFileSync('node', [cli, 'vault', 'sync', dir], { encoding: 'utf8' })).sections[0].section, 'essays');
  assert.match(await readFile(join(dir, 'vault.md'), 'utf8'), /## essays\n1 post\./);
});

test('a heading the person writes in vault.md is kept as theirs', async () => {
  const { dir, agent } = await setup();
  await writeFile(join(dir, 'vault.md'), (await map(dir)).replace('## essays\n2 posts.', '## essays\n2 posts.\n### Examples\nThe best one is On maps.'));
  const start = await agent.start();
  assert.match(await map(dir), /## essays\n2 posts\.\n### Examples\nThe best one is On maps\.\n\n## notes/);
  assert.equal(start.notes.some(note => /Examples/.test(note.text)), false);
  assert.deepEqual(start.vault.sections.map(section => section.section), ['essays', 'notes', 'notes/reading']);
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

test('two posts with one ID: the first stands and the clash is reported', async () => {
  const { vault, agent } = await setup();
  await writePost(vault, 'notes/copy.md', { id: 'p1', title: 'A copy' });
  const start = await agent.start();
  assert.ok(start.problems.some(problem => /essays\/on-maps\.md and notes\/copy\.md have the same id, p1/.test(problem)), start.problems.join('\n'));
});

test('one session start reads the vault a fixed number of times, however many pointers there are', async () => {
  const { dir, vault, agent } = await setup();
  for (const name of ['ref-a', 'ref-b', 'ref-c', 'ref-d', 'ref-e', 'ref-f']) await agent.write({ name, description: 'x', kind: 'reference', stated: false, body: 'x', posts: ['p1', 'p2'] });
  const real = folderVault(vault);
  let calls = 0;
  const counted = Object.fromEntries(Object.entries(real).map(([key, value]) => [key, typeof value === 'function' ? (...args) => { calls += 1; return value(...args); } : value]));
  await openCortex(dir, { vault: counted }).start();
  assert.equal(calls, 3);
});

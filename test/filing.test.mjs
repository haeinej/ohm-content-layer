import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adviseFiling } from '../src/filing.mjs';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools, TOOLS } from '../src/tools.mjs';
import { checkVault, folderVault } from '../src/vault.mjs';

// Every person and post here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const refused = code => problem => problem.code === code;
const writePost = async (root, path, { id, title, body = '' }) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\nid: ${id}\ntitle: ${title}\n---\n${body}`);
};

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'cortex-filing-'));
  const vault = join(base, 'vault');
  await writePost(vault, 'meetings/harbour-board.md', { id: 'm1', title: 'Harbour board, March', body: 'We talked about the ferry timetable and the harbour wall.' });
  await writePost(vault, 'meetings/garden-group.md', { id: 'm2', title: 'Garden group, April', body: 'Seeds, the shed roof.' });
  await writePost(vault, 'essays/on-tides.md', { id: 'e1', title: 'On tides', body: 'The harbour empties twice a day.' });
  await writePost(vault, 'notes/reading/atlas.md', { id: 'r1', title: 'Reading: an atlas of islands', body: 'Maps of every island.' });
  for (const n of [1, 2, 3, 4, 5, 6]) await writePost(vault, `notes/harbour-${n}.md`, { id: `h${n}`, title: `Harbour note ${n}`, body: 'The ferry was late.' });
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const person = openCortex(dir, { actor: 'member' });
  await person.connectVault({ kind: 'folder', path: vault });
  const agent = openCortex(dir, { actor: 'claude-code' });
  await agent.start();
  await agent.describeSection({ section: 'meetings', meaning: 'Transcripts of meetings I was in, one per meeting', conventions: 'Titled by the group and the month, such as "Harbour board, March"' });
  await agent.describeSection({ section: 'essays', meaning: 'Finished long-form writing, one idea each', conventions: 'Titles start with "On"' });
  await agent.describeSection({ section: 'notes/reading', meaning: 'Notes on books and articles I read', conventions: 'Titles start with "Reading:"' });
  return { base, vault, dir, person, agent, tools: createTools(agent) };
}

// Every file under a folder, with its size, time and a hash of what it holds.
async function listing(root) {
  const found = [];
  async function walk(folder) {
    for (const entry of (await readdir(join(root, folder), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { found.push(`${path}/`); await walk(path); continue; }
      const { size, mtimeMs } = await stat(join(root, path));
      found.push(`${path} ${size} ${mtimeMs} ${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}`);
    }
  }
  await walk('');
  return found;
}

const transcript = { kind: 'meeting transcript', title: 'Harbour board, May', text: 'Chair: the harbour wall is repaired. The ferry timetable changes in June. Harbour fees stay the same.' };

test('the advice names a section from vault.md with its conventions, and up to five related posts', async () => {
  const { tools } = await setup();
  const advice = await tools.call('cortex_file_advice', transcript);
  assert.deepEqual(advice.vault, { connected: true });
  assert.equal(advice.sections[0].section, 'meetings');
  assert.equal(advice.sections[0].meaning, 'Transcripts of meetings I was in, one per meeting');
  assert.equal(advice.sections[0].conventions, 'Titled by the group and the month, such as "Harbour board, March"');
  assert.equal(advice.sections[0].posts, 2);
  assert.match(advice.sections[0].why, /meeting/);
  assert.ok(advice.sections.length <= 3);
  assert.equal(advice.related.length, 5);
  assert.deepEqual(advice.related[0], { id: 'm1', title: 'Harbour board, March', label: 'meetings' });
  assert.ok(advice.related.every(post => post.id && post.title && post.label));
  assert.match(advice.ask, /^Shall I file this under meetings, titled the way posts there are \(Titled by the group and the month/);
  assert.match(advice.ask, /"Harbour board, March"/);

  // A reading note goes elsewhere, matched by the words of its kind against the section's meaning.
  const reading = await tools.call('cortex_file_advice', { kind: 'reading note', title: 'A book about islands' });
  assert.equal(reading.sections[0].section, 'notes/reading');
  assert.equal(reading.sections[0].conventions, 'Titles start with "Reading:"');
  assert.deepEqual(reading.related.map(post => post.id), ['r1']);
});

test('with no vault connected, the advice says so instead of guessing', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-filing-'));
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const advice = await createTools(openCortex(dir, { actor: 'codex' })).call('cortex_file_advice', transcript);
  assert.deepEqual(advice.vault, { connected: false });
  assert.deepEqual([advice.sections, advice.related], [[], []]);
  assert.match(advice.ask, /No vault is connected/);

  // A vault that cannot be read is said to be unreadable, and nothing is guessed either.
  const gone = await adviseFiling(openCortex(dir, { vault: folderVault(join(base, 'missing')) }), transcript);
  assert.equal(gone.vault.reachable, false);
  assert.deepEqual(gone.sections, []);
  assert.match(gone.ask, /cannot be read/);
});

test('a vault without search still answers, with no related posts', async () => {
  const { dir, vault } = await setup();
  const { search, ...rest } = folderVault(vault);
  assert.equal(typeof search, 'function');
  const without = checkVault(rest);
  assert.throws(() => checkVault({ ...rest, search: 'not an operation' }), refused('InvalidVault'));
  const advice = await adviseFiling(openCortex(dir, { vault: without }), transcript);
  assert.equal(advice.sections[0].section, 'meetings');
  assert.deepEqual(advice.related, []);
  assert.match(advice.ask, /^Shall I file this under meetings/);
});

test('asking for advice changes no file in the cortex or the vault', async () => {
  const { dir, vault, tools, agent } = await setup();
  await agent.start();
  const before = [await listing(dir), await listing(vault)];
  await tools.call('cortex_file_advice', transcript);
  await tools.call('cortex_file_advice', { kind: 'link', title: 'A page about ferries', text: 'https://example.invalid/ferries' });
  await tools.call('cortex_file_advice', { kind: 'voice memo' });
  assert.deepEqual([await listing(dir), await listing(vault)], before);
  assert.equal(TOOLS.find(tool => tool.name === 'cortex_file_advice').annotations.readOnlyHint, true);
});

test('an approved skill whose description fits the kind is named, and an unapproved one is not', async () => {
  const { dir, tools, agent } = await setup();
  const person = openCortex(dir, { actor: 'member' });
  await agent.proposeSkill({ text: '---\nname: meeting-minutes\ndescription: Turning a meeting transcript into minutes\n---\n1. List who spoke.\n' });
  await agent.proposeSkill({ text: '---\nname: file-a-voice-memo\ndescription: Filing a voice memo with its date\n---\n1. Note the date.\n' });
  await person.approveSkill('meeting-minutes');

  assert.deepEqual((await tools.call('cortex_file_advice', transcript)).skill, { name: 'meeting-minutes', description: 'Turning a meeting transcript into minutes' });
  // The voice memo skill is still waiting for the person, so it is not named.
  assert.equal((await tools.call('cortex_file_advice', { kind: 'voice memo' })).skill, null);
  await person.approveSkill('file-a-voice-memo');
  assert.equal((await tools.call('cortex_file_advice', { kind: 'voice memo' })).skill.name, 'file-a-voice-memo');
  // The filing skill the template ships fits any of the kinds it names.
  assert.equal((await tools.call('cortex_file_advice', { kind: 'link' })).skill.name, 'file-a-source');
});

test('a source must say what it is', async () => {
  const { tools } = await setup();
  await assert.rejects(tools.call('cortex_file_advice', { title: 'Untitled' }), /Give kind/);
  await assert.rejects(tools.call('cortex_file_advice', { kind: '  ' }), /InvalidRequest/);
  await assert.rejects(tools.call('cortex_file_advice', { kind: 'link', url: 'https://example.invalid' }), /takes only/);
});

test('a folder vault searches titles and bodies, title first', async () => {
  const { vault } = await setup();
  const folder = folderVault(vault);
  const found = await folder.search('harbour ferry', 3);
  assert.equal(found.length, 3);
  assert.deepEqual(found[0], { id: 'm1', title: 'Harbour board, March', label: 'meetings' });
  assert.deepEqual((await folder.search(['islands'])).map(post => post.id), ['r1']);
  assert.deepEqual((await folder.search(['atlas'], 10))[0], { id: 'r1', title: 'Reading: an atlas of islands', label: 'notes', sublabel: 'reading' });
  assert.deepEqual(await folder.search('nothing-here-at-all'), []);
  assert.deepEqual(await folder.search(''), []);
});

test('a new cortex ships the filing skill, and the rulebook says how to file', async () => {
  const { agent } = await setup();
  const start = await agent.start();
  assert.ok(start.skills.some(skill => skill.name === 'file-a-source'));
  const { skill } = await agent.getSkill('file-a-source');
  assert.match(skill.text, /cortex_file_advice/);
  assert.match(start.rules, /## Filing\n/);
  assert.match(start.rules, /File only what they hand over/);
  assert.match(start.rules, /Never write a post or a fact of your own/);
  assert.equal(start.rules.match(/File only what/g).length, 1, 'the filing lines are moved, not repeated');
});

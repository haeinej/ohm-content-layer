import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const fresh = async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-'));
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  return { base, dir, agent: openCortex(dir, { actor: 'claude-code' }) };
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;
const memory = { name: 'likes-short-titles', description: 'Titles of four words or fewer', kind: 'preference', stated: false, body: 'Short titles.' };

test('a note cites what it was drawn from: a node at a version, a trace, or a session', async () => {
  const { dir, agent } = await fresh();
  const { version } = await agent.write(memory);
  const evidence = [{ node: 'memory/likes-short-titles.md', version }, { session: 's1' }, { trace: 't-0001' }];
  await createTools(agent).call('cortex_note', { id: 'n1', note: 'Shortened a title again', session: 's2', evidence });
  const [note] = (await agent.listNotes()).notes;
  assert.deepEqual(note.evidence, evidence);
  const line = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(text => JSON.parse(text)).find(entry => entry.type === 'note');
  assert.deepEqual(line.evidence, evidence);
  // A note with no evidence, named by its session as before, is still a note.
  await agent.addNote({ id: 'n2', note: 'Answered in Dutch', session: 's2' });
  assert.equal((await agent.listNotes()).notes.find(item => item.id === 'n2').evidence, undefined);
});

test('evidence of the wrong shape is refused, and nothing is written', async () => {
  const { agent } = await fresh();
  const note = evidence => agent.addNote({ id: 'n1', note: 'Seen', session: 's1', evidence });
  for (const evidence of [[], 'memory/x.md', [{}], [{ node: 'memory/x.md' }], [{ node: 'memory/x.md', version: 'c1', session: 's1' }], [{ session: 's1', why: 'x' }], [{ session: 3 }], [{ session: '' }], [{ session: 's1' }, { session: 's1' }], Array.from({ length: 21 }, (_, n) => ({ session: `s${n}` }))]) {
    await assert.rejects(note(evidence), refused('InvalidRequest'), JSON.stringify(evidence));
  }
  await assert.rejects(agent.write({ ...memory, evidence: [{ trace: 't1', session: 's1' }] }), refused('InvalidMemory'));
  assert.deepEqual((await agent.listNotes()).notes, []);
});

test('what evidence cites must exist where cortex can look', async () => {
  const { base, dir, agent } = await fresh();
  const one = await agent.write(memory);
  const two = await agent.write({ ...memory, body: 'Short titles, no colons.' }, { replaces: one.version });
  const note = (id, evidence) => agent.addNote({ id, note: 'Seen', session: 's1', evidence });
  // A version now, a kept one, or one the journal recorded.
  await note('now', [{ node: 'memory/likes-short-titles.md', version: two.version }]);
  await note('kept', [{ node: 'memory/likes-short-titles.md', version: one.version }]);
  await assert.rejects(note('never', [{ node: 'memory/likes-short-titles.md', version: 'cnever' }]), refused('NoEvidence'));
  await assert.rejects(note('nobody', [{ node: 'memory/nobody.md', version: one.version }]), refused('NoEvidence'));
  const w1 = await agent.writeWorking('First.');
  await agent.writeWorking('Second.', { replaces: w1.version });
  await note('working', [{ node: '.cortex/working/claude-code.md', version: w1.version }]);

  // Without a vault, a block cannot be looked up, and is taken as cited.
  await note('unchecked', [{ node: 'p1', version: 'any' }]);
  // With a vault, it must be there.
  const vault = join(base, 'vault');
  await mkdir(join(vault, 'essays'), { recursive: true });
  await writeFile(join(vault, 'essays', 'one.md'), '---\nid: "p1"\ntitle: "On slowness"\n---\nWalking is slow.\n');
  await openCortex(dir, { actor: 'member' }).connectVault({ kind: 'folder', path: vault });
  const later = openCortex(dir, { actor: 'claude-code' });
  await later.addNote({ id: 'block', note: 'Seen', session: 's1', evidence: [{ node: 'p1', version: 'as-read' }] });
  await assert.rejects(later.addNote({ id: 'gone', note: 'Seen', session: 's1', evidence: [{ node: 'p9', version: 'as-read' }] }), refused('NoEvidence'));
  await assert.rejects(later.write({ ...memory, name: 'likes-walking', evidence: [{ node: 'p9', version: 'v' }] }), refused('NoEvidence'));
});

test('a memory keeps its evidence through a rewrite, and a distill that cites what is not there writes nothing', async () => {
  const { agent } = await fresh();
  const tools = createTools(agent);
  const evidence = [{ session: 's1' }, { session: 's2' }];
  const saved = await tools.call('cortex_remember', { memory: { ...memory, evidence } });
  const rewritten = await tools.call('cortex_remember', { memory: { ...memory, body: 'Short titles, always.' }, version: saved.version });
  assert.deepEqual((await agent.read(memory.name)).memory.evidence, evidence);
  assert.equal((await agent.read(memory.name)).version, rewritten.version);

  const before = await agent.working();
  await assert.rejects(tools.call('cortex_distill', { session: 's3', working: 'Next time.', notes: [
    { id: 'fine', note: 'Shortened a title again', evidence: [{ session: 's3' }] },
    { id: 'bad', note: 'Cites nothing real', evidence: [{ node: 'memory/nothing-here.md', version: 'c0' }] },
  ] }), refused('NoEvidence'));
  assert.deepEqual((await agent.listNotes()).notes, []);
  assert.equal((await agent.working()).mine.version, before.mine.version);
});

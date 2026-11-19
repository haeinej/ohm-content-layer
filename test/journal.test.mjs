import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, cp, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { openJournal } from '../src/journal.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const journal = async dir => (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const exists = path => stat(path).then(() => true, () => false);

test('notes, settlements and distills are lines in one journal, each with seq, id, time, actor and type', async () => {
  const dir = await fresh();
  const agent = openCortex(dir, { actor: 'claude-code' });
  await agent.addNote({ id: 'n1', note: 'Shortened a title again', session: 's1' });
  await agent.settle({ notes: [{ id: 'n1', outcome: 'kept' }] });
  await createTools(agent).call('cortex_distill', { session: 's1', working: 'Open: nothing.' });

  const lines = (await journal(dir)).filter(line => line.type !== 'change');
  assert.deepEqual(lines.map(line => [line.type, line.event ?? line.outcome ?? line.text]), [['note', 'Shortened a title again'], ['decision', 'kept'], ['session', 'distill']]);
  for (const line of lines) {
    assert.ok(Number.isSafeInteger(line.seq));
    assert.match(line.id, /^[a-z0-9]+-[0-9a-f]{12}$/);
    assert.ok(Number.isFinite(Date.parse(line.at)));
    assert.deepEqual(line.actor, { kind: 'agent', name: 'claude-code' });
  }
  assert.deepEqual(lines.map(line => line.session), ['s1', undefined, 's1'], 'a settlement belongs to no one session');
  const all = await journal(dir);
  assert.deepEqual(all.map(line => line.seq), all.map((_, index) => index + 1), 'seq counts up from one');
  assert.equal(new Set(all.map(line => line.id)).size, all.length, 'every line has its own ID');
  assert.equal(await exists(join(dir, '.cortex', 'notes.jsonl')), false, 'the old notes file is not written');
  assert.equal(await exists(join(dir, '.cortex', 'sessions.jsonl')), false, 'nor the old sessions file');
  // The person is a human actor; an agent can never take the person's name.
  await openCortex(dir, { actor: 'member' }).addNote({ id: 'n2', note: 'Said they file on Fridays', session: 'event' });
  assert.deepEqual((await journal(dir)).at(-1).actor, { kind: 'human', name: 'member' });
});

test('two machines\' journals joined by a union merge keep every line, with no ID shared', async () => {
  const dir = await fresh();
  await openCortex(dir, { actor: 'claude-code' }).addNote({ id: 'before', note: 'Seen before the copy', session: 's0' });
  const other = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await cp(dir, other, { recursive: true });
  await openCortex(dir, { actor: 'claude-code' }).addNote({ id: 'here', note: 'Seen on the laptop', session: 's1' });
  await openCortex(other, { actor: 'codex' }).addNote({ id: 'there', note: 'Seen on the desktop', session: 's2' });

  // What git's union merge does: the lines of both, each kept once.
  const ours = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
  const theirs = (await readFile(join(other, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), `${[...new Set([...ours, ...theirs])].join('\n')}\n`);

  const merged = await journal(dir);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map(line => line.id)).size, 3);
  assert.deepEqual(merged.filter(line => line.seq === 2).length, 2, 'both machines wrote a second line');
  const cortex = openCortex(dir, { actor: 'claude-code' });
  assert.deepEqual([...(await cortex.listNotes()).notes.map(note => note.id)].sort(), ['before', 'here', 'there']);
  // The next line counts on from the highest seq either machine reached.
  await cortex.addNote({ id: 'after', note: 'Seen after the merge', session: 's3' });
  assert.equal((await journal(dir)).at(-1).seq, 3);
  // Every reader puts lines sharing a seq in the same order.
  const read = (await openJournal(dir).read()).map(line => line.id);
  assert.deepEqual(read, (await openJournal(dir).read()).map(line => line.id));
  // git is told to join the journal this way.
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.match(execFileSync('git', ['check-attr', 'merge', '--', '.cortex/journal.jsonl'], { cwd: dir, encoding: 'utf8' }), /merge: union/);
});

test('a cortex made before the journal keeps its notes, settlements and sessions', async () => {
  const dir = await fresh();
  // What .cortex/notes.jsonl and .cortex/sessions.jsonl held before the journal.
  const old = [
    { type: 'note', id: 'old-1', text: 'Writes titles in lowercase', session: 's-old', source: 'claude-code', writtenBy: 'claude-code', when: '2026-11-01T10:00:00.000Z' },
    { type: 'note', id: 'old-2', text: 'Files on Fridays', session: 's-old', source: 'claude-code', writtenBy: 'claude-code', when: '2026-11-01T10:01:00.000Z' },
    { type: 'settled', id: 'old-2', outcome: 'dropped', when: '2026-11-02T10:00:00.000Z' },
  ];
  await writeFile(join(dir, '.cortex', 'notes.jsonl'), `${old.map(line => JSON.stringify(line)).join('\n')}\n`);
  const cortex = openCortex(dir, { actor: 'claude-code' });
  const waiting = (await cortex.listNotes()).notes;
  assert.deepEqual(waiting.map(note => [note.id, note.text, note.writtenBy]), [['old-1', 'Writes titles in lowercase', 'claude-code']]);
  assert.equal((await cortex.listNotes({ settled: true })).notes.find(note => note.id === 'old-2').outcome, 'dropped');
  // A note from before can be settled now; the decision goes to the journal, and the old file is not touched.
  const before = await readFile(join(dir, '.cortex', 'notes.jsonl'), 'utf8');
  await cortex.settle({ notes: [{ id: 'old-1', outcome: 'kept' }] });
  assert.equal(await readFile(join(dir, '.cortex', 'notes.jsonl'), 'utf8'), before);
  assert.equal((await cortex.listNotes({ settled: true })).notes.find(note => note.id === 'old-1').outcome, 'kept');
  assert.deepEqual((await journal(dir)).filter(line => line.type === 'decision').map(line => [line.note, line.outcome]), [['old-1', 'kept']]);
  // An old note ID is still taken.
  await assert.rejects(cortex.addNote({ id: 'old-1', note: 'Something else', session: 's2' }), problem => problem.code === 'Changed');

  // A session started before the journal, with the old line, is still tracked by the stop hook.
  const version = (await cortex.working()).mine.version;
  await appendFile(join(dir, '.cortex', 'sessions.jsonl'), `${JSON.stringify({ agent: 'claude-code', session: 'old-s', started: '2026-11-01T09:00:00.000Z', version })}\n`);
  const stop = () => spawnSync('node', [cli, 'hook', 'stop', dir, '--agent', 'claude-code'], { input: JSON.stringify({ session_id: 'old-s', hook_event_name: 'Stop', stop_hook_active: false }), encoding: 'utf8' }).stdout;
  assert.equal(stop(), '', 'nothing changed since the old start');
  await cortex.writeWorking('Changed after the old start.', { replaces: version });
  assert.match(stop(), /cortex_distill/);
  assert.equal(stop(), '', 'asked once; the ask is in the journal');
  assert.equal((await journal(dir)).filter(line => line.type === 'session' && line.event === 'ask').length, 1);
});

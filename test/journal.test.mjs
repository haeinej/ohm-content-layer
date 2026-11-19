import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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

test('every write to the cortex is a change line: node, op, versions before and after, and who', async () => {
  const dir = await fresh();
  const vault = join(dir, '..', 'vault');
  await mkdir(join(vault, 'essays'), { recursive: true });
  await writeFile(join(vault, 'essays', 'one.md'), '---\nid: "p1"\ntitle: "On slowness"\n---\nWalking is slow.\n');
  const person = openCortex(dir, { actor: 'member' });
  const agent = openCortex(dir, { actor: 'claude-code' });
  const changes = async () => (await journal(dir)).filter(line => line.type === 'change');
  const last = async () => (await changes()).at(-1);

  // Memory: create, update, the seen count when settled, remove.
  const memory = { name: 'likes-short-titles', description: 'Titles of four words or fewer', kind: 'preference', stated: true, body: 'Short titles.' };
  const one = await agent.write(memory);
  assert.deepEqual(await last().then(line => [line.node, line.op, line.before, line.after, line.actor]), ['memory/likes-short-titles.md', 'create', null, one.version, { kind: 'agent', name: 'claude-code' }]);
  const two = await agent.write({ ...memory, body: 'Short titles, no colons.' }, { replaces: one.version });
  assert.deepEqual(await last().then(line => [line.op, line.before, line.after]), ['update', one.version, two.version]);
  await agent.addNote({ id: 'n1', note: 'Cut a title short again', session: 's1' });
  await agent.settle({ notes: [{ id: 'n1', outcome: 'likes-short-titles' }] });
  const seen = await last();
  const three = (await agent.read('likes-short-titles')).version;
  assert.deepEqual([seen.op, seen.before, seen.after, seen.reason], ['update', two.version, three, 'seen again in 1 settled note']);
  assert.equal((await agent.read('likes-short-titles', { version: two.version })).version, two.version, 'the version before the count is kept');
  await agent.remove('likes-short-titles', { replaces: three });
  assert.deepEqual(await last().then(line => [line.op, line.before, line.after]), ['remove', three, null]);

  // Working memory: create, update, clear.
  const w1 = await agent.writeWorking('Filing two notes.');
  const w2 = await agent.writeWorking('Filing two notes. One done.', { replaces: w1.version });
  await agent.writeWorking('', { replaces: w2.version });
  assert.deepEqual((await changes()).slice(-3).map(line => [line.node, line.op, line.before, line.after]), [
    ['.cortex/working/claude-code.md', 'create', null, w1.version],
    ['.cortex/working/claude-code.md', 'update', w1.version, w2.version],
    ['.cortex/working/claude-code.md', 'remove', w2.version, null],
  ]);

  // Identity, by the person.
  await person.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'person', quote: 'I live in Lisbon' } });
  await person.confirmIdentity('city');
  const identity = await last();
  assert.deepEqual([identity.node, identity.op, identity.actor, identity.after], ['identity.md', 'update', { kind: 'human', name: 'member' }, (await person.identity()).version]);

  // vault.md: written when the vault is connected, and when a channel is described.
  await person.connectVault({ kind: 'folder', path: vault });
  const map = await last();
  assert.deepEqual([map.node, map.op, map.before], ['vault.md', 'create', null]);
  await agent.describeChannel({ channel: 'essays', meaning: 'Finished essays, one idea each' });
  const described = await last();
  assert.deepEqual([described.node, described.op, described.before, described.actor.name], ['vault.md', 'update', map.after, 'claude-code']);
  assert.match(described.reason, /essays/);

  // Skill and tool proposals, and approving a skill.
  const skill = '---\nname: file-a-receipt\ndescription: How receipts are filed\n---\nFile by month.\n';
  const p1 = await agent.proposeSkill({ text: skill });
  const p2 = await agent.proposeSkill({ text: `${skill}Keep the total.\n` });
  assert.deepEqual((await changes()).slice(-2).map(line => [line.node, line.op, line.before, line.after]), [
    ['.cortex/proposed/skills/file-a-receipt', 'create', null, p1.version],
    ['.cortex/proposed/skills/file-a-receipt', 'update', p1.version, p2.version],
  ]);
  await person.approveSkill('file-a-receipt');
  assert.deepEqual((await changes()).slice(-2).map(line => [line.node, line.op, line.actor.kind]), [['.cortex/proposed/skills/file-a-receipt', 'remove', 'human'], ['skills/file-a-receipt', 'create', 'human']]);
  await agent.proposeTool({ name: 'calendar', description: 'Reads the calendar', inputs: 'A day', outputs: 'Events' });
  assert.deepEqual(await last().then(line => [line.node, line.op]), ['.cortex/proposed/tools/calendar.md', 'create']);

  // Each line's before is the after of the line before it for the same node.
  const all = await changes();
  for (const [index, line] of all.entries()) {
    const previous = all.slice(0, index).filter(other => other.node === line.node).at(-1);
    if (previous) assert.equal(line.before, previous.after, `${line.node} at ${line.seq}`);
  }
});

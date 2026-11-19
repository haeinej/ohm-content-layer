import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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

test('notes, settlements and sessions are lines in one journal, each with seq, id, time, actor and type', async () => {
  const dir = await fresh();
  const agent = openCortex(dir, { actor: 'claude-code' });
  await agent.addNote({ id: 'n1', note: 'Shortened a title again', session: 's1' });
  await agent.settle({ notes: [{ id: 'n1', outcome: 'kept' }] });
  await createTools(agent).call('cortex_distill', { session: 's1', working: 'Open: nothing.' });
  await createTools(agent).call('cortex_session', { summary: 'Filed two reading notes', session: 's1' });

  const lines = (await journal(dir)).filter(line => line.type !== 'change');
  assert.deepEqual(lines.map(line => [line.type, line.summary ?? line.outcome ?? line.text]), [['note', 'Shortened a title again'], ['decision', 'kept'], ['session', 'Filed two reading notes']]);
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
  // A distill's checkpoint is the hooks' bookkeeping, not history.
  assert.match(await readFile(join(dir, '.cortex', 'hooks.jsonl'), 'utf8'), /"distilled"/);
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
  assert.equal(stop(), '', 'asked once; the ask is kept with the hooks\' checkpoints');
  assert.equal((await readFile(join(dir, '.cortex', 'hooks.jsonl'), 'utf8')).trim().split('\n').filter(line => JSON.parse(line).asked).length, 1);
});

test('an agent\'s edit is a proposal; only the person accepting it makes the change, on every kind of node', async () => {
  const dir = await fresh();
  const vault = join(dir, '..', 'vault');
  await mkdir(join(vault, 'essays'), { recursive: true });
  await writeFile(join(vault, 'essays', 'one.md'), '---\nid: "p1"\ntitle: "On slowness"\n---\nWalking is slow.\n');
  const person = openCortex(dir, { actor: 'member' });
  const agent = openCortex(dir, { actor: 'claude-code' });
  const lines = async type => (await journal(dir)).filter(line => line.type === type);
  const lastChange = async () => (await lines('change')).at(-1);
  await person.connectVault({ kind: 'folder', path: vault });

  // Each kind of node an agent edits waits as a proposal, and nothing in the folder changes.
  const memory = { name: 'likes-short-titles', description: 'Titles of four words or fewer', kind: 'preference', stated: true, body: 'Short titles.' };
  const before = await readdir(dir, { recursive: true });
  const proposed = [
    await agent.write(memory, { reason: 'They said so' }),
    await agent.describeChannel({ channel: 'essays', meaning: 'Finished essays, one idea each' }),
    await agent.proposeSkill({ text: '---\nname: file-a-receipt\ndescription: How receipts are filed\n---\nFile by month.\n' }),
    await agent.proposeTool({ name: 'calendar', description: 'Reads the calendar', inputs: 'A day', outputs: 'Events' }),
  ];
  assert.deepEqual(proposed.map(item => [item.node, item.op, item.waiting]), [['memory/likes-short-titles', 'create', true], ['channel/essays', 'create', true], ['skill/file-a-receipt', 'create', true], ['tool/calendar', 'create', true]]);
  assert.deepEqual(await readdir(dir, { recursive: true }), before, 'no file changed');
  assert.equal((await lines('change')).length, 0);
  const [line] = await lines('proposal');
  assert.deepEqual([line.proposal, line.node, line.op, line.before, line.after, line.reason, line.actor.name], [proposed[0].proposed, 'memory/likes-short-titles', 'create', null, proposed[0].version, 'They said so', 'claude-code']);
  assert.match(line.content, /Short titles\./, 'the whole change is in the proposal');

  // An agent cannot accept or reject; the person can.
  await assert.rejects(agent.accept(proposed[0].proposed), problem => problem.code === 'PersonOnly');
  await assert.rejects(agent.reject(proposed[0].proposed), problem => problem.code === 'PersonOnly');
  for (const item of proposed) await person.accept(item.proposed, { reason: 'Fine' });
  const decisions = await lines('decision');
  assert.deepEqual(decisions.map(item => [item.proposal, item.outcome, item.reason, item.actor.kind]), proposed.map(item => [item.proposed, 'accepted', 'Fine', 'human']));
  const changes = await lines('change');
  assert.deepEqual(changes.map(item => [item.node, item.op, item.before, item.after, item.actor.name, item.proposal, item.decision]), proposed.map((item, index) => [item.node, 'create', null, item.version, 'claude-code', item.proposed, decisions[index].id]));
  assert.match(await readFile(join(dir, 'vault.md'), 'utf8'), /## essays\n1 block\.\nMeaning: Finished essays, one idea each/);
  assert.match(await readFile(join(dir, 'skills', 'file-a-receipt', 'SKILL.md'), 'utf8'), /File by month/);
  assert.match(await readFile(join(dir, 'tools', 'calendar.md'), 'utf8'), /on: false/, 'an accepted tool is added switched off');
  assert.deepEqual((await person.start()).tools, []);
  await assert.rejects(person.accept(proposed[0].proposed), problem => problem.code === 'Decided');

  // A proposal against a version that is no longer current is stale, and cannot be accepted.
  const one = proposed[0].version;
  const late = await agent.write({ ...memory, body: 'Short titles, no colons.' }, { replaces: one });
  const other = await openCortex(dir, { actor: 'codex' }).write({ ...memory, body: 'Short titles, in sentence case.' }, { replaces: one });
  await person.accept(other.proposed);
  assert.equal((await person.proposals()).find(item => item.id === late.proposed).stale, true);
  await assert.rejects(person.accept(late.proposed), problem => problem.code === 'Stale');
  await person.reject(late.proposed, { reason: 'Codex got there first' });
  assert.deepEqual((await lines('decision')).at(-1).outcome, 'rejected');
  assert.equal((await person.proposals()).some(item => item.id === late.proposed), false);

  // The same edit proposed twice is one proposal.
  const again = { ...memory, body: 'Short titles, again.' };
  const first = await agent.write(again, { replaces: other.version });
  assert.equal((await agent.write(again, { replaces: other.version })).proposed, first.proposed);

  // Settling: the outcome is recorded at once; the memory's new seen count is a proposal.
  await person.reject(first.proposed);
  await agent.addNote({ id: 'n1', note: 'Cut a title short again', session: 's1' });
  const settled = await agent.settle({ notes: [{ id: 'n1', outcome: 'likes-short-titles' }] });
  assert.equal((await agent.listNotes()).notes.some(note => note.id === 'n1'), false, 'settled at once');
  assert.equal(settled.memories[0].waiting, true);
  await person.accept(settled.memories[0].proposed);
  assert.deepEqual(await lastChange().then(item => [item.op, item.before, item.reason]), ['update', other.version, 'seen again in 1 settled note']);
  assert.equal((await agent.read('likes-short-titles')).memory.seen.count, 1);

  // The person's own edit is a change at once, with no proposal.
  await person.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'person', quote: 'I live in Lisbon' } });
  await person.confirmIdentity('city');
  assert.deepEqual(await lastChange().then(item => [item.node, item.op, item.actor.kind]), ['identity', 'update', 'human']);
  // An agent's identity fact is a proposal line too, and the change is the agent's once confirmed.
  const fact = await agent.proposeIdentity({ field: 'occupation', value: 'Cartographer', source: { kind: 'person', quote: 'I am a cartographer' } });
  assert.equal((await person.proposals()).find(item => item.id === fact.id).field, 'occupation');
  await person.accept(fact.id);
  assert.deepEqual(await lastChange().then(item => [item.node, item.actor.name, item.proposal]), ['identity', 'claude-code', fact.id]);

  // Working memory is the one thing an agent writes at once.
  const w1 = await agent.writeWorking('Filing two notes.');
  assert.deepEqual(await lastChange().then(item => [item.node, item.op, item.after, item.actor.name, item.proposal]), ['working/claude-code', 'create', w1.version, 'claude-code', undefined]);

  // Each change's before is the after of the change before it on the same node.
  const all = await lines('change');
  for (const [index, item] of all.entries()) {
    const previous = all.slice(0, index).filter(other => other.node === item.node).at(-1);
    if (previous) assert.equal(item.before, previous.after, `${item.node} at ${item.seq}`);
  }
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { openJournal } from '../src/journal.mjs';
import { cortexStatus } from '../src/status.mjs';
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

test('observations, settlements and sessions are lines in one journal, each with seq, id, time, actor and type', async () => {
  const dir = await fresh();
  const agent = openCortex(dir, { actor: 'claude-code' });
  await agent.observe({ id: 'n1', text: 'Shortened a title again', session: 's1' });
  await agent.settle({ observations: [{ id: 'n1', outcome: 'kept' }] });
  await createTools(agent).call('cortex_distill', { session: 's1', working: 'Open: nothing.' });
  await createTools(agent).call('cortex_session', { summary: 'Filed two reading notes', session: 's1' });

  const lines = (await journal(dir)).filter(line => line.type !== 'change');
  assert.deepEqual(lines.map(line => [line.type, line.summary ?? line.outcome ?? line.text]), [['observation', 'Shortened a title again'], ['settled', 'kept'], ['session', 'Filed two reading notes']]);
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
  await openCortex(dir, { actor: 'member' }).observe({ id: 'n2', text: 'Said they file on Fridays', session: 'event' });
  assert.deepEqual((await journal(dir)).at(-1).actor, { kind: 'human', name: 'member' });
});

test('two machines\' journals joined by a union merge keep every line, with no ID shared', async () => {
  const dir = await fresh();
  await openCortex(dir, { actor: 'claude-code' }).observe({ id: 'before', text: 'Seen before the copy', session: 's0' });
  const other = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await cp(dir, other, { recursive: true });
  await openCortex(dir, { actor: 'claude-code' }).observe({ id: 'here', text: 'Seen on the laptop', session: 's1' });
  await openCortex(other, { actor: 'codex' }).observe({ id: 'there', text: 'Seen on the desktop', session: 's2' });

  // What git's union merge does: the lines of both, each kept once.
  const ours = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
  const theirs = (await readFile(join(other, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), `${[...new Set([...ours, ...theirs])].join('\n')}\n`);

  const merged = await journal(dir);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map(line => line.id)).size, 3);
  assert.deepEqual(merged.filter(line => line.seq === 2).length, 2, 'both machines wrote a second line');
  const cortex = openCortex(dir, { actor: 'claude-code' });
  assert.deepEqual([...(await cortex.listObservations()).observations.map(note => note.id)].sort(), ['before', 'here', 'there']);
  // The next line counts on from the highest seq either machine reached.
  await cortex.observe({ id: 'after', text: 'Seen after the merge', session: 's3' });
  assert.equal((await journal(dir)).at(-1).seq, 3);
  // Every reader puts lines sharing a seq in the same order.
  const read = (await openJournal(dir).read()).map(line => line.id);
  assert.deepEqual(read, (await openJournal(dir).read()).map(line => line.id));
  // git is told to join the journal this way.
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.match(execFileSync('git', ['check-attr', 'merge', '--', '.cortex/journal.jsonl'], { cwd: dir, encoding: 'utf8' }), /merge: union/);
});

test('a cortex made before the journal keeps its notes, as observations, and its settlements and sessions', async () => {
  const dir = await fresh();
  // What .cortex/notes.jsonl and .cortex/sessions.jsonl held before the journal.
  const old = [
    { type: 'note', id: 'old-1', text: 'Writes titles in lowercase', session: 's-old', source: 'claude-code', writtenBy: 'claude-code', when: '2026-11-01T10:00:00.000Z' },
    { type: 'note', id: 'old-2', text: 'Files on Fridays', session: 's-old', source: 'claude-code', writtenBy: 'claude-code', when: '2026-11-01T10:01:00.000Z' },
    { type: 'settled', id: 'old-2', outcome: 'dropped', when: '2026-11-02T10:00:00.000Z' },
  ];
  await writeFile(join(dir, '.cortex', 'notes.jsonl'), `${old.map(line => JSON.stringify(line)).join('\n')}\n`);
  const cortex = openCortex(dir, { actor: 'claude-code' });
  const waiting = (await cortex.listObservations()).observations;
  assert.deepEqual(waiting.map(note => [note.id, note.text, note.writtenBy]), [['old-1', 'Writes titles in lowercase', 'claude-code']]);
  assert.equal((await cortex.listObservations({ settled: true })).observations.find(note => note.id === 'old-2').outcome, 'dropped');
  // A note from before can be settled now; the outcome goes to the journal, and the old file is not touched.
  const before = await readFile(join(dir, '.cortex', 'notes.jsonl'), 'utf8');
  await cortex.settle({ observations: [{ id: 'old-1', outcome: 'kept' }] });
  assert.equal(await readFile(join(dir, '.cortex', 'notes.jsonl'), 'utf8'), before);
  assert.equal((await cortex.listObservations({ settled: true })).observations.find(note => note.id === 'old-1').outcome, 'kept');
  assert.deepEqual((await journal(dir)).filter(line => line.type === 'settled').map(line => [line.observation, line.outcome]), [['old-1', 'kept']]);
  // An old note ID is still taken.
  await assert.rejects(cortex.observe({ id: 'old-1', text: 'Something else', session: 's2' }), problem => problem.code === 'Changed');

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

test('an agent\'s edit is a change at once, marked with the agent, on every kind of node it may write', async () => {
  const dir = await fresh();
  const vault = join(dir, '..', 'vault');
  await mkdir(join(vault, 'essays'), { recursive: true });
  await writeFile(join(vault, 'essays', 'one.md'), '---\nid: "p1"\ntitle: "On slowness"\n---\nWalking is slow.\n');
  const person = openCortex(dir, { actor: 'member' });
  const agent = openCortex(dir, { actor: 'claude-code' });
  const lines = async type => (await journal(dir)).filter(line => line.type === type);
  const lastChange = async () => (await lines('change')).at(-1);
  await person.connectVault({ kind: 'folder', path: vault });

  // A memory, a channel's words and the agent's own working memory are written at once.
  const memory = { name: 'likes-short-titles', description: 'Titles of four words or fewer', kind: 'preference', stated: true, body: 'Short titles.' };
  const made = [
    await agent.write(memory, { reason: 'They said so' }),
    await agent.describeChannel({ channel: 'essays', meaning: 'Finished essays, one idea each' }),
    await agent.writeWorking('Filing two notes.'),
  ];
  const changes = await lines('change');
  assert.deepEqual(changes.slice(-3).map(item => [item.node, item.op, item.before, item.actor.kind, item.actor.name]), [
    ['memory/likes-short-titles', 'create', null, 'agent', 'claude-code'],
    ['channel/essays', 'create', null, 'agent', 'claude-code'],
    ['working/claude-code', 'create', null, 'agent', 'claude-code'],
  ]);
  assert.deepEqual([made[0].change, made[0].version], [changes.at(-3).id, changes.at(-3).after]);
  assert.equal(changes.at(-3).reason, 'They said so');
  assert.match(await readFile(join(dir, 'memory', 'likes-short-titles.md'), 'utf8'), /Short titles\./);
  assert.match(await readFile(join(dir, 'vault.md'), 'utf8'), /## essays\n1 block\.\nMeaning: Finished essays, one idea each/);
  assert.deepEqual((await lines('proposal')).length + (await lines('decision')).length, 0, 'nothing is proposed, and nothing waits');
  assert.equal('proposals' in (await agent.start()).waiting, false);

  // Settling rewrites the memory at once, as the agent's change, and records each outcome.
  await agent.observe({ id: 'n1', text: 'Cut a title short again', session: 's1' });
  const settled = await agent.settle({ observations: [{ id: 'n1', outcome: 'likes-short-titles' }] });
  assert.deepEqual(await lastChange().then(item => [item.id, item.op, item.before, item.reason, item.actor.name]), [settled.memories[0].change, 'update', made[0].version, 'seen again in 1 settled observation', 'claude-code']);
  assert.equal((await agent.read('likes-short-titles')).memory.seen.count, 1);

  // What needs trust still waits for the person: a skill, a tool, an identity fact.
  const before = await readdir(join(dir, 'skills'));
  assert.equal((await agent.proposeSkill({ text: '---\nname: file-a-receipt\ndescription: How receipts are filed\n---\nFile by month.\n' })).approved, false);
  assert.deepEqual(await readdir(join(dir, 'skills')), before, 'a skill is not used before it is approved');
  await agent.proposeTool({ name: 'calendar', description: 'Reads the calendar', inputs: 'A day', outputs: 'Events' });
  assert.equal(await exists(join(dir, 'tools', 'calendar.md')), false, 'a tool is only asked for');
  assert.deepEqual((await agent.start()).waiting, { identity: [], skills: ['file-a-receipt'], tools: ['calendar'] });
  await assert.rejects(agent.approveSkill('file-a-receipt'), problem => problem.code === 'PersonOnly');
  const approved = await person.approveSkill('file-a-receipt');
  assert.deepEqual(await lastChange().then(item => [item.id, item.node, item.op, item.actor.kind, item.proposedBy]), [approved.change, 'skill/file-a-receipt', 'create', 'human', 'claude-code']);
  // An identity fact the agent proposed is the person's change once confirmed, naming the agent.
  const fact = await agent.proposeIdentity({ field: 'occupation', value: 'Cartographer', source: { kind: 'person', quote: 'I am a cartographer' } });
  assert.equal((await lastChange()).node, 'skill/file-a-receipt', 'a proposed identity fact changes nothing');
  await person.confirmIdentity(fact.id);
  assert.deepEqual(await lastChange().then(item => [item.node, item.actor.kind, item.proposedBy, item.identityProposal]), ['identity', 'human', 'claude-code', fact.id]);

  // Each change's before is the after of the change before it on the same node.
  const all = await lines('change');
  for (const [index, item] of all.entries()) {
    const previous = all.slice(0, index).filter(other => other.node === item.node).at(-1);
    if (previous) assert.equal(item.before, previous.after, `${item.node} at ${item.seq}`);
  }
});

test('a journal from when agents\' edits waited for the person still reads, and its proposals change nothing', async () => {
  const dir = await fresh();
  const at = '2026-11-18T10:00:00.000Z';
  const codex = { kind: 'agent', name: 'codex' };
  const member = { kind: 'human', name: 'member' };
  const content = '---\nname: "likes-maps"\ndescription: "Likes maps"\nkind: "preference"\nstated: true\nwrittenBy: "codex"\nseen:\n  count: 0\n  last: null\n---\nMaps.\n';
  const old = [
    { seq: 1, id: 'old-1', at, actor: codex, type: 'note', note: 'n-old', text: 'Draws maps', session: 's-old', source: 'codex' },
    { seq: 2, id: 'old-2', at, actor: codex, type: 'proposal', proposal: 'p1', node: 'memory/likes-maps', op: 'create', before: null, after: 'cold', content },
    { seq: 3, id: 'old-3', at, actor: member, type: 'decision', proposal: 'p1', outcome: 'rejected' },
    { seq: 4, id: 'old-4', at, actor: codex, type: 'decision', note: 'n-old', outcome: 'dropped' },
    { seq: 5, id: 'old-5', at, actor: codex, type: 'proposal', proposal: 'p2', node: 'memory/working-style', op: 'remove', before: 'cany', after: null, content: null },
    { seq: 6, id: 'old-6', at, actor: codex, type: 'session', summary: 'Tried maps', outcome: 'done', made: ['p1'], deadEnds: [] },
  ];
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), `${old.map(line => JSON.stringify(line)).join('\n')}\n`);
  const person = openCortex(dir, { actor: 'member' });
  // Every line is still there to read, and the old decision about a note settles it.
  assert.deepEqual((await openJournal(dir).read()).map(line => line.type), ['observation', 'proposal', 'decision', 'settled', 'proposal', 'session']);
  assert.equal((await person.listObservations({ settled: true })).observations.find(note => note.id === 'n-old').outcome, 'dropped');
  // A proposal never accepted changed nothing, and nothing waits for it.
  assert.equal(await exists(join(dir, 'memory', 'likes-maps.md')), false);
  assert.ok(await exists(join(dir, 'memory', 'working-style.md')));
  assert.deepEqual((await person.start()).waiting, { identity: [], skills: [], tools: [] });
  assert.deepEqual((await cortexStatus(person)).map(item => item.kind), []);
  assert.deepEqual((await person.history()).changes, []);
  // The CLI no longer takes proposals.
  assert.equal(spawnSync('node', [cli, 'accept', 'p2', dir], { encoding: 'utf8' }).status, 1);
  assert.ok(await exists(join(dir, 'memory', 'working-style.md')), 'accept is not a command any more, so nothing was removed');
  // New lines count on from the old ones.
  await person.write({ name: 'likes-maps', description: 'Likes maps', kind: 'preference', stated: true, body: 'Maps.' });
  assert.equal((await journal(dir)).at(-1).seq, 7);
});

test('a journal written before observations were named reads its note lines as observations', async () => {
  const dir = await fresh();
  const at = '2026-11-18T10:00:00.000Z';
  const codex = { kind: 'agent', name: 'codex' };
  const old = [
    { seq: 1, id: 'line-1', at, actor: codex, session: 's1', type: 'note', note: 'n-1', text: 'Cut a title short', source: 'codex' },
    { seq: 2, id: 'line-2', at, actor: codex, session: 's1', type: 'note', note: 'n-2', text: 'Filed on a Friday', source: 'codex' },
    { seq: 3, id: 'line-3', at, actor: codex, type: 'settled', note: 'n-2', outcome: 'dropped' },
    { seq: 4, id: 'line-4', at, actor: codex, type: 'save', name: 'before', note: 'A save keeps its note' },
  ];
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), `${old.map(line => JSON.stringify(line)).join('\n')}\n`);
  const lines = await openJournal(dir).read();
  assert.deepEqual(lines.map(line => [line.type, line.observation ?? line.name]), [['observation', 'n-1'], ['observation', 'n-2'], ['settled', 'n-2'], ['save', 'before']]);
  assert.equal(lines[3].note, 'A save keeps its note');
  const cortex = openCortex(dir, { actor: 'claude-code' });
  assert.deepEqual((await cortex.listObservations()).observations.map(item => item.id), ['n-1']);
  await cortex.settle({ observations: [{ id: 'n-1', outcome: 'kept' }] });
  assert.deepEqual((await cortex.listObservations()).observations, []);
  assert.equal((await cortex.start()).observations.length, 0);
});

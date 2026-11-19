import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;
// A cortex opened on a given day, so the journal's times are known.
const on = (dir, actor, day) => openCortex(dir, { actor, now: () => new Date(`${day}T12:00:00.000Z`) });
const tools = (dir, actor, day) => createTools(on(dir, actor, day));
// The person accepts what is waiting, on a given day.
const accept = async (dir, day) => {
  const person = on(dir, 'member', day);
  for (const item of await person.proposals()) if (item.node !== 'identity') await person.accept(item.id);
};
const memory = body => ({ name: 'likes-short-titles', description: 'Titles of four words or fewer', kind: 'preference', stated: true, body });

// Three days: Claude Code writes a memory, Codex rewrites it, the person confirms a birthdate. A save in between.
async function threeDays() {
  const dir = await fresh();
  const one = await on(dir, 'claude-code', '2026-11-01').write(memory('Short titles.'));
  await accept(dir, '2026-11-01');
  await tools(dir, 'claude-code', '2026-11-01').call('cortex_save', { name: 'before-codex', note: 'Before Codex took over the titles' });
  const two = await on(dir, 'codex', '2026-11-02').write(memory('Short titles, no colons.'), { replaces: one.version });
  await accept(dir, '2026-11-02');
  const person = on(dir, 'member', '2026-11-03');
  await person.proposeIdentity({ field: 'birthdate', value: '1990-04-02', source: { kind: 'person', quote: 'born 2 April 1990' } });
  await person.confirmIdentity('birthdate');
  return { dir, one, two };
}

test('cortex_history lists changes, filtered by node, since a seq or a date, and by who made them', async () => {
  const { dir, one, two } = await threeDays();
  const call = (args = {}) => tools(dir, 'claude-code', '2026-11-04').call('cortex_history', args);

  const all = await call();
  assert.deepEqual(all.changes.map(line => [line.node, line.op, line.actor.name]), [
    ['memory/likes-short-titles', 'create', 'claude-code'],
    ['memory/likes-short-titles', 'update', 'codex'],
    ['identity', 'update', 'member'],
  ]);
  // An agent's change points at its proposal and the person's decision.
  assert.ok(all.changes[0].proposal && all.changes[0].decision);
  assert.equal(all.changes[2].actor.name, 'member', 'the person proposed it, and confirmed it');
  assert.deepEqual(all.saves.map(save => [save.name, save.note]), [['before-codex', 'Before Codex took over the titles']]);
  assert.deepEqual((await call({ node: 'memory/likes-short-titles' })).changes.map(line => [line.before, line.after]), [[null, one.version], [one.version, two.version]]);
  assert.equal((await call({ node: 'memory/' })).changes.length, 2, 'a folder ending in / takes every node in it');
  assert.deepEqual((await call({ actor: 'codex' })).changes.map(line => line.op), ['update']);
  assert.deepEqual((await call({ actor: 'human' })).changes.map(line => line.node), ['identity']);
  assert.deepEqual((await call({ actor: 'agent' })).changes.length, 2);
  const seq = all.changes[0].seq;
  assert.deepEqual((await call({ since: seq })).changes.map(line => line.actor.name), ['codex', 'member'], 'since a seq: after it');
  assert.deepEqual((await call({ since: String(seq) })).changes.length, 2);
  assert.deepEqual((await call({ since: '2026-11-02' })).changes.map(line => line.actor.name), ['codex', 'member'], 'since a date: from that day on');
  assert.deepEqual((await call({ since: '2026-11-03T00:00:00Z' })).changes.map(line => line.actor.name), ['member']);
  const limited = await call({ limit: 1 });
  assert.deepEqual([limited.changes.map(line => line.actor.name), limited.more], [['member'], 2]);
  await assert.rejects(call({ since: 'last tuesday' }), refused('InvalidRequest'));
  await assert.rejects(call({ limit: 0 }), refused('InvalidRequest'));
});

test('cortex_as_of reads a node back as it was at a save, a date or a seq', async () => {
  const { dir, one, two } = await threeDays();
  const asOf = at => tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'memory/likes-short-titles', at });
  const atSave = await asOf('before-codex');
  assert.deepEqual([atSave.version, atSave.as.save], [one.version, 'before-codex']);
  assert.match(atSave.text, /^---\n[\s\S]*\n---\nShort titles\.$/);
  assert.equal((await asOf('2026-11-01')).version, one.version, 'a date means the end of that day');
  assert.equal((await asOf('2026-11-02')).version, two.version);
  assert.match((await asOf('2026-11-02')).text, /no colons/);
  assert.equal((await asOf('2026-10-31')).exists, false, 'before it was written');
  const { changes } = await tools(dir, 'claude-code', '2026-11-04').call('cortex_history', { node: 'memory/likes-short-titles' });
  assert.equal((await asOf(changes[0].seq)).version, one.version);
  assert.equal((await asOf(String(changes[1].seq))).version, two.version);
  await assert.rejects(asOf('no-such-save'), refused('NotFound'));
  await assert.rejects(tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'agents/secrets/key', at: 1 }), refused('NotFound'));

  // A node that has not changed since the journal began reads as it is now.
  const style = await tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'memory/working-style', at: 1 });
  assert.match(style.text, /No working preferences have been stated yet/);

  // An agent reads identity as it was, as an agent sees it: the birthdate is never shown.
  const identity = await tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'identity', at: '2026-11-03' });
  assert.deepEqual(identity.identity.hidden, ['birthdate']);
  assert.equal(identity.text, undefined);
  assert.doesNotMatch(JSON.stringify(identity), /1990/);
  const before = await tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'identity', at: '2026-11-02' });
  assert.equal(before.identity.hidden, undefined);
  // The person reads it in full.
  assert.match(execFileSync('node', [cli, 'as-of', 'identity', '2026-11-03', dir], { encoding: 'utf8' }), /birthdate: "1990-04-02"/);

  // Working memory rewritten within a session is not kept, and as_of says so.
  const agent = on(dir, 'claude-code', '2026-11-05');
  const w1 = await agent.writeWorking('First draft of today.');
  await createTools(agent).call('cortex_save', { name: 'mid-session', note: 'Halfway' });
  await agent.writeWorking('Second draft of today.', { replaces: w1.version });
  const kept = await createTools(agent).call('cortex_as_of', { node: 'working/claude-code', at: 'mid-session' });
  assert.deepEqual([kept.version, kept.kept, kept.text], [w1.version, false, undefined]);
});

test('cortex_save names a point with a note, once, and changes nothing', async () => {
  const dir = await fresh();
  const call = args => tools(dir, 'codex', '2026-11-10').call('cortex_save', args);
  const done = await call({ name: 'before-redesign', note: 'Before the essays move to channels' });
  assert.equal(done.name, 'before-redesign');
  const line = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(text => JSON.parse(text)).at(-1);
  assert.deepEqual([line.type, line.seq, line.name, line.note, line.actor], ['save', done.seq, 'before-redesign', 'Before the essays move to channels', { kind: 'agent', name: 'codex' }]);
  await assert.rejects(call({ name: 'before-redesign', note: 'Again' }), refused('NameTaken'));
  for (const name of ['Before', '12', '2026-11-10', 'two words', '']) await assert.rejects(call({ name, note: 'x' }), refused('InvalidRequest'), name);
  await assert.rejects(call({ name: 'v2', note: 'two\nlines' }), refused('InvalidRequest'));
  assert.equal((await call({ name: 'v2', note: 'Version two' })).name, 'v2');
  // A save changes no file: the only line it adds is itself.
  const files = await readdir(dir, { recursive: true });
  await call({ name: 'v3', note: 'Nothing changes' });
  assert.deepEqual(await readdir(dir, { recursive: true }), files);
  assert.equal((await tools(dir, 'codex', '2026-11-10').call('cortex_history')).changes.length, 0);
  // A line written as a stamp, before the name changed, reads as a save.
  await appendFile(join(dir, '.cortex', 'journal.jsonl'), `${JSON.stringify({ seq: 99, id: 'old-stamp', at: '2026-11-10T13:00:00.000Z', actor: { kind: 'agent', name: 'codex' }, type: 'stamp', name: 'from-before', note: 'Written as a stamp' })}\n`);
  assert.equal((await tools(dir, 'codex', '2026-11-10').call('cortex_as_of', { node: 'memory/working-style', at: 'from-before' })).as.save, 'from-before');
  // The person saves from the command line.
  assert.match(execFileSync('node', [cli, 'save', 'end-of-year', 'Kept as it was in December', dir], { encoding: 'utf8' }), /Saved end-of-year/);
  const history = JSON.parse(execFileSync('node', [cli, 'history', dir, '--json'], { encoding: 'utf8' }));
  assert.deepEqual(history.saves.map(save => [save.name, save.actor.kind]), [['before-redesign', 'agent'], ['v2', 'agent'], ['v3', 'agent'], ['from-before', 'agent'], ['end-of-year', 'human']]);
});

test('restoring is a new change: what it replaces is kept, and no line is rewritten', async () => {
  const { dir, one, two } = await threeDays();
  const journal = () => readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8');
  const before = await journal();
  const codex = tools(dir, 'codex', '2026-11-06');
  await assert.rejects(codex.call('cortex_restore', { node: 'memory/likes-short-titles', to: one.version, version: 'cstale' }), refused('Changed'));
  const done = await codex.call('cortex_restore', { node: 'memory/likes-short-titles', to: one.version, version: two.version, reason: 'The person wants colons back' });
  assert.deepEqual([done.restored, done.version, done.waiting], [one.version, one.version, true]);
  await accept(dir, '2026-11-06');
  const after = await journal();
  assert.ok(after.startsWith(before), 'every earlier line is as it was');
  const line = JSON.parse(after.trim().split('\n').at(-1));
  assert.deepEqual([line.type, line.node, line.op, line.before, line.after, line.reason, line.actor.name], ['change', 'memory/likes-short-titles', 'restore', two.version, one.version, 'The person wants colons back', 'codex']);
  const cortex = on(dir, 'codex', '2026-11-06');
  assert.equal((await cortex.read('likes-short-titles')).memory.body, 'Short titles.');
  assert.equal((await cortex.read('likes-short-titles', { version: two.version })).memory.body, 'Short titles, no colons.', 'the replaced version is kept');
  assert.equal((await codex.call('cortex_restore', { node: 'memory/likes-short-titles', to: one.version, version: one.version })).unchanged, true);

  // A removed memory comes back the same way.
  await cortex.remove('likes-short-titles', { replaces: one.version });
  await accept(dir, '2026-11-06');
  await codex.call('cortex_restore', { node: 'memory/likes-short-titles', to: two.version });
  await accept(dir, '2026-11-06');
  assert.match(await readFile(join(dir, 'memory', 'MEMORY.md'), 'utf8'), /likes-short-titles/);
  await assert.rejects(codex.call('cortex_restore', { node: 'memory/likes-short-titles', to: 'cnothing', version: two.version }), refused('NotFound'));

  // An agent never restores identity, the playbook, or another agent's working memory.
  const identity = (await codex.call('cortex_history', { node: 'identity' })).changes[0];
  await assert.rejects(codex.call('cortex_restore', { node: 'identity', to: identity.before }), refused('PersonOnly'));
  await assert.rejects(codex.call('cortex_restore', { node: 'playbook', to: 'cx' }), refused('PersonOnly'));
  await assert.rejects(codex.call('cortex_restore', { node: 'working/claude-code', to: 'cx' }), refused('PersonOnly'));
  // The person does, from the command line.
  assert.match(execFileSync('node', [cli, 'restore', 'identity', identity.before, dir], { encoding: 'utf8' }), /is back to/);
  assert.equal((await cortex.identity()).fields.birthdate, undefined);
  const last = JSON.parse((await journal()).trim().split('\n').at(-1));
  assert.deepEqual([last.node, last.op, last.actor], ['identity', 'restore', { kind: 'human', name: 'member' }]);
  assert.match(execFileSync('node', [cli, 'history', dir, '--node', 'identity'], { encoding: 'utf8' }), /member {2}restore identity/);
});

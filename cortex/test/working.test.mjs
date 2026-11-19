import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const refused = code => problem => problem.code === code || (() => { try { return JSON.parse(problem.message).error === code; } catch { return false; } })();
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const as = (dir, agent) => createTools(openCortex(dir, { actor: agent }));

test('each agent keeps its own working memory, and reads the others', async () => {
  const dir = await fresh();
  const claude = as(dir, 'claude-code');
  const codex = as(dir, 'codex');
  const first = await claude.call('cortex_start');
  assert.deepEqual(first.working, { mine: { agent: 'claude-code', text: '', version: null }, others: [] });

  const mine = await claude.call('cortex_working', { text: 'Answering in Portuguese today. Filing three notes, one done.' });
  await codex.call('cortex_working', { text: 'Refactoring the map renderer.' });
  const seen = await claude.call('cortex_start');
  assert.equal(seen.working.mine.text, 'Answering in Portuguese today. Filing three notes, one done.');
  assert.deepEqual(seen.working.others.map(item => [item.agent, item.text]), [['codex', 'Refactoring the map renderer.']]);
  assert.deepEqual((await readdir(join(dir, '.cortex', 'working'))).sort(), ['claude-code.md', 'codex.md']);

  await assert.rejects(claude.call('cortex_working', { text: 'Something else.' }), refused('Changed'));
  await assert.rejects(claude.call('cortex_working', { text: 'Something else.', version: 'cstale' }), refused('Changed'));
  const next = await claude.call('cortex_working', { text: 'Two notes done.', version: mine.version });
  assert.notEqual(next.version, mine.version);
  assert.equal((await codex.call('cortex_start')).working.mine.text, 'Refactoring the map renderer.', 'one agent never writes another\'s');
});

test('an agent\'s name cannot reach outside its own file', async () => {
  const dir = await fresh();
  const odd = as(dir, '../../Agent:Member');
  const done = await odd.call('cortex_working', { text: 'x' });
  assert.equal(done.agent, 'agent-member');
  assert.deepEqual(await readdir(join(dir, '.cortex', 'working')), ['agent-member.md']);
  await assert.rejects(odd.call('cortex_working', { text: 'x'.repeat(9000), version: done.version }), refused('InvalidRequest'));
});

test('distilling records what was seen again, leaves what is open, and keeps what it replaced', async () => {
  const dir = await fresh();
  const claude = as(dir, 'claude-code');
  const { version } = await claude.call('cortex_working', { text: 'They shortened my title again. Thread: the atlas essay is half filed.' });
  await assert.rejects(claude.call('cortex_distill', { session: 's1', working: 'x' }), refused('Changed'));
  const done = await claude.call('cortex_distill', { session: 's1', version, notes: [{ id: 'n-titles-s1', note: 'Shortened a title I proposed, again' }], working: 'Open: the atlas essay is half filed.' });
  assert.deepEqual(done.noted, ['n-titles-s1']);
  assert.equal((await claude.call('cortex_start')).working.mine.text, 'Open: the atlas essay is half filed.');
  const [kept] = await readdir(join(dir, '.cortex', 'history', 'working', 'claude-code'));
  assert.match(await readFile(join(dir, '.cortex', 'history', 'working', 'claude-code', kept), 'utf8'), /shortened my title again/);
  const note = (await claude.call('cortex_start')).notes.find(item => item.id === 'n-titles-s1');
  assert.deepEqual([note.session, note.writtenBy], ['s1', 'claude-code']);
});

test('something noticed in two sessions becomes a memory in the third, with nobody asked', async () => {
  const dir = await fresh();
  // Session one, in Claude Code: noticed, and seen again within the session.
  const claude = as(dir, 'claude-code');
  const w1 = await claude.call('cortex_working', { text: 'They cut my proposed titles to three words, twice.' });
  await claude.call('cortex_distill', { session: 'claude-1', version: w1.version, notes: [{ id: 'titles-claude-1', note: 'Cut proposed titles down to three words' }], working: '' });

  // Session two, in Codex: the same thing, seen by another agent.
  const codex = as(dir, 'codex');
  const start2 = await codex.call('cortex_start');
  assert.equal(start2.notes.length, 1);
  await codex.call('cortex_settle', { notes: [{ id: 'titles-claude-1', outcome: 'kept' }] });
  const w2 = await codex.call('cortex_working', { text: 'Titles again cut to three words.' });
  await codex.call('cortex_distill', { session: 'codex-2', version: w2.version, notes: [{ id: 'titles-codex-2', note: 'Cut a proposed title to three words' }], working: '' });

  // Session three: two notes from two sessions agree, so the agent writes the memory and settles them.
  const third = await claude.call('cortex_start');
  const titles = (await claude.call('cortex_settle')).notes.concat((await claude.call('cortex_settle')).kept).filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  assert.deepEqual(new Set(titles.map(item => item.session)), new Set(['claude-1', 'codex-2']));
  assert.equal(third.memories.some(memory => memory.name === 'short-titles'), false);
  const settled = await claude.call('cortex_settle', {
    changes: [{ memory: { name: 'short-titles', description: 'Wants titles of three words or fewer', kind: 'preference', stated: false, body: 'Cut proposed titles to three words in two sessions, in two agents.', notes: ['titles-claude-1', 'titles-codex-2'] } }],
    notes: [{ id: 'titles-claude-1', outcome: 'short-titles' }, { id: 'titles-codex-2', outcome: 'short-titles' }],
  });
  assert.equal(settled.complete, true);
  // The memory is written at once, as one change marked with the agent that settled it.
  const [change] = (await openCortex(dir).history({ node: 'memory/short-titles' })).changes;
  assert.deepEqual([change.actor.name, change.id], ['claude-code', settled.memories[0].change]);
  const { memory } = await openCortex(dir).read('short-titles');
  assert.deepEqual([memory.stated, memory.writtenBy, memory.seen.count], [false, 'claude-code', 2]);
  assert.equal((await openCortex(dir).identityLog()).length, 0, 'the person was not asked anything');
});

test('the person can read or clear any working memory, and a client can read them as resources', async () => {
  const dir = await fresh();
  await as(dir, 'codex').call('cortex_working', { text: 'Open: renaming the reading section.' });
  const lines = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } },
    { jsonrpc: '2.0', id: 1, method: 'resources/list' },
    { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'cortex://working/codex' } },
    { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'cortex://working/../memory' } },
  ].map(line => JSON.stringify(line)).join('\n');
  const answers = Object.fromEntries(execFileSync('node', [cli, 'mcp', dir], { input: `${lines}\n`, encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line)).map(message => [message.id, message]));
  assert.ok(answers[1].result.resources.some(resource => resource.uri === 'cortex://working/codex'));
  assert.equal(answers[2].result.contents[0].text, 'Open: renaming the reading section.');
  assert.equal(answers[3].error.code, -32002);
  await rm(join(dir, '.cortex', 'working', 'codex.md'));
  assert.deepEqual((await openCortex(dir, { actor: 'claude-code' }).start()).working.others, []);
});

test('a refused distill writes nothing', async () => {
  const dir = await fresh();
  const codex = openCortex(dir, { actor: 'codex' });
  await codex.addNote({ id: 'taken', note: 'Already here', session: 's0' });
  const { version } = await codex.writeWorking('today');
  for (const notes of [
    [{ id: 'a', note: 'one' }, { id: 'b', note: 'two' }, { id: 'c', note: 'three\nlines' }],
    [{ id: 'a', note: 'one' }, { id: 'a', note: 'one again' }],
    [{ id: 'a', note: 'one' }, { id: 'taken', note: 'Something else' }],
  ]) await assert.rejects(codex.distill({ session: 's1', version, working: 'next', notes }), problem => ['InvalidRequest', 'Changed'].includes(problem.code));
  assert.deepEqual((await codex.listNotes()).notes.map(note => note.id), ['taken']);
  assert.equal((await codex.working()).mine.text, 'today');
});

test('other agents\' working memory says when it was written, newest first', async () => {
  const dir = await fresh();
  await openCortex(dir, { actor: 'codex' }).writeWorking('Open: the atlas essay.');
  await openCortex(dir, { actor: 'cursor' }).writeWorking('Open: tidying links.');
  const weeksAgo = new Date(Date.now() - 21 * 24 * 3600 * 1000);
  await utimes(join(dir, '.cortex', 'working', 'codex.md'), weeksAgo, weeksAgo);
  const { others } = (await openCortex(dir, { actor: 'claude-code' }).start()).working;
  assert.deepEqual(others.map(item => item.agent), ['cursor', 'codex']);
  assert.equal(others[1].updated, weeksAgo.toISOString());
});

test('clearing working memory removes it, and keeps what it said', async () => {
  const dir = await fresh();
  const codex = openCortex(dir, { actor: 'codex' });
  const first = await codex.writeWorking('Open: renaming the reading section.');
  assert.equal((await codex.distill({ session: 's1', version: first.version, working: '' })).working.cleared, true);
  assert.deepEqual((await openCortex(dir, { actor: 'claude-code' }).start()).working.others, []);
  assert.deepEqual(await readdir(join(dir, '.cortex', 'working')), []);
  assert.equal((await readdir(join(dir, '.cortex', 'history', 'working', 'codex'))).length, 1);
  const again = await codex.writeWorking('Open: one more thing.');
  assert.equal((await codex.writeWorking('  ', { replaces: again.version })).cleared, true);
  assert.equal((await readdir(join(dir, '.cortex', 'history', 'working', 'codex'))).length, 2);
});

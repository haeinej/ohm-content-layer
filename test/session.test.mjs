import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person and project here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;
const journal = async dir => (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const memory = body => ({ name: 'likes-short-titles', description: 'Titles of four words or fewer', kind: 'preference', stated: true, body });

test('an agent records a finished task: what was done, what it made, and the dead ends', async () => {
  const dir = await fresh();
  const tools = createTools(openCortex(dir, { actor: 'codex' }));
  const proposed = await tools.call('cortex_remember', { memory: memory('Short titles.') });
  const working = await tools.call('cortex_working', { text: 'Renaming the reading channel.' });
  const changeId = (await journal(dir)).at(-1).id;
  const done = await tools.call('cortex_session', {
    summary: 'Tidied how reading notes are titled', made: [proposed.proposed, changeId], project: '/home/sam/atlas', session: 'codex-7',
    deadEnds: [
      { tried: 'Titling reading notes by author', why: 'Sam files by book, not author', check: 'grep -l author notes/reading' },
      { tried: 'Moving notes/reading under essays', why: 'Sam wants them apart' },
    ],
  });
  assert.equal(done.deadEnds.length, 2);
  const line = (await journal(dir)).at(-1);
  assert.deepEqual([line.type, line.summary, line.outcome, line.made, line.project, line.session, line.actor.name], ['session', 'Tidied how reading notes are titled', 'done', [proposed.proposed, changeId], '/home/sam/atlas', 'codex-7', 'codex']);
  assert.deepEqual(line.deadEnds.map(item => [item.id, item.tried, item.check]), [[done.deadEnds[0], 'Titling reading notes by author', 'grep -l author notes/reading'], [done.deadEnds[1], 'Moving notes/reading under essays', undefined]]);
  assert.ok(working.version);

  // Only what this agent made can be grouped, and only what exists.
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: ['pnothing'] }), refused('NotFound'));
  const other = await createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_remember', { memory: { ...memory('x'), name: 'likes-maps' } });
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: [other.proposed] }), refused('InvalidRequest'));
  for (const bad of [{ summary: '' }, { summary: 'two\nlines' }, { summary: 'x', outcome: 'maybe' }, { summary: 'x', deadEnds: [{ tried: 'x' }] }, { summary: 'x', deadEnds: [{ tried: 'x', why: 'y', when: 'z' }] }]) {
    await assert.rejects(tools.call('cortex_session', bad), refused('InvalidRequest'), JSON.stringify(bad));
  }
  // The person does not write sessions.
  await assert.rejects(openCortex(dir, { actor: 'member' }).recordSession({ summary: 'x' }), refused('InvalidRequest'));

  // A task given up is a session too.
  await tools.call('cortex_session', { summary: 'Tried to merge two channels', outcome: 'stopped', project: '/home/sam/other', deadEnds: [{ tried: 'Merging notes and essays', why: 'The person said no' }] });
  assert.equal((await journal(dir)).at(-1).outcome, 'stopped');
});

test('open dead ends are shown at the start: all of them to cortex_start, the ones near the project to the hook', async () => {
  const dir = await fresh();
  const codex = createTools(openCortex(dir, { actor: 'codex' }));
  const atlas = await codex.call('cortex_session', { summary: 'Atlas work', project: '/home/sam/atlas', deadEnds: [{ tried: 'Titling by author', why: 'Filed by book', check: 'ls notes/reading' }] });
  await codex.call('cortex_session', { summary: 'Garden work', project: '/home/sam/garden', deadEnds: [{ tried: 'Splitting the seed list', why: 'One list is easier' }] });

  const start = await createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_start');
  assert.deepEqual(start.deadEnds.map(item => [item.tried, item.agent, item.project]), [['Splitting the seed list', 'codex', '/home/sam/garden'], ['Titling by author', 'codex', '/home/sam/atlas']]);

  const hook = cwd => JSON.parse(spawnSync('node', [cli, 'hook', 'session-start', dir, '--agent', 'claude-code'], { input: JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8' }).stdout).hookSpecificOutput.additionalContext;
  const near = hook('/home/sam/atlas/notes');
  assert.match(near, /## Dead ends near this project\n\n- Titling by author: Filed by book \(check: ls notes\/reading\)/);
  assert.doesNotMatch(near, /seed list/);
  assert.doesNotMatch(hook('/home/sam/elsewhere'), /Dead ends/);

  // A later session marks a dead end resolved; it is no longer shown.
  await codex.call('cortex_session', { summary: 'Retitled by author after all', project: '/home/sam/atlas', resolved: [atlas.deadEnds[0]] });
  assert.doesNotMatch(hook('/home/sam/atlas'), /Titling by author/);
  assert.deepEqual((await openCortex(dir).deadEnds()).map(item => item.tried), ['Splitting the seed list']);
  await assert.rejects(codex.call('cortex_session', { summary: 'x', resolved: [atlas.deadEnds[0]] }), refused('NotFound'));
});

test('reverting a change is a new change back to what was before; an agent proposes it, the person accepts', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  const one = await person.write(memory('Short titles.'));
  const two = await person.write(memory('Short titles, no colons.'), { replaces: one.version });
  const lines = (await journal(dir)).filter(line => line.type === 'change');
  const [created, updated] = lines;

  const agent = createTools(openCortex(dir, { actor: 'codex' }));
  await assert.rejects(agent.call('cortex_revert', { change: created.seq }), refused('Changed'), 'the node has changed since');
  const proposed = await agent.call('cortex_revert', { change: updated.seq, reason: 'The colons were fine' });
  assert.deepEqual([proposed.waiting, proposed.reverted, proposed.version], [true, updated.id, one.version]);
  await person.accept(proposed.proposed);
  const change = (await journal(dir)).at(-1);
  assert.deepEqual([change.op, change.before, change.after, change.reverts, change.actor.name, change.reason], ['restore', two.version, one.version, updated.id, 'codex', 'The colons were fine']);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles.');

  // Reverting the change that made a node removes it. The person reverts from the command line.
  const restored = (await journal(dir)).at(-1);
  assert.match(execFileSync('node', [cli, 'revert', String(restored.seq), dir], { encoding: 'utf8' }), /is undone/);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles, no colons.');
  const again = (await journal(dir)).at(-1);
  execFileSync('node', [cli, 'revert', again.id, dir]);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles.');
  // The memory is now as its first change made it, so reverting that change removes it.
  execFileSync('node', [cli, 'revert', String(created.seq), dir]);
  await assert.rejects(person.read('likes-short-titles'), refused('NotFound'));
  assert.deepEqual((await journal(dir)).at(-1).op, 'remove');
  await assert.rejects(person.revert({ change: 'no-such-change' }), refused('NotFound'));
});

test('the person reads, accepts and rejects proposals from the command line', async () => {
  const dir = await fresh();
  const agent = openCortex(dir, { actor: 'codex' });
  const one = await agent.write(memory('Short titles.'), { reason: 'Said twice' });
  const tool = await agent.proposeTool({ name: 'calendar', description: 'Reads the calendar', inputs: 'A day', outputs: 'Events' });
  await agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'person', quote: 'I live in Lisbon' } });

  const listed = execFileSync('node', [cli, 'proposals', dir], { encoding: 'utf8' });
  assert.match(listed, new RegExp(`${one.proposed} {2}codex proposes to create memory/likes-short-titles\\n  why: Said twice\\n  \\| ---`));
  assert.match(listed, /city: "Lisbon"/);
  assert.equal(JSON.parse(execFileSync('node', [cli, 'proposals', dir, '--json'], { encoding: 'utf8' })).length, 3);

  assert.match(execFileSync('node', [cli, 'accept', one.proposed, dir, '--reason', 'Yes, always'], { encoding: 'utf8' }), /accepted: memory\/likes-short-titles changed/);
  assert.equal((await journal(dir)).filter(line => line.type === 'decision').at(-1).reason, 'Yes, always');
  assert.match(execFileSync('node', [cli, 'reject', tool.proposed, dir], { encoding: 'utf8' }), /turned down/);
  assert.match(execFileSync('node', [cli, 'accept', 'city', dir], { encoding: 'utf8' }), /city is now "Lisbon"/);
  assert.equal(execFileSync('node', [cli, 'proposals', dir], { encoding: 'utf8' }).trim(), 'Nothing is waiting.');
  assert.throws(() => execFileSync('node', [cli, 'accept', one.proposed, dir], { stdio: 'pipe' }), 'already decided');

  // No tool an agent is given accepts or rejects.
  assert.equal(createTools(agent).list.some(item => /accept|reject|approve|confirm/.test(item.name)), false);
});

test('working memory is the one thing an agent writes without a proposal, so the hooks can follow it', async () => {
  const dir = await fresh();
  const agent = openCortex(dir, { actor: 'claude-code' });
  const written = await createTools(agent).call('cortex_working', { text: 'Filing two notes.' });
  assert.equal((await agent.working()).mine.version, written.version);
  assert.deepEqual(await agent.proposals(), []);
  const change = (await journal(dir)).at(-1);
  assert.deepEqual([change.type, change.node, change.actor.name, change.proposal], ['change', 'working/claude-code', 'claude-code', undefined]);
  // The stop hook sees the change at once, and asks for a distill.
  const stop = () => spawnSync('node', [cli, 'hook', 'stop', dir, '--agent', 'claude-code'], { input: JSON.stringify({ session_id: 'w1', hook_event_name: 'Stop', stop_hook_active: false }), encoding: 'utf8' }).stdout;
  assert.equal(stop(), '', 'the first stop of a session starts it');
  await agent.writeWorking('Filing two notes. One done.', { replaces: written.version });
  assert.match(stop(), /cortex_distill/);
  // Another agent's working memory is never written, nor restored.
  await assert.rejects(createTools(openCortex(dir, { actor: 'codex' })).call('cortex_restore', { node: 'working/claude-code', to: written.version }), refused('PersonOnly'));
});

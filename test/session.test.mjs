import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('an agent records a finished task: what was done, the changes it made, and the dead ends', async () => {
  const dir = await fresh();
  const tools = createTools(openCortex(dir, { actor: 'codex' }));
  const remembered = await tools.call('cortex_remember', { memory: memory('Short titles.') });
  const working = await tools.call('cortex_working', { text: 'Renaming the reading channel.' });
  const changeId = (await journal(dir)).at(-1).id;
  assert.deepEqual((await journal(dir)).filter(line => line.type === 'change').map(line => line.id), [remembered.change, changeId], 'each write returns the ID of its change');
  const done = await tools.call('cortex_session', {
    summary: 'Tidied how reading notes are titled', made: [remembered.change, changeId], project: '/home/sam/atlas', session: 'codex-7',
    deadEnds: [
      { tried: 'Titling reading notes by author', why: 'Sam files by book, not author', check: 'grep -l author notes/reading' },
      { tried: 'Moving notes/reading under essays', why: 'Sam wants them apart' },
    ],
  });
  assert.equal(done.deadEnds.length, 2);
  const line = (await journal(dir)).at(-1);
  assert.deepEqual([line.type, line.summary, line.outcome, line.made, line.project, line.session, line.actor.name], ['session', 'Tidied how reading notes are titled', 'done', [remembered.change, changeId], '/home/sam/atlas', 'codex-7', 'codex']);
  assert.deepEqual(line.deadEnds.map(item => [item.id, item.tried, item.check]), [[done.deadEnds[0], 'Titling reading notes by author', 'grep -l author notes/reading'], [done.deadEnds[1], 'Moving notes/reading under essays', undefined]]);
  assert.ok(working.version);

  // Only what this agent made can be grouped, and only what exists.
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: ['pnothing'] }), refused('NotFound'));
  const other = await createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_remember', { memory: { ...memory('x'), name: 'likes-maps' } });
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: [other.change] }), refused('InvalidRequest'));
  // A session groups changes, not other lines.
  const note = await openCortex(dir, { actor: 'codex' }).addNote({ id: 'n1', note: 'Seen', session: 's1' });
  const noteLine = (await journal(dir)).find(line => line.type === 'note' && line.note === note.id);
  await assert.rejects(tools.call('cortex_session', { summary: 'x', made: [noteLine.id] }), refused('NotFound'));
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

test('reverting a change is a new change back to what was before, by an agent or the person', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  const one = await person.write(memory('Short titles.'));
  const two = await person.write(memory('Short titles, no colons.'), { replaces: one.version });
  const lines = (await journal(dir)).filter(line => line.type === 'change');
  const [created, updated] = lines;

  const agent = createTools(openCortex(dir, { actor: 'codex' }));
  await assert.rejects(agent.call('cortex_revert', { change: created.seq }), refused('Changed'), 'the node has changed since');
  const reverted = await agent.call('cortex_revert', { change: updated.seq, reason: 'The colons were fine' });
  assert.deepEqual([reverted.reverted, reverted.version], [updated.id, one.version]);
  const change = (await journal(dir)).at(-1);
  assert.deepEqual([change.id, change.op, change.before, change.after, change.reverts, change.actor.name, change.reason], [reverted.change, 'restore', two.version, one.version, updated.id, 'codex', 'The colons were fine']);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles.');

  // Reverting the change that made a node removes it. The person reverts from the command line.
  const restored = (await journal(dir)).at(-1);
  assert.match(execFileSync('node', [cli, 'revert', String(restored.seq), dir, '--reason', 'No colons after all'], { encoding: 'utf8' }), /is undone/);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles, no colons.');
  const again = (await journal(dir)).at(-1);
  assert.deepEqual([again.actor.kind, again.reason], ['human', 'No colons after all']);
  execFileSync('node', [cli, 'revert', again.id, dir]);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles.');
  // The memory is now as its first change made it, so reverting that change removes it.
  execFileSync('node', [cli, 'revert', String(created.seq), dir]);
  await assert.rejects(person.read('likes-short-titles'), refused('NotFound'));
  assert.deepEqual((await journal(dir)).at(-1).op, 'remove');
  await assert.rejects(person.revert({ change: 'no-such-change' }), refused('NotFound'));
});

test('the person reverts or restores what an agent wrote, and the agent\'s versions stay in history', async () => {
  const dir = await fresh();
  const codex = createTools(openCortex(dir, { actor: 'codex' }));
  const person = openCortex(dir, { actor: 'member' });
  // The agent writes a memory, then rewrites it: two changes marked as its own.
  const first = await codex.call('cortex_remember', { memory: memory('Short titles.'), reason: 'Said so twice' });
  const second = await codex.call('cortex_remember', { memory: memory('Titles of one word.'), version: first.version, reason: 'Guessed from one title' });
  const { changes } = await person.history({ actor: 'codex' });
  assert.deepEqual(changes.map(line => [line.id, line.op, line.reason]), [[first.change, 'create', 'Said so twice'], [second.change, 'update', 'Guessed from one title']]);

  // The person does not want the rewrite, and reverts it.
  assert.match(execFileSync('node', [cli, 'revert', second.change, dir], { encoding: 'utf8' }), /is undone/);
  assert.equal((await person.read('likes-short-titles')).memory.body, 'Short titles.');
  const undo = (await journal(dir)).at(-1);
  assert.deepEqual([undo.actor.kind, undo.op, undo.reverts, undo.after], ['human', 'restore', second.change, first.version]);
  // The agent's version is still in history, and can be brought back by version.
  assert.equal((await person.read('likes-short-titles', { version: second.version })).memory.body, 'Titles of one word.');
  assert.match(execFileSync('node', [cli, 'restore', 'memory/likes-short-titles', second.version, dir, '--reason', 'It was right'], { encoding: 'utf8' }), /is back to/);
  assert.deepEqual(await journal(dir).then(all => [all.at(-1).actor.kind, all.at(-1).restores, all.at(-1).reason]), ['human', second.version, 'It was right']);
  // The person reverts the agent's very first change too: the memory goes, and is kept.
  execFileSync('node', [cli, 'restore', 'memory/likes-short-titles', first.version, dir]);
  execFileSync('node', [cli, 'revert', first.change, dir]);
  await assert.rejects(person.read('likes-short-titles'), refused('NotFound'));
  assert.equal((await person.read('likes-short-titles', { version: first.version })).memory.body, 'Short titles.');
  // Nothing in the journal was rewritten: the agent's two changes are where they were.
  assert.deepEqual((await person.history({ actor: 'agent' })).changes.map(line => line.id), [first.change, second.change]);
});

test('an agent never writes over what only the person may change, by revert or restore either', async () => {
  const dir = await fresh();
  const vault = join(dir, '..', 'vault');
  await mkdir(join(vault, 'essays'), { recursive: true });
  await writeFile(join(vault, 'essays', 'one.md'), '---\nid: "p1"\ntitle: "On slowness"\n---\nWalking is slow.\n');
  const person = openCortex(dir, { actor: 'member' });
  await person.connectVault({ kind: 'folder', path: vault });
  const codex = createTools(openCortex(dir, { actor: 'codex' }));
  // The person's own words for a channel stand: the agent can neither remove nor replace them.
  const theirs = await person.describeChannel({ channel: 'essays', meaning: 'Essays I would show a stranger' });
  await assert.rejects(codex.call('cortex_revert', { change: theirs.change }), refused('PersonWrote'));
  const agentWords = await codex.call('cortex_describe_channel', { channel: 'essays', conventions: 'Titles start with "On"' });
  // The agent may undo its own words, which leaves the person's.
  await codex.call('cortex_revert', { change: agentWords.change });
  assert.match(await readFile(join(dir, 'vault.md'), 'utf8'), /Meaning: Essays I would show a stranger/);
  assert.doesNotMatch(await readFile(join(dir, 'vault.md'), 'utf8'), /Conventions:/);
  // A skill the person approved is reverted only by the person.
  const agent = openCortex(dir, { actor: 'codex' });
  await agent.proposeSkill({ text: '---\nname: file-a-receipt\ndescription: How receipts are filed\n---\nFile by month.\n' });
  const approved = await person.approveSkill('file-a-receipt');
  await assert.rejects(codex.call('cortex_revert', { change: approved.change }), refused('PersonOnly'));
  await person.revert({ change: approved.change });
  await assert.rejects(agent.getSkill('file-a-receipt'), refused('NotFound'));
});

test('working memory is written at once, so the hooks can follow it, and never by another agent', async () => {
  const dir = await fresh();
  const agent = openCortex(dir, { actor: 'claude-code' });
  const written = await createTools(agent).call('cortex_working', { text: 'Filing two notes.' });
  assert.equal((await agent.working()).mine.version, written.version);
  const change = (await journal(dir)).at(-1);
  assert.deepEqual([change.type, change.node, change.actor.name], ['change', 'working/claude-code', 'claude-code']);
  // The stop hook sees the change at once, and asks for a distill.
  const stop = () => spawnSync('node', [cli, 'hook', 'stop', dir, '--agent', 'claude-code'], { input: JSON.stringify({ session_id: 'w1', hook_event_name: 'Stop', stop_hook_active: false }), encoding: 'utf8' }).stdout;
  assert.equal(stop(), '', 'the first stop of a session starts it');
  await agent.writeWorking('Filing two notes. One done.', { replaces: written.version });
  assert.match(stop(), /cortex_distill/);
  // Another agent's working memory is never written, restored or reverted.
  const codex = createTools(openCortex(dir, { actor: 'codex' }));
  await assert.rejects(codex.call('cortex_restore', { node: 'working/claude-code', to: written.version }), refused('PersonOnly'));
  await assert.rejects(codex.call('cortex_revert', { change: change.id }), refused('PersonOnly'));
});

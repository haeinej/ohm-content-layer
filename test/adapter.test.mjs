import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ASK, LIMIT } from '../src/adapter.mjs';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented. The hook inputs are synthetic, shaped as each client documents them.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};

// What Claude Code hands a hook on standard input.
const claude = {
  'session-start': session => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5' }),
  prompt: session => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', permission_mode: 'default', hook_event_name: 'UserPromptSubmit', prompt: 'Tidy the essays section' }),
  stop: (session, active = false) => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: active, last_assistant_message: 'Done.', background_tasks: [], session_crons: [] }),
  'session-end': session => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }),
};
// What Codex hands a hook on standard input.
const codex = {
  'session-start': session => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'SessionStart', model: 'gpt-5-codex', source: 'startup' }),
  prompt: session => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'UserPromptSubmit', model: 'gpt-5-codex', turn_id: 't1', prompt: 'Tidy the essays section' }),
  stop: (session, active = false) => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'Stop', model: 'gpt-5-codex', turn_id: 't1', stop_hook_active: active, last_assistant_message: 'Done.' }),
  'session-end': session => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'SessionEnd', model: 'gpt-5-codex', reason: 'other' }),
};

// Runs `cortex hook` as a client does: the input on standard input, the answer on standard output.
const run = (moment, dir, agent, input) => {
  const started = performance.now();
  const done = spawnSync('node', [cli, 'hook', moment, dir, '--agent', agent], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  return { status: done.status, out: done.stdout, err: done.stderr, ms: performance.now() - started };
};
// Memory names are lowercase words, so a number is spelled in letters: 0 is a, 27 is bb.
const word = n => n.toString(26).split('').map(digit => String.fromCharCode(97 + parseInt(digit, 26))).join('');
const lines = async dir => (await readFile(join(dir, '.cortex', 'sessions.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('session-start gives the playbook and working memory, within the limit, and never the birthdate', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  await person.proposeIdentity({ field: 'birthdate', value: '1988-03-09', source: { kind: 'person', quote: 'I was born on 9 March 1988' } });
  await person.confirmIdentity('birthdate');
  await person.proposeIdentity({ field: 'preferredName', value: 'Sam', source: { kind: 'person', quote: 'Call me Sam' } });
  await person.confirmIdentity('preferredName');
  await openCortex(dir, { actor: 'claude-code' }).writeWorking('Answering in Dutch today. The atlas essay is half filed.');
  await openCortex(dir, { actor: 'codex' }).writeWorking('Refactoring the map renderer.');

  for (const [agent, shape] of [['claude-code', claude], ['codex', codex]]) {
    const { status, out } = run('session-start', dir, agent, shape['session-start'](`${agent}-s1`));
    assert.equal(status, 0);
    const answer = JSON.parse(out);
    assert.equal(answer.hookSpecificOutput.hookEventName, 'SessionStart');
    const context = answer.hookSpecificOutput.additionalContext;
    assert.ok(context.length <= LIMIT, `${context.length} characters`);
    assert.match(context, /Call cortex_start before anything else/);
    assert.ok(context.includes((await openCortex(dir).rules()).trim()), 'the playbook in full');
    assert.match(context, /"preferredName": "Sam"/);
    assert.match(context, /"hidden": \[\s*"birthdate"\s*\]/);
    assert.doesNotMatch(context, /1988|03-09/, 'the birthdate is never shown');
    assert.match(context, /### working-style/, 'memories marked always, in full');
    assert.match(context, /## Memory index/);
    const [mine, other] = agent === 'claude-code' ? ['Answering in Dutch today', 'Refactoring the map renderer'] : ['Refactoring the map renderer', 'Answering in Dutch today'];
    assert.match(context, new RegExp(`working memory from last time \\(${agent}\\)\\n\\n${mine}`));
    assert.match(context, new RegExp(`### [a-z-]+, updated \\d{4}-\\d\\d-\\d\\dT[^\\n]+\\n${other}`));
  }
  assert.deepEqual((await lines(dir)).map(entry => [entry.agent, entry.session, typeof entry.started]), [['claude-code', 'claude-code-s1', 'string'], ['codex', 'codex-s1', 'string']]);
});

test('session-start cuts the memory index first, then other agents\' working memory', async () => {
  const dir = await fresh();
  const cortex = openCortex(dir, { actor: 'claude-code' });
  for (let n = 0; n < 40; n++) await cortex.write({ name: `filing-habit-${word(n)}`, description: `How Sam files a kind of source, number ${n}, written long enough to fill the index`, kind: 'preference', body: 'x', stated: false });
  await cortex.reindex();
  let context = JSON.parse(run('session-start', dir, 'claude-code', claude['session-start']('s1')).out).hookSpecificOutput.additionalContext;
  assert.ok(context.length <= LIMIT);
  assert.doesNotMatch(context, /## Memory index/);
  await openCortex(dir, { actor: 'codex' }).writeWorking('Long thread. '.repeat(600));
  context = JSON.parse(run('session-start', dir, 'claude-code', claude['session-start']('s2')).out).hookSpecificOutput.additionalContext;
  assert.ok(context.length <= LIMIT);
  assert.doesNotMatch(context, /Other agents' working memory/);
  assert.match(context, /working memory from last time \(claude-code\)/);
});

test('stop blocks once when not distilled, and lets the session end when asked already or after a distill', async () => {
  for (const [agent, shape] of [['claude-code', claude], ['codex', codex]]) {
    const dir = await fresh();
    run('session-start', dir, agent, shape['session-start']('s1'));
    const first = run('stop', dir, agent, shape.stop('s1'));
    assert.equal(first.status, 0);
    assert.deepEqual(JSON.parse(first.out), { decision: 'block', reason: ASK });
    assert.equal(run('stop', dir, agent, shape.stop('s1', true)).out, '', 'stop_hook_active lets it end');
    assert.equal(run('stop', dir, agent, shape.stop('s1')).out, '', 'never blocks twice in a session');

    // A new session, distilled through the MCP tool, ends without being asked.
    run('session-start', dir, agent, shape['session-start']('s2'));
    await createTools(openCortex(dir, { actor: agent })).call('cortex_distill', { session: 'whatever-the-model-calls-it', working: 'Open: the atlas essay.' });
    assert.equal(run('stop', dir, agent, shape.stop('s2')).out, '');
    assert.equal(run('session-end', dir, agent, shape['session-end']('s2')).out, '');
    const ended = (await lines(dir)).filter(entry => entry.ended);
    assert.deepEqual(ended.map(({ agent: who, session, distilled }) => ({ who, session, distilled })), [{ who: agent, session: 's2', distilled: true }]);
  }
});

test('a distill by another agent, or before this session started, does not count', async () => {
  const dir = await fresh();
  await createTools(openCortex(dir, { actor: 'claude-code' })).call('cortex_distill', { session: 'old', working: 'x' });
  run('session-start', dir, 'claude-code', claude['session-start']('s1'));
  await createTools(openCortex(dir, { actor: 'codex' })).call('cortex_distill', { session: 'other', working: 'y' });
  assert.equal(JSON.parse(run('stop', dir, 'claude-code', claude.stop('s1')).out).decision, 'block');
  run('session-end', dir, 'claude-code', claude['session-end']('s1'));
  assert.equal((await lines(dir)).find(entry => entry.ended).distilled, false);
});

test('prompt answers with nothing', async () => {
  const dir = await fresh();
  for (const [agent, shape] of [['claude-code', claude], ['codex', codex]]) {
    const { status, out } = run('prompt', dir, agent, shape.prompt('s1'));
    assert.equal(status, 0);
    assert.equal(out, '');
  }
});

test('a broken cortex folder makes every moment exit 0 with no output', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-'));
  const notCortex = join(base, 'plain');
  await initCortex(notCortex, template);
  await rm(join(notCortex, 'agents'), { recursive: true });
  const aFile = join(base, 'file');
  await writeFile(aFile, 'not a folder');
  const good = await fresh();
  const cases = [[join(base, 'missing'), null], [aFile, null], [notCortex, null], [good, 'not json'], [good, '[1, 2]']];
  for (const [dir, raw] of cases) {
    for (const [agent, shape] of [['claude-code', claude], ['codex', codex]]) {
      for (const moment of ['session-start', 'prompt', 'stop', 'session-end']) {
        const { status, out, err } = run(moment, dir, agent, raw ?? shape[moment]('s1'));
        assert.equal(status, 0, `${moment} on ${dir}: ${err}`);
        assert.equal(out, '', `${moment} on ${dir}`);
      }
    }
  }
  assert.equal(run('nonsense', good, 'codex', '{}').out, '');
});

test('no moment takes longer than 200 ms on a cortex with 100 memories', async () => {
  const dir = await fresh();
  const cortex = openCortex(dir, { actor: 'claude-code' });
  for (let n = 0; n < 100; n++) await cortex.write({ name: `memory-${word(n)}`, description: `Something learned about how Sam works, ${n}`, kind: 'preference', body: `Detail ${n}.`, stated: false, always: n < 3 });
  await cortex.reindex();
  for (const moment of ['session-start', 'prompt', 'stop', 'session-end']) {
    const { status, ms } = run(moment, dir, 'claude-code', claude[moment]('s1'));
    assert.equal(status, 0);
    assert.ok(ms < 200, `${moment} took ${Math.round(ms)} ms`);
  }
});

test('install-hooks prints the snippet for each client and writes nothing', async () => {
  const claudeSnippet = spawnSync('node', [cli, 'install-hooks', 'claude-code'], { encoding: 'utf8' });
  assert.equal(claudeSnippet.status, 0);
  const { hooks } = JSON.parse(claudeSnippet.stdout);
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);
  assert.equal(hooks.Stop[0].hooks[0].command, 'cortex hook stop --agent claude-code');
  const codexSnippet = spawnSync('node', [cli, 'install-hooks', 'codex'], { encoding: 'utf8' });
  assert.equal(codexSnippet.status, 0);
  for (const [event, moment] of [['SessionStart', 'session-start'], ['UserPromptSubmit', 'prompt'], ['Stop', 'stop'], ['SessionEnd', 'session-end']]) {
    assert.ok(codexSnippet.stdout.includes(`[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "cortex hook ${moment} --agent codex"`), event);
  }
  assert.equal(spawnSync('node', [cli, 'install-hooks', 'emacs'], { encoding: 'utf8' }).status, 1);
});

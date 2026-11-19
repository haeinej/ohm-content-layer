import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ASK, BUDGETS, chars, squeeze } from '../src/adapter.mjs';
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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

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
const shapes = [['claude-code', claude], ['codex', codex]];

// Runs `cortex hook` as a client does: the input on standard input, the answer on standard output.
const run = (moment, dir, agent, input) => {
  const started = performance.now();
  const done = spawnSync('node', [cli, 'hook', moment, dir, '--agent', agent], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  return { status: done.status, out: done.stdout, err: done.stderr, ms: performance.now() - started };
};
const contextOf = out => JSON.parse(out).hookSpecificOutput.additionalContext;
const asked = out => out !== '' && JSON.parse(out).decision === 'block';
// Memory names are lowercase words, so a number is spelled in letters: 0 is a, 27 is bb.
const word = n => n.toString(26).split('').map(digit => String.fromCharCode(97 + parseInt(digit, 26))).join('');
// The session lines the hooks wrote to the journal.
const lines = async dir => (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'session');
// Rewrites an agent's own working memory, as cortex_working does.
const work = async (dir, agent, text) => {
  const cortex = openCortex(dir, { actor: agent });
  return cortex.writeWorking(text, { replaces: (await cortex.working()).mine.version });
};
const distill = async (dir, agent, working) => {
  const cortex = openCortex(dir, { actor: agent });
  return createTools(cortex).call('cortex_distill', { session: 'whatever-the-model-calls-it', working, version: (await cortex.working()).mine.version ?? undefined });
};
const loneHalf = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('session-start gives the playbook and working memory within each client\'s budget, and never a birthdate or a proposal', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  await person.proposeIdentity({ field: 'birthdate', value: '1988-03-09', source: { kind: 'person', quote: 'I was born on 9 March 1988' } });
  await person.confirmIdentity('birthdate');
  await person.proposeIdentity({ field: 'preferredName', value: 'Sam', source: { kind: 'person', quote: 'Call me Sam' } });
  await person.confirmIdentity('preferredName');
  // Waiting proposals, and their evidence, are never part of session start.
  await openCortex(dir, { actor: 'codex' }).proposeIdentity({ field: 'city', value: 'Utrecht', source: { kind: 'person', quote: 'I moved to Utrecht last spring' } });
  await work(dir, 'claude-code', 'Answering in Dutch today. The atlas essay is half filed.');
  await work(dir, 'codex', 'Refactoring the map renderer.');
  const playbook = (await openCortex(dir).rules()).trim();

  for (const [agent, shape] of shapes) {
    const { status, out } = run('session-start', dir, agent, shape['session-start'](`${agent}-s1`));
    assert.equal(status, 0);
    assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'SessionStart');
    const context = contextOf(out);
    assert.ok(chars(context) <= BUDGETS[agent], `${agent}: ${chars(context)} characters`);
    assert.match(context, /Call cortex_start before anything else/);
    // Claude Code has room for the playbook in full; Codex's budget gets a pointer to cortex_start.
    if (agent === 'claude-code') assert.ok(context.includes(playbook), 'the playbook in full');
    else assert.match(context, /Call cortex_start now: it returns the playbook in full/);
    assert.match(context, /"preferredName": "Sam"/);
    assert.match(context, /"hidden": \[\s*"birthdate"\s*\]/);
    assert.doesNotMatch(context, /1988|03-09|9 March/, 'the birthdate is never shown');
    assert.doesNotMatch(context, /Utrecht|moved to/, 'no proposal and no evidence');
    assert.match(context, /### working-style/, 'memories marked always, in full');
    // With the playbook in full, Claude Code's budget has no room left for the index or other agents'
    // working memory; Codex's pointer leaves room for both.
    if (agent === 'codex') assert.match(context, /## Memory index/);
    const [mine, other] = agent === 'claude-code' ? ['Answering in Dutch today', 'Refactoring the map renderer'] : ['Refactoring the map renderer', 'Answering in Dutch today'];
    assert.match(context, new RegExp(`working memory from last time \\(${agent}\\)\\n\\n${mine}`));
    if (agent === 'codex') assert.match(context, new RegExp(`### [a-z-]+, updated \\d{4}-\\d\\d-\\d\\dT[^\\n]+\\n${other}`));
    else assert.doesNotMatch(context, new RegExp(other), 'cut before the playbook');
  }
  assert.deepEqual((await lines(dir)).map(entry => [entry.actor, entry.session, entry.event, entry.version.startsWith('c')]), [[{ kind: 'agent', name: 'claude-code' }, 'claude-code-s1', 'start', true], [{ kind: 'agent', name: 'codex' }, 'codex-s1', 'start', true]]);
});

test('session-start cuts the index first, then other agents\' working memory, then points to the playbook and brings the index back', async () => {
  const dir = await fresh();
  const cortex = openCortex(dir, { actor: 'claude-code' });
  for (let n = 0; n < 12; n++) await cortex.write({ name: `filing-habit-${word(n)}`, description: `How Sam files a kind of source, number ${n}, long enough to fill the index`, kind: 'preference', body: 'x', stated: false });
  await cortex.reindex();
  let context = contextOf(run('session-start', dir, 'claude-code', claude['session-start']('s1')).out);
  assert.ok(chars(context) <= BUDGETS['claude-code']);
  assert.doesNotMatch(context, /## Memory index/, 'the index goes first');
  assert.ok(context.includes('## The playbook (agents/AGENTS.md)\n\n# '), 'the playbook is still in full');

  await openCortex(dir, { actor: 'codex' }).writeWorking('Long thread. '.repeat(150));
  context = contextOf(run('session-start', dir, 'claude-code', claude['session-start']('s2')).out);
  assert.ok(chars(context) <= BUDGETS['claude-code']);
  assert.doesNotMatch(context, /Other agents' working memory/, 'then other agents\' working memory');

  // Once the playbook is a pointer, what was cut comes back if it fits.
  await work(dir, 'claude-code', 'Today: answering briefly.\n'.repeat(60));
  context = contextOf(run('session-start', dir, 'claude-code', claude['session-start']('s3')).out);
  assert.ok(chars(context) <= BUDGETS['claude-code']);
  assert.match(context, /Call cortex_start now: it returns the playbook in full/);
  assert.match(context, /## Memory index\n\n- \[filing-habit-a\]/);
  assert.match(context, /Other agents' working memory/);
});

test('the hard cut keeps the end of this agent\'s working memory, on whole lines and whole characters', async () => {
  const dir = await fresh();
  const older = Array.from({ length: 150 }, (_, n) => `Earlier ${n}: filed a note 🌷 under essays.`).join('\n');
  await work(dir, 'codex', `Oldest thread: the atlas essay.\n${older}\nNewest: Sam wants one-line replies today 🎉`);
  const context = contextOf(run('session-start', dir, 'codex', codex['session-start']('s1')).out);
  assert.ok(chars(context) <= BUDGETS.codex, `${chars(context)} characters`);
  assert.match(context, /Newest: Sam wants one-line replies today 🎉\s*$/, 'the end is kept');
  assert.match(context, /Oldest thread: the atlas essay\./, 'and the start, as far as it fits');
  assert.match(context, /cut to fit; cortex_start has it in full/);
  assert.doesNotMatch(context, /Earlier 40:/, 'the middle of the older part goes');
  assert.doesNotMatch(context, loneHalf, 'no emoji is split');
  for (const line of context.split('\n').filter(line => line.startsWith('Earlier'))) assert.match(line, /^Earlier \d+: filed a note 🌷 under essays\.$/, 'only whole lines');

  const cut = squeeze(`${'🎉'.repeat(50)}\n${'🌷'.repeat(500)}`, 120);
  assert.ok(chars(cut) <= 120);
  assert.doesNotMatch(cut, loneHalf);
});

test('stop asks only when working memory changed and was not distilled, and once for each change', async () => {
  for (const [agent, shape] of shapes) {
    const dir = await fresh();
    run('session-start', dir, agent, shape['session-start']('s1'));
    // A session that never touches working memory is never asked.
    for (let turn = 0; turn < 3; turn++) assert.equal(run('stop', dir, agent, shape.stop('s1')).out, '', `${agent}: nothing to save`);

    await work(dir, agent, 'Filing three notes, one done.');
    const first = run('stop', dir, agent, shape.stop('s1'));
    assert.equal(first.status, 0);
    assert.deepEqual(JSON.parse(first.out), { decision: 'block', reason: ASK });
    assert.equal(run('stop', dir, agent, shape.stop('s1', true)).out, '', 'stop_hook_active lets it end');
    assert.equal(run('stop', dir, agent, shape.stop('s1')).out, '', 'the same state is never asked about twice');

    await work(dir, agent, 'Filing three notes, two done.');
    assert.ok(asked(run('stop', dir, agent, shape.stop('s1')).out), 'a new change is asked about');
    assert.equal(run('stop', dir, agent, shape.stop('s1')).out, '');

    await pause(5);
    await work(dir, agent, 'Filing three notes, all done.');
    await distill(dir, agent, 'Open: nothing.');
    assert.equal(run('stop', dir, agent, shape.stop('s1')).out, '', 'distilled after the change');
    await pause(5);
    await work(dir, agent, 'One more thing came up.');
    assert.ok(asked(run('stop', dir, agent, shape.stop('s1')).out), 'a change after the distill is asked about');

    assert.equal(run('session-end', dir, agent, shape['session-end']('s1')).out, '');
    const [ended] = (await lines(dir)).filter(entry => entry.event === 'end');
    assert.deepEqual([ended.session, ended.distilled], ['s1', false]);
  }
});

test('tracking is per session: another session\'s start, ask or distill never counts', async () => {
  const dir = await fresh();
  run('session-start', dir, 'claude-code', claude['session-start']('a'));
  run('session-start', dir, 'claude-code', claude['session-start']('b'));
  await work(dir, 'claude-code', 'Session a was here.');
  assert.ok(asked(run('stop', dir, 'claude-code', claude.stop('a')).out));
  assert.ok(asked(run('stop', dir, 'claude-code', claude.stop('b')).out), 'a\'s ask is not b\'s');

  // a distills; b then changes working memory, and is asked, since a's distill came before it.
  await distill(dir, 'claude-code', 'Left by a.');
  assert.equal(run('stop', dir, 'claude-code', claude.stop('a')).out, '');
  await pause(5);
  await work(dir, 'claude-code', 'Session b changed this after a distilled.');
  assert.ok(asked(run('stop', dir, 'claude-code', claude.stop('b')).out));

  // Another agent's distill never counts.
  await distill(dir, 'codex', 'Codex left this.');
  await pause(5);
  await work(dir, 'claude-code', 'And again.');
  assert.ok(asked(run('stop', dir, 'claude-code', claude.stop('b')).out));

  // A Stop for a session with no start line starts it now, with the state as it is.
  assert.equal(run('stop', dir, 'claude-code', claude.stop('c')).out, '');
  assert.ok((await lines(dir)).some(entry => entry.session === 'c' && entry.event === 'start'));
  assert.equal(run('stop', dir, 'claude-code', claude.stop('c')).out, '');
  await work(dir, 'claude-code', 'Session c changed it.');
  assert.ok(asked(run('stop', dir, 'claude-code', claude.stop('c')).out));
});

test('session-start answers in full without .cortex/, and when the session log cannot be written', async () => {
  const dir = await fresh();
  await rm(join(dir, '.cortex'), { recursive: true, force: true });
  const { status, out } = run('session-start', dir, 'claude-code', claude['session-start']('s1'));
  assert.equal(status, 0);
  assert.match(contextOf(out), /## The playbook/);
  assert.equal((await lines(dir))[0].session, 's1', 'the folder is made');

  // The journal can be read and not written.
  await chmod(join(dir, '.cortex', 'journal.jsonl'), 0o444);
  const broken = run('session-start', dir, 'codex', codex['session-start']('s2'));
  assert.equal(broken.status, 0);
  assert.match(contextOf(broken.out), /## Identity/);
  // A distill whose record cannot be written still saves, and does not throw.
  const done = await distill(dir, 'codex', 'Left for next time.');
  assert.equal(done.working.agent, 'codex');
  assert.equal((await openCortex(dir, { actor: 'codex' }).working()).mine.text, 'Left for next time.');
});

test('prompt answers with nothing, without waiting for standard input', async () => {
  const dir = await fresh();
  for (const [agent, shape] of shapes) {
    const { status, out } = run('prompt', dir, agent, shape.prompt('s1'));
    assert.equal(status, 0);
    assert.equal(out, '');
  }
  // stdin left open: prompt still exits at once.
  const started = performance.now();
  const child = spawn('node', [cli, 'hook', 'prompt', dir, '--agent', 'codex'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const status = await new Promise(resolve => child.on('exit', resolve));
  child.stdin.destroy();
  assert.equal(status, 0);
  assert.ok(performance.now() - started < 800, 'did not wait for stdin to close');
});

test('a client that closes the pipe early sees no error', async () => {
  const dir = await fresh();
  const child = spawn('node', [cli, 'hook', 'session-start', dir, '--agent', 'claude-code'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let err = '';
  child.stderr.on('data', chunk => { err += chunk; });
  child.stdin.end(JSON.stringify(claude['session-start']('s1')));
  const status = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(status, 0);
  assert.equal(err, '');
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
    for (const [agent, shape] of shapes) {
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
  await work(dir, 'claude-code', 'Working on the index.');
  for (const moment of ['session-start', 'prompt', 'stop', 'session-end']) {
    const { status, ms } = run(moment, dir, 'claude-code', claude[moment]('s1'));
    assert.equal(status, 0);
    assert.ok(ms < 200, `${moment} took ${Math.round(ms)} ms`);
  }
});

test('install-hooks prints the snippet for each client and writes nothing, and the session log merges cleanly', async () => {
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
  assert.match(await readFile(join(await fresh(), '.gitattributes'), 'utf8'), /^\.cortex\/sessions\.jsonl merge=union$/m);
});

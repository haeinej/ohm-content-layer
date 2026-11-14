import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex } from '../src/folder.mjs';
import { cortexSessions, httpTransport, listen, makeToken } from '../src/http.mjs';

// Every person and agent here is invented. Servers bind only to 127.0.0.1, on a free port.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};

// A cortex served over real HTTP for the length of one test, and a client that speaks to it.
const served = async (t, { token, ...options } = {}) => {
  const dir = await fresh();
  const secret = token === false ? undefined : await makeToken(dir);
  const server = await listen(httpTransport({ open: cortexSessions(dir), token: secret, ...options }), { port: 0, host: '127.0.0.1' });
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let next = 1;
  const post = async (message, { session, auth = secret, headers = {} } = {}) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-06-18' } : {}),
        ...headers,
      },
      body: typeof message === 'string' ? message : JSON.stringify(message),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined, text };
  };
  const request = (method, params, options) => post({ jsonrpc: '2.0', id: next++, method, params }, options);
  const initialize = async (client = 'claude-code') => {
    const answer = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0.0' } });
    const session = answer.headers.get('mcp-session-id');
    if (session) await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { session });
    return { ...answer, session };
  };
  const call = async (session, name, args = {}) => {
    const answer = await request('tools/call', { name, arguments: args }, { session });
    return { ...answer, result: answer.body.result, value: answer.body.result && !answer.body.result.isError ? JSON.parse(answer.body.result.content[0].text) : undefined };
  };
  return { dir, url, secret, post, request, initialize, call };
};

test('over HTTP, initialize returns the short instructions and a session ID, as JSON', async t => {
  const { initialize } = await served(t);
  const answer = await initialize();
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type'), /^application\/json/);
  assert.match(answer.session, /^[\x21-\x7e]{16,}$/);
  const { instructions, protocolVersion, capabilities } = answer.body.result;
  assert.equal(protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(capabilities).sort(), ['prompts', 'resources', 'tools']);
  assert.ok(instructions.length <= 512, `${instructions.length} characters`);
  assert.match(instructions, /Call cortex_start before anything else/);
});

test('over HTTP, cortex_start returns the playbook', async t => {
  const { initialize, call, request } = await served(t);
  const { session } = await initialize();
  const start = await call(session, 'cortex_start');
  assert.equal(start.status, 200);
  assert.match(start.value.rules, /# How to keep this cortex/);
  const listed = await request('tools/list', {}, { session });
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'cortex_start'));
});

test('a request without the token gets 401, and nothing about the cortex', async t => {
  const { post, request, url, secret } = await served(t);
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } };
  for (const answer of [
    await post(initialize, { auth: null }),
    await post(initialize, { auth: `${secret}x` }),
    await post(initialize, { auth: null, headers: { Authorization: secret } }),
    await request('tools/list', {}, { auth: 'not-the-token', session: 'made-up' }),
  ]) {
    assert.equal(answer.status, 401);
    assert.equal(answer.headers.get('www-authenticate'), 'Bearer');
    assert.equal(answer.text, '');
  }
  // Not even which paths exist.
  const elsewhere = await fetch(url.replace('/mcp', '/anything'));
  assert.equal(elsewhere.status, 401);
  assert.equal(await elsewhere.text(), '');
});

test('a request with an unknown session ID is refused, and one with none is asked to initialize', async t => {
  const { initialize, request, call, post, url, secret } = await served(t);
  const unknown = await request('tools/list', {}, { session: 'no-such-session' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.result, undefined);
  assert.match(unknown.body.error.message, /initialize again/);
  const none = await request('tools/list', {});
  assert.equal(none.status, 400);
  assert.match(none.body.error.message, /Send initialize first/);

  // A session that was ended is unknown too.
  const { session } = await initialize();
  assert.equal((await call(session, 'cortex_start')).status, 200);
  const ended = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${secret}`, 'Mcp-Session-Id': session } });
  assert.equal(ended.status, 204);
  assert.equal((await call(session, 'cortex_start')).status, 404);
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { session })).status, 404);
});

test('two sessions keep separate agent names', async t => {
  const { initialize, call } = await served(t);
  const first = await initialize('ada-desk');
  const second = await initialize('ben-laptop');
  assert.notEqual(first.session, second.session);
  const wrote = await call(first.session, 'cortex_working', { text: 'Drafting the essay on tides.' });
  assert.equal(wrote.value.agent, 'ada-desk');
  const other = await call(second.session, 'cortex_working', { text: 'Sorting the reading list.' });
  assert.equal(other.value.agent, 'ben-laptop');
  const seen = (await call(second.session, 'cortex_start')).value.working;
  assert.match(seen.mine.text, /reading list/);
  assert.deepEqual(seen.others.map(item => item.agent), ['ada-desk']);
  // A client cannot take the person's name.
  const posing = await initialize('member');
  assert.equal((await call(posing.session, 'cortex_working', { text: 'x' })).value.agent, 'agent-member');
});

test('a cortex_forget confirmation stays in the session it was issued in', async t => {
  const { initialize, call } = await served(t);
  const one = await initialize('ada-desk');
  const two = await initialize('ada-desk');
  await call(one.session, 'cortex_remember', { memory: { name: 'likes-tea', description: 'Drinks green tea', kind: 'preference', body: 'Green tea, no sugar.', stated: true } });
  const asked = await call(one.session, 'cortex_forget', { name: 'likes-tea' });
  assert.ok(asked.value.confirm);
  const elsewhere = await call(two.session, 'cortex_forget', { name: 'likes-tea', confirm: asked.value.confirm });
  assert.equal(elsewhere.result.isError, true);
  const here = await call(one.session, 'cortex_forget', { name: 'likes-tea', confirm: asked.value.confirm });
  assert.equal(here.result.isError, undefined);
});

test('notifications are accepted with 202, GET offers no stream, and bad messages are refused', async t => {
  const { initialize, post, request, url, secret } = await served(t);
  const { session } = await initialize();
  const accepted = await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } }, { session });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.text, '');
  const auth = { Authorization: `Bearer ${secret}` };
  assert.equal((await fetch(url, { headers: { ...auth, Accept: 'text/event-stream', 'Mcp-Session-Id': session } })).status, 405);
  assert.equal((await post('{not json', { session })).body.error.code, -32700);
  assert.equal((await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }], { session })).status, 400);
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { session, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('ping', {}, { session, headers: { 'MCP-Protocol-Version': '1999-01-01' } })).status, 400);
  assert.equal((await request('nothing/here', {}, { session })).body.error.code, -32601);
});

test('a browser page from another origin is refused, and this machine is not', async t => {
  const { initialize, post } = await served(t);
  const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'web' } } };
  assert.equal((await post(message, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await post(message, { headers: { Origin: 'http://localhost:3000' } })).status, 200);
  assert.equal((await initialize()).status, 200);
});

test('with no token, a cortex served on this machine needs no sign-in', async t => {
  const { initialize, call } = await served(t, { token: false });
  const { session } = await initialize();
  assert.match((await call(session, 'cortex_start')).value.rules, /# How to keep this cortex/);
});

test('cortex token writes a secret token once and prints it, and serve refuses another host without one', async () => {
  const dir = await fresh();
  const refused = spawnSync('node', [cli, 'serve', dir, '--host', '0.0.0.0', '--port', '0'], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /There is no token, so cortex serves only 127\.0\.0\.1/);

  const made = spawnSync('node', [cli, 'token', dir], { encoding: 'utf8' });
  assert.equal(made.status, 0);
  const printed = made.stdout.trim();
  assert.match(printed, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await readFile(join(dir, 'agents', 'secrets', 'mcp-token'), 'utf8')).trim(), printed);
  assert.equal((await stat(join(dir, 'agents', 'secrets', 'mcp-token'))).mode & 0o077, 0);
  assert.doesNotMatch(made.stderr, new RegExp(printed));

  const again = spawnSync('node', [cli, 'token', dir], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.doesNotMatch(again.stdout + again.stderr, new RegExp(printed));
  const replaced = spawnSync('node', [cli, 'token', dir, '--replace'], { encoding: 'utf8' });
  assert.equal(replaced.status, 0);
  assert.notEqual(replaced.stdout.trim(), printed);
});

test('cortex serve answers over HTTP, never prints the token, and asks for it', async t => {
  const dir = await fresh();
  const token = await makeToken(dir);
  const child = spawn('node', [cli, 'serve', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '';
  const url = await new Promise((done, fail) => {
    child.stdout.on('data', chunk => {
      output += chunk;
      const found = output.match(/at (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
      if (found) done(found[1]);
    });
    child.once('exit', code => fail(new Error(`cortex serve exited with ${code}`)));
  });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex' } } });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401);
  const answer = await fetch(url, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body });
  assert.equal(answer.status, 200);
  assert.ok(answer.headers.get('mcp-session-id'));
  assert.doesNotMatch(output, new RegExp(token));
});

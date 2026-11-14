import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
// Speaks to `cortex mcp` the way a client does, one JSON message a line, and returns the answers by ID.
const session = (dir, requests, client = 'claude-code') => {
  const lines = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: client } } }, ...requests.map((request, index) => ({ jsonrpc: '2.0', id: index + 1, ...request }))];
  const output = execFileSync('node', [cli, 'mcp', dir], { input: `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, encoding: 'utf8' });
  return Object.fromEntries(output.trim().split('\n').map(line => JSON.parse(line)).map(message => [message.id, message]));
};
const withBirthdate = async dir => {
  const person = openCortex(dir, { actor: 'member' });
  await person.proposeIdentity({ field: 'birthdate', value: '1991-07-14', source: { kind: 'person', quote: 'I was born on 14 July 1991' } });
  await person.confirmIdentity('birthdate');
  await person.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'person', quote: 'Lisbon' } });
  await person.confirmIdentity('city');
};

test('a client is told to start with cortex_start, in under 512 characters, and gets the playbook from it', async () => {
  const dir = await fresh();
  await appendFile(join(dir, 'agents', 'AGENTS.md'), '\n- Always answer me in Portuguese.\n');
  const answers = session(dir, [{ method: 'tools/call', params: { name: 'cortex_start', arguments: {} } }]);
  const { instructions, capabilities } = answers[0].result;
  assert.deepEqual(Object.keys(capabilities).sort(), ['prompts', 'resources', 'tools']);
  assert.ok(instructions.length <= 512, `${instructions.length} characters`);
  assert.match(instructions, /Call cortex_start before anything else/);
  assert.match(instructions, /Before you finish, call cortex_distill/);
  const rules = JSON.parse(answers[1].result.content[0].text).rules;
  assert.match(rules, /# How to keep this cortex/);
  assert.match(rules, /Always answer me in Portuguese/);
});

test('the person can pick a prompt to start with their cortex', async () => {
  const dir = await fresh();
  const answers = session(dir, [
    { method: 'prompts/list' },
    { method: 'prompts/get', params: { name: 'start' } },
    { method: 'prompts/get', params: { name: 'nothing' } },
  ]);
  assert.deepEqual(answers[1].result.prompts.map(prompt => prompt.name), ['start']);
  const [message] = answers[2].result.messages;
  assert.equal(message.role, 'user');
  assert.match(message.content.text, /Call cortex_start now/);
  assert.equal(answers[3].error.code, -32602);
});

test('a client can read the cortex as resources, and never a secret', async () => {
  const dir = await fresh();
  await writeFile(join(dir, 'agents', 'secrets', 'calendar.key'), 'not-a-real-key');
  await writeFile(join(dir, 'vault.md'), '# Sections\n\n- essays: finished writing\n');
  await openCortex(dir).write({ name: 'prefers-short-titles', description: 'Titles are four words or fewer', kind: 'preference', stated: true, body: 'Keep titles short.' });
  const answers = session(dir, [
    { method: 'resources/list' },
    { method: 'resources/read', params: { uri: 'cortex://agents/AGENTS.md' } },
    { method: 'resources/read', params: { uri: 'cortex://vault.md' } },
    { method: 'resources/read', params: { uri: 'cortex://memory/prefers-short-titles' } },
    { method: 'resources/read', params: { uri: 'cortex://agents/secrets/calendar.key' } },
    { method: 'resources/read', params: { uri: 'cortex://memory/../agents/secrets/calendar.key' } },
  ]);
  const uris = answers[1].result.resources.map(resource => resource.uri);
  assert.deepEqual(uris.slice(0, 5), ['cortex://agents/AGENTS.md', 'cortex://identity', 'cortex://vault.md', 'cortex://memory/MEMORY.md', 'cortex://tools']);
  assert.ok(uris.includes('cortex://memory/prefers-short-titles'));
  assert.equal(uris.some(uri => /secret/.test(uri)), false);
  assert.match(answers[2].result.contents[0].text, /# How to keep this cortex/);
  assert.match(answers[3].result.contents[0].text, /essays: finished writing/);
  assert.match(answers[4].result.contents[0].text, /Keep titles short/);
  assert.equal(answers[5].error.code, -32002);
  assert.equal(answers[6].error.code, -32002);
  assert.doesNotMatch(JSON.stringify(answers), /not-a-real-key/);
});

test('birthdate is hidden from agents: they are told one is on file, and nothing returns it', async () => {
  const dir = await fresh();
  await withBirthdate(dir);
  const agent = openCortex(dir, { actor: 'claude-code' });
  const start = await agent.start();
  assert.equal(start.identity.city, 'Lisbon');
  assert.equal(start.identity.birthdate, undefined);
  assert.deepEqual(start.identity.hidden, ['birthdate']);

  const later = await agent.proposeIdentity({ field: 'birthdate', value: '1991-07-15', source: { kind: 'person', quote: 'I was born on 15 July 1991, not the 14th' } });
  assert.equal(later.current, '(hidden)');
  const waiting = (await agent.start()).waiting.identity[0];
  assert.deepEqual(waiting.source, { kind: 'person', hidden: true }, 'the quote states the date, so it is hidden too');
  assert.equal(waiting.value, '(hidden)');
  assert.doesNotMatch(JSON.stringify(await agent.start()), /15 July 1991|1991-07-15/);

  const answers = session(dir, [
    { method: 'tools/call', params: { name: 'cortex_start', arguments: {} } },
    { method: 'resources/read', params: { uri: 'cortex://identity' } },
  ]);
  assert.doesNotMatch(JSON.stringify(answers), /1991-07-1[45]/);
  assert.deepEqual(JSON.parse(answers[2].result.contents[0].text).hidden, ['birthdate']);
});

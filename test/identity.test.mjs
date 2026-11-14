import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { readIdentity } from '../src/identity.mjs';
import { createServer } from '../src/protocol.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async (options = {}) => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template, options);
  return { dir, agent: openCortex(dir, { actor: 'test-agent' }), person: openCortex(dir, { actor: 'member' }) };
};
const refused = code => problem => problem.code === code;
const said = quote => ({ kind: 'person', quote });
const post = (id, passage) => ({ kind: 'vault', post: id, passage });
const file = dir => readFile(join(dir, 'identity.md'), 'utf8');

test('a proposal without evidence is refused', async () => {
  const { agent } = await fresh();
  await assert.rejects(agent.proposeIdentity({ field: 'city', value: 'Lisbon' }), refused('NoEvidence'));
  await assert.rejects(agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'guess' } }), refused('NoEvidence'));
  await assert.rejects(agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: { kind: 'vault', post: 'p1' } }), refused('NoEvidence'));
  await assert.rejects(agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: said('') }), refused('NoEvidence'));
  await assert.rejects(agent.proposeIdentity({ field: 'favouriteColour', value: 'green', source: said('green') }), refused('InvalidIdentity'));
  await assert.rejects(agent.proposeIdentity({ field: 'account', value: 'did:plc:abc', source: said('my DID is did:plc:abc') }), refused('InvalidIdentity'));
});

test('pronouns come only from the person, never from the vault', async () => {
  const { agent } = await fresh();
  await assert.rejects(agent.proposeIdentity({ field: 'pronouns', value: 'she/her', source: post('p1', 'Sam Rivera wrote this') }), refused('NoEvidence'));
  assert.equal((await agent.proposeIdentity({ field: 'pronouns', value: 'they/them', source: said('I use they/them') })).waiting, true);
});

test('a value that is not of its type is refused', async () => {
  const { agent } = await fresh();
  const source = said('as I said');
  for (const [field, value] of [
    ['emails', [{ label: 'work', address: 'not-an-address' }]],
    ['emails', 'sam@example'],
    ['timezone', 'Mars/Olympus'],
    ['birthdate', '1990-02-30'],
    ['birthdate', '2990-01-01'],
    ['kind', 'company'],
    ['languages', ['not a language tag!']],
    ['websites', ['ftp://example.com']],
    ['name', 'Two\nlines'],
  ]) await assert.rejects(agent.proposeIdentity({ field, value, source }), refused('InvalidIdentity'), `${field}: ${JSON.stringify(value)}`);
  for (const [field, value] of [['timezone', 'Europe/Lisbon'], ['birthdate', '--04-12'], ['birthdate', '1990-02-28'], ['languages', ['pt-PT', 'en']], ['emails', [{ label: 'work', address: 'Sam@Example.com' }]]]) {
    assert.equal((await agent.proposeIdentity({ field, value, source })).waiting, true, field);
  }
  assert.deepEqual((await agent.identityProposals()).find(item => item.field === 'emails').value, [{ label: 'work', address: 'sam@example.com' }]);
});

test('a proposal leaves identity.md unchanged, and confirming writes it and keeps the earlier file', async () => {
  const { dir, agent, person } = await fresh();
  const before = await file(dir);
  const { id } = await agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: post('p7', 'I moved to Lisbon last spring.') });
  assert.equal(await file(dir), before);
  assert.deepEqual((await agent.start()).waiting.identity.map(item => [item.id, item.field, item.value]), [[id, 'city', 'Lisbon']]);

  const done = await person.confirmIdentity('city');
  assert.deepEqual([done.field, done.value], ['city', 'Lisbon']);
  assert.equal((await readIdentity(await file(dir))).fields.city, 'Lisbon');
  assert.match(await file(dir), /Write a few lines about yourself/, 'the body is kept');
  assert.equal((await readdir(join(dir, '.cortex', 'history', 'identity', 'identity'))).length, 1);
  assert.deepEqual((await agent.start()).waiting.identity, []);
  const log = await agent.identityLog();
  assert.deepEqual(log.map(entry => [entry.type, entry.by]), [['proposed', 'test-agent'], ['confirmed', 'member']]);
});

test('a confirmed field is not overwritten by a later proposal', async () => {
  const { dir, agent, person } = await fresh();
  await agent.proposeIdentity({ field: 'occupation', value: 'Illustrator', source: said('I am an illustrator') });
  await person.confirmIdentity('occupation');
  const later = await agent.proposeIdentity({ field: 'occupation', value: 'Art director', source: post('p9', 'Now art director at a small studio.') });
  assert.deepEqual([later.waiting, later.current], [true, 'Illustrator']);
  assert.equal((await readIdentity(await file(dir))).fields.occupation, 'Illustrator');
  assert.equal((await agent.proposeIdentity({ field: 'occupation', value: 'Illustrator', source: said('still an illustrator') })).confirmed, true);

  // With two waiting for one field, the person names which one.
  await agent.proposeIdentity({ field: 'occupation', value: 'Designer', source: said('I design') });
  await assert.rejects(person.confirmIdentity('occupation'), refused('Ambiguous'));
  await person.confirmIdentity(later.id);
  assert.equal((await readIdentity(await file(dir))).fields.occupation, 'Art director');
});

test('a rejected proposal is not made again from the same evidence', async () => {
  const { agent, person } = await fresh();
  const proposal = { field: 'city', value: 'Porto', source: post('p2', 'A weekend in Porto.') };
  await agent.proposeIdentity(proposal);
  assert.equal((await agent.proposeIdentity(proposal)).unchanged, true, 'sent twice, it is kept once');
  assert.equal((await agent.identityProposals()).length, 1);
  await person.rejectIdentity('city');
  await assert.rejects(agent.proposeIdentity(proposal), refused('AlreadyRejected'));
  assert.equal((await agent.proposeIdentity({ ...proposal, source: said('I live in Porto') })).waiting, true, 'new evidence may be proposed');
});

test('clearing removes a field and keeps the earlier file', async () => {
  const { dir, agent, person } = await fresh();
  await agent.proposeIdentity({ field: 'position', value: 'Founder', source: said('I founded it') });
  await person.confirmIdentity('position');
  await person.clearIdentity('position');
  assert.equal((await readIdentity(await file(dir))).fields.position, undefined);
  assert.equal((await readdir(join(dir, '.cortex', 'history', 'identity', 'identity'))).length, 2);
  // Cleared, the same fact can be proposed and confirmed again.
  await agent.proposeIdentity({ field: 'position', value: 'Founder', source: said('I founded it') });
  await person.confirmIdentity('position');
  assert.equal((await readIdentity(await file(dir))).fields.position, 'Founder');
});

test('the account is set from the signed-in account, without a proposal', async () => {
  const { dir, agent } = await fresh({ account: 'did:plc:example123' });
  assert.equal((await agent.start()).identity.account, 'did:plc:example123');
  assert.equal((await agent.identityLog())[0].source.kind, 'account');
  await assert.rejects(initCortex(join(dir, '..', 'other'), template, { account: 'not a did' }), refused('InvalidIdentity'));
});

test('a hand-edited identity with one bad field still loads, and says what is wrong', async () => {
  const { dir, agent, person } = await fresh();
  await writeFile(join(dir, 'identity.md'), '---\nkind: person\npreferredName: Sam\ntimezone: Nowhere/Here\nlanguages: [pt, en]\nfavouriteFood: soup\n---\nDraws maps.\n');
  const start = await agent.start();
  assert.deepEqual(start.identity, { kind: 'person', preferredName: 'Sam', languages: ['pt', 'en'], own: { favouriteFood: 'soup' }, about: 'Draws maps.' });
  assert.equal(start.problems.length, 1);
  assert.match(start.problems[0], /timezone/);
  // Confirming another field keeps what the person wrote, even the part that cannot be read.
  await agent.proposeIdentity({ field: 'city', value: 'Lisbon', source: said('Lisbon') });
  await person.confirmIdentity('city');
  const after = await readIdentity(await file(dir));
  assert.equal(after.properties.timezone, 'Nowhere/Here');
  assert.deepEqual(after.own, { favouriteFood: 'soup' });
  assert.equal(after.about, 'Draws maps.');
});

test('no tool an agent is given can confirm, reject or clear', async () => {
  const { agent } = await fresh();
  assert.equal(TOOLS.some(tool => /confirm|reject|clear/.test(tool.name) || tool.name === 'cortex_identity'), false);
  const handle = createServer({ tools: createTools(agent), list: TOOLS, instructions: INSTRUCTIONS });
  const call = async (name, args) => (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
  assert.equal((await call('cortex_identity', { text: 'x', version: 'y' })).isError, true);
  const proposed = await call('cortex_propose_identity', { field: 'name', value: 'Sam Rivera', source: { kind: 'person', quote: 'I am Sam Rivera' } });
  assert.equal(JSON.parse(proposed.content[0].text).waiting, true);
  const pronouns = await call('cortex_propose_identity', { field: 'pronouns', value: 'he/him', source: { kind: 'vault', post: 'p1', passage: 'Sam' } });
  assert.equal(JSON.parse(pronouns.content[0].text).error, 'NoEvidence');
});

test('the person confirms from the command line', async () => {
  const { dir, agent } = await fresh();
  await agent.proposeIdentity({ field: 'timezone', value: 'Europe/Lisbon', source: said('I am on Lisbon time') });
  assert.match(execFileSync('node', [cli, 'confirm', 'timezone', dir], { encoding: 'utf8' }), /timezone is now "Europe\/Lisbon"/);
  assert.equal((await agent.start()).identity.timezone, 'Europe/Lisbon');
  assert.equal(JSON.parse(execFileSync('node', [cli, 'identity', dir], { encoding: 'utf8' })).fields.timezone, 'Europe/Lisbon');
  assert.throws(() => execFileSync('node', [cli, 'confirm', 'city', dir], { stdio: 'pipe' }));
});

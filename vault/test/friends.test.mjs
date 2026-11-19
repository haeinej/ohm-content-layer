import assert from 'node:assert/strict';
import test from 'node:test';
import { secp256k1 } from '../service/node_modules/@noble/curves/secp256k1.js';
import { blockStore, friendsBlock } from '../service/src/blocks.mjs';
import { createIdentity, documentAddress } from '../service/src/identity.mjs';
import { postStore } from '../service/src/store.mjs';
import { createService } from '../service/src/worker.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';

// Every person and block here is invented.
const audience = 'did:web:vault.ohmmmm.test';
const refusal = code => problem => problem.code === code;
let made = 0;
const id = () => newPostId(Date.parse('2026-11-19T00:00:00Z') + made++, 7);
const file = (text, extra = {}) => ({ id: id(), path: 'notes/shared.md', text, ...extra });
const FRIENDS = '---\nkind: text\ntitle: For friends\nvisibility: friends\n---\n\nShared words.\n';

test('the friends layer keeps friends-only blocks, and nothing private, public or a post', async () => {
  const store = blockStore(await testDatabase());
  const me = 'did:web:pds.haein.test';
  const one = file(FRIENDS);
  const saved = await store.write(me, one);
  assert.deepEqual(await store.read(me, one.id), { block: { id: one.id, path: one.path, text: FRIENDS }, version: saved.version });
  assert.deepEqual((await store.write(me, one, { replaces: saved.version })).unchanged, true);
  const listed = await store.list(me);
  assert.deepEqual(listed.blocks, [{ id: one.id, version: saved.version, path: 'notes/shared.md', kind: 'text', title: 'For friends' }]);

  // Two edits from the same starting point: the second is refused, not lost.
  const edited = await store.write(me, { ...one, text: FRIENDS.replace('Shared', 'Edited') }, { replaces: saved.version });
  await assert.rejects(store.write(me, { ...one, text: FRIENDS.replace('Shared', 'Other') }, { replaces: saved.version }), refusal('Changed'));
  await assert.rejects(store.write(me, file(FRIENDS)), refusal('PathTaken'));
  await store.remove(me, one.id, { replaces: edited.version });
  assert.deepEqual((await store.list(me, { since: listed.cursor })).blocks.map(each => each.removed ?? each.version), [true]);
  await assert.rejects(store.read(me, one.id), refusal('NotFound'));

  const refused = given => assert.throws(() => friendsBlock(given), refusal('InvalidBlock'));
  refused(file('A private note.\n'));
  refused(file('---\nkind: text\nvisibility: private\n---\n\nx'));
  refused(file('---\nkind: text\nvisibility: public\n---\n\nx'));
  refused(file('---\ntitle: Old\nvisibility: friends\n---\n\nA post file.'));
  refused(file(FRIENDS, { path: '_drafts/a.md' }));
  refused(file(FRIENDS, { path: 'notes/a.txt' }));
  refused(file(FRIENDS.replace('---\n\n', `id: ${id()}\n---\n\n`)));
  refused(file(FRIENDS, { extra: 1 }));
  refused({ ...file(FRIENDS), id: 'not-an-id' });
  refused(file('---\nkind: text\nvisibility: friends\norigin: notes.md\n---\n\nx'));
  assert.match((() => { try { friendsBlock(file('Mine.')); } catch (problem) { return problem.message; } })(), /private block is never kept readable/);
  assert.match((() => { try { friendsBlock(file('---\ntitle: Old\nvisibility: friends\n---\n\nx')); } catch (problem) { return problem.message; } })(), /give it a kind/);
  assert.throws(() => friendsBlock(file('x'.repeat(600_001))), refusal('TooLarge'));
});

// Members who prove who they are with tokens from their own PDS, as the service checks them.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = input => {
  let value = 0n;
  for (const byte of input) value = value * 256n + BigInt(byte);
  let text = '';
  for (; value > 0n; value /= 58n) text = ALPHABET[Number(value % 58n)] + text;
  return text;
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function account(did) {
  const secret = secp256k1.utils.randomPrivateKey();
  const document = { id: did, verificationMethod: [{ id: `${did}#atproto`, type: 'Multikey', controller: did,
    publicKeyMultibase: `z${base58(Uint8Array.from([0xe7, 0x01, ...secp256k1.getPublicKey(secret, true)]))}` }] };
  const token = async lxm => {
    const signed = `${encode({ typ: 'JWT', alg: 'ES256K' })}.${encode({ iss: did, aud: audience, lxm, exp: Math.floor(Date.now() / 1000) + 60 })}`;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signed)));
    return `${signed}.${Buffer.from(secp256k1.sign(digest, secret, { lowS: true }).toCompactRawBytes()).toString('base64url')}`;
  };
  return { did, document, token };
}

async function running() {
  const haein = account('did:web:pds.haein.test'), jun = account('did:web:pds.jun.test'), mina = account('did:web:pds.mina.test');
  const stranger = account('did:web:pds.stranger.test');
  const documents = Object.fromEntries([haein, jun, mina, stranger].map(each => [documentAddress(each.did), each.document]));
  const whoIs = createIdentity({ audience, members: [haein, jun, mina].map(each => each.did).join(','), get: async url => Response.json(documents[String(url)]) });
  const env = { DB: await testDatabase(), MEMBERS: '*', SERVICE_DID: audience, OHM_APP_ORIGIN: 'https://app.ohmmmm.test' };
  const service = createService({ whoIs, get: async () => Response.json(null) });
  const ask = async (as, name, { query = {}, body } = {}) => {
    const method = `com.ohmmmm.vault.${name}`;
    const url = new URL(`https://vault.ohmmmm.test/xrpc/${method}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await service(new Request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await as.token(method)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, ...(await response.json()) };
  };
  return { haein, jun, mina, stranger, ask, env };
}

test('a friend reads what is shared with them, and nobody else learns it is there', async () => {
  const { haein, jun, mina, stranger, ask, env } = await running();
  // Haein keeps a friends-only block, a friends-only post and a private post.
  const block = file(FRIENDS);
  assert.equal((await ask(haein, 'putBlock', { body: { block } })).status, 200);
  const posts = postStore(env.DB);
  const post = (slug, visibility) => ({ id: id(), slug, label: 'Writings', sublabel: '', visibility, title: slug, body: 'Words.', properties: {} });
  const friendsPost = post('for-friends', 'friends'), privatePost = post('only-mine', 'private');
  await posts.write(haein.did, friendsPost);
  await posts.write(haein.did, privatePost);
  assert.equal((await ask(haein, 'getBlock', { query: { id: block.id } })).block.text, FRIENDS);

  // Not yet a friend: the same answer as for someone with nothing to share.
  const notShared = await ask(jun, 'listShared', { query: { owner: haein.did } });
  assert.deepEqual([notShared.status, notShared.error], [404, 'NotFound']);
  assert.deepEqual(await ask(jun, 'listShared', { query: { owner: mina.did } }), notShared);

  // Adding a friend needs the member signed in to ohm; a token, as an agent has, is not enough.
  assert.deepEqual([(await ask(haein, 'addFriend', { body: { did: jun.did } })).status], [401]);
  await blockStore(env.DB).addFriend(haein.did, jun.did);
  assert.deepEqual((await ask(haein, 'listFriends')).friends.map(each => each.did), [jun.did]);

  const shared = await ask(jun, 'listShared', { query: { owner: haein.did } });
  assert.equal(shared.status, 200);
  assert.deepEqual(shared.blocks.map(each => [each.id, each.kind, each.path]).sort(), [
    [block.id, 'text', 'notes/shared.md'], [friendsPost.id, 'post', 'Writings/for-friends.md'],
  ].sort());
  assert.equal((await ask(jun, 'getShared', { query: { owner: haein.did, id: block.id } })).block.text, FRIENDS);
  assert.match((await ask(jun, 'getShared', { query: { owner: haein.did, id: friendsPost.id } })).block.text, /visibility: friends/);
  // A private post is never shared, even by its ID.
  assert.equal((await ask(jun, 'getShared', { query: { owner: haein.did, id: privatePost.id } })).status, 404);
  // A friend reads; they cannot change anything, and a third member sees nothing.
  assert.equal((await ask(jun, 'getBlock', { query: { id: block.id } })).status, 404);
  assert.equal((await ask(mina, 'listShared', { query: { owner: haein.did } })).status, 404);
  // The member reads their own layer with their own requests, not as a friend of themselves.
  assert.equal((await ask(haein, 'listShared', { query: { owner: haein.did } })).status, 404);
  // Someone who is not let in to the service at all is turned away before anything is looked at.
  assert.deepEqual([(await ask(stranger, 'listShared', { query: { owner: haein.did } })).error], ['NotAMember']);

  // Removed from the list, the friend is back to seeing nothing.
  assert.equal((await ask(haein, 'removeFriend', { body: { did: jun.did } })).removed, true);
  assert.equal((await ask(jun, 'listShared', { query: { owner: haein.did } })).status, 404);
  assert.equal((await ask(haein, 'removeFriend', { body: { did: jun.did } })).unchanged, true);
  assert.equal((await ask(haein, 'removeFriend', { body: { did: 'not a did' } })).error, 'InvalidRequest');
  await assert.rejects(blockStore(env.DB).addFriend(haein.did, haein.did), refusal('InvalidRequest'));
  // A block refused for its layer says why, through the service as in the store.
  const refused = await ask(haein, 'putBlock', { body: { block: file('Mine.', { path: 'notes/mine.md' }) } });
  assert.deepEqual([refused.status, refused.error], [400, 'InvalidBlock']);
});

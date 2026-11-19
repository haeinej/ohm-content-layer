// The private layer's store: private blocks as { id, ciphertext, version }, which the service keeps
// and cannot read. Sealed here with WebCrypto in the format ohm-onboarding's packages/keys makes (a
// file key wrapped by a master key, the contents encrypted with the file key); no real member key,
// passkey or device is involved.
import assert from 'node:assert/strict';
import test from 'node:test';
import { privateStore, privateVersion, sealedBlock } from '../service/src/private.mjs';
import { blockStore } from '../service/src/blocks.mjs';
import { testDatabase } from './d1.mjs';
import { running } from './members.mjs';

const refusal = code => problem => problem.code === code;
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const opaque = () => b64(crypto.getRandomValues(new Uint8Array(16)));

// A sealed file as packages/keys makes one, for a master key held only by this test.
async function sealer() {
  const master = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const context = (did, id, part) => new TextEncoder().encode(`ohm-vault/file/v1|${did}|${id}|${part}`);
  const seal = async (key, plain, aad) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv: b64(iv), ciphertext: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain))) };
  };
  return {
    async seal(did, id, text, generation = 1) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const fileKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      return { v: 1, alg: 'A256GCM', ...(generation === 1 ? {} : { generation }), key: await seal(master, raw, context(did, id, 'key')), data: await seal(fileKey, new TextEncoder().encode(text), context(did, id, 'data')) };
    },
    async open(did, id, sealed) {
      const open = async (key, part, aad) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(part.iv, 'base64url'), additionalData: aad }, key, Buffer.from(part.ciphertext, 'base64url')));
      const raw = await open(master, sealed.key, context(did, id, 'key'));
      return new TextDecoder().decode(await open(await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']), sealed.data, context(did, id, 'data')));
    },
  };
}

test('the private store keeps sealed files only, with compare-and-swap on a version over the ciphertext', async () => {
  const db = await testDatabase();
  const store = privateStore(db);
  const keys = await sealer();
  const me = 'did:web:pds.haein.test';
  const id = opaque();
  const words = '---\nid: 3mzocqfoc22if\nkind: text\ntitle: Only mine\nvisibility: private\n---\n\nA secret about walking.\n';
  const ciphertext = await keys.seal(me, id, words);

  const saved = await store.write(me, { id, ciphertext });
  assert.match(saved.version, /^pv_[0-9a-f]{32}$/);
  assert.deepEqual(await store.read(me, id), { id, ciphertext, version: saved.version });
  assert.equal(await keys.open(me, id, (await store.read(me, id)).ciphertext), words);
  // Nothing readable is in the database: not the text, the title, the path or the TID.
  const held = JSON.stringify(db.sqlite.prepare('SELECT * FROM private_blocks').all());
  for (const secret of ['walking', 'Only mine', 'notes', '3mzocqfoc22if', 'private']) assert.ok(!held.includes(secret), secret);
  // The same ciphertext again changes nothing; the version names exactly one ciphertext.
  assert.equal((await store.write(me, { id, ciphertext }, { replaces: saved.version })).unchanged, true);
  assert.equal(saved.version, await privateVersion(sealedBlock({ id, ciphertext }).text));

  // Two devices edit from the same version: the second is refused and told the current version.
  const first = await store.write(me, { id, ciphertext: await keys.seal(me, id, 'edit one') }, { replaces: saved.version });
  const stale = await store.write(me, { id, ciphertext: await keys.seal(me, id, 'edit two') }, { replaces: saved.version }).catch(problem => problem);
  assert.deepEqual([stale.code, stale.extra.current], ['Changed', first.version]);
  await assert.rejects(store.write(me, { id: opaque(), ciphertext }, { replaces: 'pv_0' }), refusal('Changed'));
  await assert.rejects(store.write(me, { id, ciphertext }), refusal('Changed'));

  // Listing says only what the service can know: IDs, versions, sizes, generations.
  const listed = await store.list(me);
  assert.deepEqual(Object.keys(listed.blocks[0]).sort(), ['generation', 'id', 'size', 'version']);
  // Removing names the version; afterwards the list since then says it went.
  await assert.rejects(store.remove(me, id, { replaces: saved.version }), refusal('Changed'));
  await store.remove(me, id, { replaces: first.version });
  assert.deepEqual((await store.list(me, { since: listed.cursor })).blocks, [{ id, removed: true }]);
  await assert.rejects(store.read(me, id), refusal('NotFound'));
  assert.equal((await store.remove(me, id)).unchanged, true);
});

test('readable text, wrong shapes and named IDs are refused before anything is kept', async () => {
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const id = opaque();
  const good = await keys.seal(did, id, 'x');
  const refused = (given, pattern) => assert.throws(() => sealedBlock(given), problem => problem.code === 'InvalidBlock' && (!pattern || pattern.test(problem.message)));
  refused({ id, ciphertext: '---\ntitle: Mine\n---\n\nplain text' }, /sealed file/);
  refused({ id, ciphertext: { ...good, text: 'plain text' } }, /never sent readable/);
  refused({ id, ciphertext: good, path: 'notes/mine.md' }, /id and ciphertext/);
  refused({ id: 'notes/mine.md', ciphertext: good }, /opaque ID/);
  refused({ id: 'short', ciphertext: good }, /opaque ID/);
  refused({ id, ciphertext: { ...good, v: 2 } });
  refused({ id, ciphertext: { ...good, generation: 0 } });
  refused({ id, ciphertext: { ...good, key: { ...good.key, ciphertext: 'not base64url!' } } });
  refused({ id, ciphertext: { ...good, key: { ...good.key, ciphertext: good.key.ciphertext.slice(4) } } }, /file key/);
  refused({ id, ciphertext: { ...good, data: { ...good.data, iv: 'AAAA' } } }, /nonce/);
  assert.throws(() => sealedBlock({ id, ciphertext: { ...good, data: { ...good.data, ciphertext: 'A'.repeat(1_000_001) } } }), refusal('TooLarge'));
  // A changed ciphertext is the member's device's to notice: the service keeps what it was sent, and
  // the file no longer opens.
  const store = privateStore(await testDatabase());
  const tampered = { ...good, data: { ...good.data, ciphertext: good.data.ciphertext.replace(/^./, good.data.ciphertext[0] === 'A' ? 'B' : 'A') } };
  await store.write(did, { id, ciphertext: tampered });
  await assert.rejects(keys.open(did, id, (await store.read(did, id)).ciphertext));
});

test('a key rotation finds the files it has not re-wrapped, and finishes by compare-and-swap', async () => {
  const store = privateStore(await testDatabase());
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const ids = [opaque(), opaque(), opaque()];
  const versions = {};
  for (const id of ids) versions[id] = (await store.write(did, { id, ciphertext: await keys.seal(did, id, id) })).version;
  // One is re-wrapped by master key 2; the other two are still below it.
  const moved = await store.write(did, { id: ids[0], ciphertext: await keys.seal(did, ids[0], ids[0], 2) }, { replaces: versions[ids[0]] });
  assert.deepEqual((await store.list(did, { below: 2 })).blocks.map(each => each.id).sort(), ids.slice(1).sort());
  assert.equal((await store.read(did, ids[0])).ciphertext.generation, 2);
  assert.equal((await store.list(did)).blocks.find(each => each.id === ids[0]).generation, 2);
  await assert.rejects(store.list(did, { below: 0 }), refusal('InvalidRequest'));
  assert.ok(moved.version);
});

test('only the member reaches their private blocks; friends and other members see nothing', async () => {
  const { haein, jun, ask, env } = await running();
  const keys = await sealer();
  const id = opaque();
  const ciphertext = await keys.seal(haein.did, id, 'mine alone');
  const put = await ask(haein, 'putPrivateBlock', { body: { block: { id, ciphertext } } });
  assert.equal(put.status, 200);
  assert.equal((await ask(haein, 'getPrivateBlock', { query: { id } })).version, put.version);
  assert.equal((await ask(haein, 'listPrivateBlocks')).blocks.length, 1);

  // Even a friend: private blocks are not in the friends layer, by ID or by listing.
  await blockStore(env.DB).addFriend(haein.did, jun.did);
  // (An opaque ID is not even a block ID the friends layer takes, so it is refused as malformed.)
  const asFriend = await ask(jun, 'getShared', { query: { owner: haein.did, id } });
  assert.deepEqual([asFriend.status, asFriend.ciphertext, asFriend.block], [400, undefined, undefined]);
  assert.deepEqual((await ask(jun, 'listShared', { query: { owner: haein.did } })).blocks, []);
  // Another member's own requests see only their own (none), and cannot change Haein's.
  assert.equal((await ask(jun, 'getPrivateBlock', { query: { id } })).status, 404);
  assert.deepEqual((await ask(jun, 'listPrivateBlocks')).blocks, []);
  const theirs = await ask(jun, 'putPrivateBlock', { body: { block: { id, ciphertext } } });
  assert.equal(theirs.status, 200);
  assert.equal((await ask(haein, 'getPrivateBlock', { query: { id } })).version, put.version);
  // Refusals come through the service as from the store.
  const refused = await ask(haein, 'putPrivateBlock', { body: { block: { id, ciphertext: 'plain text' } } });
  assert.deepEqual([refused.status, refused.error], [400, 'InvalidBlock']);
  const stale = await ask(haein, 'deletePrivateBlock', { body: { id, replaces: 'pv_old' } });
  assert.deepEqual([stale.status, stale.error, stale.current], [409, 'Changed', put.version]);
  assert.equal((await ask(haein, 'deletePrivateBlock', { body: { id, replaces: put.version } })).removed, true);
});

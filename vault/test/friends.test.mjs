import assert from 'node:assert/strict';
import test from 'node:test';
import { blockStore, friendsBlock } from '../service/src/blocks.mjs';
import { postStore } from '../service/src/store.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';
import { running } from './members.mjs';

// Every person and block here is invented.
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

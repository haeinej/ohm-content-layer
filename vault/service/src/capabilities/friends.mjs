// Friends: the member's friends layer. Their friends-only blocks other than posts (friends-only
// posts are kept with the Posts requests), who their friends are, and what a friend may read.
// The service can read everything in this layer, so it can show it to those friends; private blocks
// are never sent here; they are kept as ciphertext by the Private requests (plans/encryption.md).
export default {
  name: 'Friends',
  about: 'The friends layer: friends-only blocks, kept readable so the friends a member chose can read them, and the friend list that says who they are. A friend reads friends-only posts and blocks alike. Private blocks are never kept here.',
  requests: {
    'com.ohmmmm.vault.listBlocks': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Every friends-only block that is not a post, with the version it is at. With `since`, a point an earlier list returned, only what changed after it, removals included.',
      takes: { since: 'optional: the `cursor` of an earlier list' },
      gives: '`blocks` (id, version, path, kind, title), `cursor`, and `more` when there is another page',
      run: ({ url, blocks, did }) => blocks.list(did, { since: url.searchParams.get('since') ?? undefined }),
    },
    'com.ohmmmm.vault.getBlock': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One friends-only block, as the file it is in the member\'s folder, and its version.',
      takes: { id: 'the block\'s ID' },
      gives: '`block` (id, path, text), `version`',
      run: ({ url, blocks, did }) => blocks.read(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.vault.putBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Saves one friends-only block, as its file: its path in the folder and its text, which must say `visibility: friends`. A private or public block, or a post, is refused. `replaces` is the version being replaced and is left out for a new block. Sent twice, it ends the same as sent once. From then on the friends on the list can read it.',
      takes: { block: '`id`, `path` and `text`', replaces: 'optional: the version it replaces' },
      gives: '`id`, `version`, and `unchanged` when nothing differed',
      run: async ({ body, blocks, did }) => {
        const { block, replaces = null } = await body();
        return blocks.write(did, block, { replaces });
      },
    },
    'com.ohmmmm.vault.deleteBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Removes one friends-only block from this layer, for good. Friends can no longer read it.',
      takes: { id: 'the block\'s ID', replaces: 'the version being removed' },
      gives: '`id`, `removed`',
      run: async ({ body, blocks, did }) => {
        const { id, replaces = null } = await body();
        return blocks.remove(did, id, { replaces });
      },
    },
    'com.ohmmmm.vault.listFriends': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Who may read the member\'s friends layer.',
      takes: {},
      gives: '`friends` (did, added)',
      run: ({ blocks, did }) => blocks.friends(did),
    },
    'com.ohmmmm.vault.addFriend': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'Lets one more DID read the member\'s friends layer: every friends-only post and block, now and later. Only the member, signed in to ohm, can add a friend; an agent cannot.',
      takes: { did: 'the friend\'s DID' },
      gives: '`did`, and `unchanged` when they were a friend already',
      run: async ({ body, blocks, did }) => blocks.addFriend(did, (await body()).did),
    },
    'com.ohmmmm.vault.removeFriend': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Stops one DID reading the member\'s friends layer. What they read before cannot be taken back.',
      takes: { did: 'the friend\'s DID' },
      gives: '`did`, `removed`, and `unchanged` when they were not a friend',
      run: async ({ body, blocks, did }) => blocks.removeFriend(did, (await body()).did),
    },
    'com.ohmmmm.vault.listShared': {
      verb: 'GET', asks: 'token', changes: false,
      about: 'What another member shares with the asker: their friends-only blocks and posts, when the asker is on their friend list. To anyone else it answers NotFound, whether or not anything is there.',
      takes: { owner: 'the DID whose friends layer to read' },
      gives: '`owner`, `blocks` (id, version, path, kind, title)',
      run: ({ url, blocks, did }) => blocks.shared(url.searchParams.get('owner'), did),
    },
    'com.ohmmmm.vault.getShared': {
      verb: 'GET', asks: 'token', changes: false,
      about: 'One friends-only block or post another member shares with the asker, as its file.',
      takes: { owner: 'the DID whose friends layer to read', id: 'the block\'s or post\'s ID' },
      gives: '`block` (id, path, text), `version`',
      run: ({ url, blocks, did }) => blocks.readShared(url.searchParams.get('owner'), did, url.searchParams.get('id')),
    },
  },
};

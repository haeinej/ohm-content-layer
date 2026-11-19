// Private: the member's private layer. Private blocks are kept here only as ciphertext, sealed on
// the member's devices with keys the service never holds (plans/encryption.md). Only the member
// reaches them; a friend never does, and the service cannot read them for anyone.
export default {
  name: 'Private',
  about: 'The private layer: private blocks, kept only as ciphertext sealed on the member\'s devices. The service stores and syncs them and cannot read them; no friend or agent can be given their contents by the service. Each is `{ id, ciphertext, version }`, with an opaque ID and compare-and-swap on the version.',
  requests: {
    'com.ohmmmm.vault.listPrivateBlocks': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Every private block, by opaque ID, with its version, size and the generation of the master key that wraps its key. With `since`, only what changed after an earlier list, removals included. With `below`, only blocks wrapped by an older generation than that, for finishing a key rotation.',
      takes: { since: 'optional: the `cursor` of an earlier list', below: 'optional: a generation' },
      gives: '`blocks` (id, version, generation, size), `cursor`, and `more` when there is another page',
      run: ({ url, privateBlocks, did }) => privateBlocks.list(did, { since: url.searchParams.get('since') ?? undefined, below: url.searchParams.get('below') ?? undefined }),
    },
    'com.ohmmmm.vault.getPrivateBlock': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One private block\'s ciphertext and version. Only the member\'s devices can open it.',
      takes: { id: 'the block\'s opaque ID' },
      gives: '`id`, `ciphertext`, `version`',
      run: ({ url, privateBlocks, did }) => privateBlocks.read(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.vault.putPrivateBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Saves one private block\'s ciphertext. Anything that is not a sealed file is refused, so readable text is never kept. `replaces` is the version being replaced and is left out for a new block. Sent twice, it ends the same as sent once.',
      takes: { block: '`id` and `ciphertext` (the sealed file)', replaces: 'optional: the version it replaces' },
      gives: '`id`, `version`, and `unchanged` when nothing differed',
      run: async ({ body, privateBlocks, did }) => {
        const { block, replaces = null } = await body();
        return privateBlocks.write(did, block, { replaces });
      },
    },
    'com.ohmmmm.vault.deletePrivateBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Removes one private block for good.',
      takes: { id: 'the block\'s opaque ID', replaces: 'the version being removed' },
      gives: '`id`, `removed`',
      run: async ({ body, privateBlocks, did }) => {
        const { id, replaces = null } = await body();
        return privateBlocks.remove(did, id, { replaces });
      },
    },
  },
};

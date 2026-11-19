// Private: the member's private layer. Private blocks are kept here only as ciphertext, sealed on
// the member's devices with keys the service never holds (plans/encryption.md). Only the member
// reaches them; a friend never does, and the service cannot read them for anyone.
import { Refused } from '../store.mjs';

export default {
  name: 'Private',
  about: 'The private layer: private blocks, kept only as ciphertext sealed on the member\'s devices. The service stores and syncs them and cannot read them; no friend or agent can be given their contents by the service. Each is `{ id, ciphertext, version }`, with an opaque ID and compare-and-swap on the version. Several change together or not at all; every version is kept for restoring; the journal is sealed too; and a key rotation re-wraps every kept version and journal entry.',
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
      about: 'Saves one private block\'s ciphertext. Anything that is not a sealed file is refused, so readable text is never kept, and so is a block sealed under an older master key than a rotation started. `replaces` is the version being replaced and is left out for a new block. Sent twice, it ends the same as sent once.',
      takes: { block: '`id` and `ciphertext` (the sealed file)', replaces: 'optional: the version it replaces', journal: 'optional: a sealed journal entry describing the change' },
      gives: '`id`, `version`, `rev` (the kept version it made), and `unchanged` when nothing differed',
      run: async ({ body, privateBlocks, did }) => {
        const { block, replaces = null, journal = null } = await body();
        return privateBlocks.write(did, block, { replaces, journal });
      },
    },
    'com.ohmmmm.vault.putPrivateBlocks': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Changes several private blocks together, all or none, as moving a block between channels changes the block and two channel files. Each change is a write (`id`, `ciphertext`, `replaces`) or a removal (`id`, `remove: true`, `replaces`); one stale version, or one block sealed under a key older than a rotation started, refuses them all. `batchId` makes it safe to send again: a repeat answers what the first did and changes nothing.',
      takes: { changes: 'the changes, 1 to 100', batchId: 'a key the device makes for this batch', journal: 'optional: a sealed journal entry describing them' },
      gives: '`blocks` (id, version and rev, or removed), and `replayed` for a repeat',
      run: async ({ body, privateBlocks, did }) => {
        const { changes, batchId, journal = null } = await body();
        if (typeof batchId !== 'string') throw new Refused(400, 'InvalidRequest', 'Give the batch a batchId, so it is safe to send again');
        return privateBlocks.apply(did, changes, { batchId, journal });
      },
    },
    'com.ohmmmm.vault.listPrivateVersions': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'A private block\'s kept versions, newest first, each by a `rev` that never changes. The device opens one to show or restore it; restoring is a new change.',
      takes: { id: 'the block\'s opaque ID' },
      gives: '`id`, `versions` (rev, version, generation, size, created)',
      run: ({ url, privateBlocks, did }) => privateBlocks.versions(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.vault.getPrivateVersion': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One kept version of a private block, as ciphertext.',
      takes: { id: 'the block\'s opaque ID', rev: 'the version\'s rev' },
      gives: '`id`, `rev`, `version`, `ciphertext`',
      run: ({ url, privateBlocks, did }) => privateBlocks.readVersion(did, url.searchParams.get('id'), url.searchParams.get('rev')),
    },
    'com.ohmmmm.vault.listPrivateJournal': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'The private layer\'s journal: sealed entries, oldest first, after `since`. Only the member\'s devices can read what each says.',
      takes: { since: 'optional: the `cursor` of an earlier list' },
      gives: '`entries` (seq, entry, created), `cursor`, and `more` when there is another page',
      run: ({ url, privateBlocks, did }) => privateBlocks.journal(did, { since: url.searchParams.get('since') ?? undefined }),
    },
    'com.ohmmmm.vault.beginPrivateRotation': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Starts a rotation of the member\'s master key to generation `target`, as the private store sees it: from now on a block sealed under an older generation is refused. The re-wrap happens on the member\'s device. The same target again changes nothing.',
      takes: { target: 'the generation being rotated to' },
      gives: '`target`, `state`, `remaining` (blocks still below it), and `unchanged` when it was already started',
      run: async ({ body, privateBlocks, did }) => privateBlocks.beginRotation(did, (await body()).target),
    },
    'com.ohmmmm.vault.getPrivateRotation': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'The member\'s latest key rotation, and how many private blocks are still below its target, so any device can resume it.',
      takes: {},
      gives: '`rotation` (target, state, remaining, started, finished) or null',
      run: ({ privateBlocks, did }) => privateBlocks.rotation(did),
    },
    'com.ohmmmm.vault.listPrivateBelow': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'What a rotation to `target` still has to re-wrap: every kept version (by block and rev) and journal entry (by seq) sealed under an older key.',
      takes: { target: 'the generation being rotated to' },
      gives: '`target`, `versions` (id, rev, generation), `journal` (seq, generation), and `more` when there is more',
      run: ({ url, privateBlocks, did }) => privateBlocks.belowTarget(did, url.searchParams.get('target')),
    },
    'com.ohmmmm.vault.rewrapPrivate': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Re-wrapped copies of kept versions and journal entries, for a rotation under way to `target`. Each must keep exactly the contents it replaces, with only its file key re-wrapped; a version that is its block\'s latest moves the block with it. All are kept or none. Safe to send again.',
      takes: { target: 'the generation being rotated to', versions: '`id`, `rev`, `ciphertext` for each', journal: '`seq`, `entry` for each' },
      gives: '`target`, `remaining`',
      run: async ({ body, privateBlocks, did }) => {
        const { target, versions = [], journal = [] } = await body();
        return privateBlocks.rewrap(did, target, { versions, journal });
      },
    },
    'com.ohmmmm.vault.finishPrivateRotation': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Finishes the rotation to `target`, only if no kept version or journal entry is still below it, checked in the same statement. The account deletes the old key\'s copies only after this.',
      takes: { target: 'the generation being rotated to' },
      gives: '`target`, `state`, and `unchanged` when it was already finished',
      run: async ({ body, privateBlocks, did }) => privateBlocks.finishRotation(did, (await body()).target),
    },
    'com.ohmmmm.vault.deletePrivateBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Removes one private block. Its kept versions stay, so it can be restored.',
      takes: { id: 'the block\'s opaque ID', replaces: 'the version being removed', journal: 'optional: a sealed journal entry' },
      gives: '`id`, `removed`',
      run: async ({ body, privateBlocks, did }) => {
        const { id, replaces = null, journal = null } = await body();
        return privateBlocks.remove(did, id, { replaces, journal });
      },
    },
  },
};

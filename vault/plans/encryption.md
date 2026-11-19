# Three layers: public, friends, and a private vault the server cannot read

Written 19 November 2026, revised the same day. Keys live in ohm-onboarding, the account app. Partly built: see Steps. It extends [vault.md](vault.md). In the merged repository this is `vault/plans/encryption.md`; a person's vault folder is `ohmmmm.<handle>/vault`, beside their cortex (../../README.md).

The first version of this plan encrypted friends-only content end to end as well. This revision keeps end-to-end encryption for the private layer only. The server can read the public and friends layers, so it can serve, search and share them; the private layer is a wallet the server holds but cannot open.

## The idea

ohm is a web app you can open on any device, with your whole vault there: rendered, searchable, editable. What the server can do with it depends on the layer.

| Layer | Who can read it | Where it is kept | Trust |
| --- | --- | --- | --- |
| **Public** | Anyone | `com.ohmmmm.post` records on the member's PDS | Public by design |
| **Friends** | The member, the friends they chose, and the ohm server | The vault service, readable, access-checked by DID | The server enforces who sees it, as AT Protocol's proposed spaces would |
| **Private** | The member's devices, and nothing else | The vault service, as ciphertext only | No server is trusted. The keys are on the member's devices, as a wallet's are |

Private is the default. Everything starts there, and moving something out of it is a choice the member makes.

The private layer works like a password manager such as 1Password, or a messenger with linked devices such as Signal: any of your devices can open it, and the server stores and relays what it cannot read. The friends layer works like an ordinary cloud service, closer to Telegram's cloud chats: convenient and readable by the provider. Each layer says plainly which it is.

## What the server holds

| Held by the server | Readable by it | Why |
| --- | --- | --- |
| The ohm account and the DID it is linked to | Yes | Sign-in, and proof of which identity is yours (today's `links` table) |
| Handle and profile | Yes | Already public in AT Protocol |
| Published posts | Yes | Public by design; they live on the member's PDS and ohm may index them |
| Friends-layer blocks, as `{ id, path, text, version }`, and the member's friend list (DIDs) | Yes | So ohm can show them to those friends, search them, and render them on any device without keys. Encrypted at rest with a key ohm manages, which protects against a stolen disk or backup, not against ohm itself |
| A device link's one-time public key, while the link lasts (five minutes) | Yes | So the unlocked device's answer can be checked against the code it scanned. Public keys reveal nothing |
| Private-layer blocks, as `{ id, ciphertext, version }` | **No** | Storage and sync only |
| The master key, wrapped by each passkey's PRF output and by the recovery code, with each passkey's credential ID | **No** | So a signed-in device with a passkey, or the code, can unlock. The server cannot unwrap any copy |

Never held by the server in readable form: the master key, the recovery code, and the text, title, path, channels, links, origin or journal of any private block.

The server can still see that private files exist, how big they are and when they change. Padding sizes can blunt this but not remove it.

## Signing in and unlocking (private layer)

Signing in and unlocking are two different steps, and neither is enough alone.

| Step | With | Proves or gives | Who checks it |
| --- | --- | --- | --- |
| **Sign in** | OAuth: AT Protocol OAuth through the member's PDS, as the editor signs in today ([signin.js](../service/public/vault/signin.js)) | Who you are. Access to the public and friends layers, and to the private layer's ciphertext and wrapped keys | The server |
| **Unlock** | A passkey on the device, using WebAuthn's PRF extension | A secret only the passkey can produce, which opens the master key | Only the device. The server never sees the secret |
| **Recover** | The recovery code | Opens the master key when no passkey can | Only the device |

### The keys

- **Master key.** Made on the member's first device, and never sent anywhere unencrypted. It opens the file keys.
- **File keys.** Each private file is encrypted with its own key, wrapped by the master key, so keys can be rotated without re-encrypting every file.
- **The master key, wrapped twice.** The server stores two copies, each unreadable without its secret:
  - one wrapped with a key derived (HKDF) from the passkey's PRF output, alongside that passkey's credential ID; there is one such copy for each passkey;
  - one wrapped with a key derived from the recovery code.

### Setting up, on the first device

1. Sign in with OAuth.
2. The device makes the master key.
3. The device shows the recovery code once: 256 bits of randomness, written as 14 groups of four characters (Crockford base32, with a checksum that catches a mistyped character, and a version byte so a word list can be offered later). The member writes it down, and the app checks a few groups before going on. ohm cannot recover a private vault without it, and the app says so plainly before the vault is created.
4. The member creates a passkey. The device asks it for its PRF output, wraps the master key with it, and uploads that wrapped copy and the one wrapped by the code.

### Unlocking on a device

1. Sign in with OAuth.
2. Fetch the wrapped copies of the master key.
3. Ask the passkey for its PRF output, and unwrap the master key in the browser as a non-extractable WebCrypto key.

The key is held in memory for the session only, and is gone when the tab closes or after a set idle time. Nothing readable is written to the device's storage.

A passkey that the platform syncs (iCloud Keychain, Google Password Manager, a password manager) arrives on the member's other devices by itself, so a new phone or laptop unlocks with OAuth and the passkey, and nothing else.

### Recovering

If no passkey can unlock (all devices lost, or a passkey that does not support PRF):

1. Sign in with OAuth.
2. Enter the recovery code.
3. The device unwraps the master key with the code.
4. The device asks for a new passkey to be made, and wraps the master key with it for next time.

A device whose passkey provider lacks PRF can still use the vault, by entering the code each session, or by being linked by QR (below).

### Why both steps

- **Someone who takes over the OAuth sign-in** gets ciphertext and wrapped keys, and cannot open either.
- **Someone with the passkey** but not the account cannot fetch anything.
- **The server**, holding everything it stores, can open nothing.
- **The code's copy is safe to store**, because the code has 256 bits of randomness and cannot be guessed. That is also why there is no separate passphrase: a phrase a person makes up could be guessed against the stored copy.

### Changing things

These are possible while the vault is unlocked:
- adding a passkey: wrap the master key with its PRF output;
- removing a passkey: delete its wrapped copy;
- replacing the recovery code: wrap the master key with the new one, and delete the old copy.

If a passkey or the code may have been exposed, rotate the master key: make a new one, re-wrap every file key, and re-wrap the master key for each remaining passkey and the code. File contents do not need re-encrypting.

How rotation is built (ohm-onboarding `docs/keys.md`):
- Each master key has a **generation**; each wrapped copy and each sealed file says which generation it belongs to.
- The account holds the new key's copies beside the old key's until every file key is re-wrapped, then deletes the old copies. Each file is wrapped by one key or the other at every moment, and both keys are held, so stopping part way leaves every file openable; any device that opens the new key resumes.
- The old key is kept wrapped by the new one (**history**), so a file the re-wrap missed still opens. Whoever holds the newer key gets the older, never the reverse.
- A passkey's copy needs that passkey's PRF output, which only its authenticator gives, so a rotation keeps only the passkeys used on the rotating device; others are added again afterwards.

## Linking a device without a synced passkey

A device that cannot use any of the member's passkeys, and should not need the code, can be linked from one that is unlocked:

1. The new device shows a QR code holding a one-time public key.
2. The unlocked device scans it and sends the master key encrypted to that key, through the server, which cannot read it.
3. The new device then makes its own passkey, so it can unlock itself from then on.

Built in ohm-onboarding: a P-256 key pair whose private half never leaves the new device's memory, ECDH and HKDF to an AES key bound to the DID, the link and both public keys; the account keeps the handoff for five minutes, serves it once, and refuses an answer whose key is not the one the link started with. The QR code is what stops the server putting its own key in place of the new device's.

## The two stores

- **Friends store.** It holds readable vault files: today's D1 `posts` table, generalised from posts to every kind of block, so a block, a channel or an entity can be friends-only. Writes use compare-and-swap on `replaces`, as the post store does now.
- **Private store.** A vault file `{ path, text }` becomes `{ id, ciphertext, version }`. Built: `private_blocks` (`service/migrations/0003_private_layer.sql`) and the Private requests (`listPrivateBlocks`, `getPrivateBlock`, `putPrivateBlock`, `deletePrivateBlock`). The ciphertext is a sealed file as ohm-onboarding's `packages/keys` makes it; the service accepts that shape and nothing else, so readable text is refused. `generation`, the size and the version are the only things it can see, and `listPrivateBlocks` with `below` finds the files a rotation has not re-wrapped.
  - The ID is opaque, because paths and file names are content too.
  - `version` is computed over the ciphertext, so the server can still refuse a stale write without reading anything.
  - The journal, the index and the configuration of roots are private: encrypted the same way, or kept only on devices.

A channel can hold blocks from both layers. Its own file lives in the layer it was given. A private block's place in a friends channel is private, so a friend sees only the friends-layer items.

## Moving between layers

Each move is an act the member confirms, because it changes who can read something.

| From → to | What happens |
| --- | --- |
| Private → friends | The device decrypts the block and uploads it readable. **This is a disclosure: from then on the server can read it.** The editor says so before it happens |
| Private or friends → public | Publishing, as today: the device writes a `com.ohmmmm.post` to the PDS after the member approves. The block stays where it was, and the post is its public copy |
| Friends → private | The device encrypts the block and stores the ciphertext, and the server deletes its readable copy. The editor says plainly that the server could read it before, and that backups made before the move may still hold it |

## Using it

- **Web app.** Public and friends blocks are rendered, searched and linked by the server, on any device. Private blocks are downloaded as ciphertext, decrypted on the device, and searched and drawn in the graph there. `vault/node.mjs` and the word index already work on `{ path, text }`, so the same code runs in the browser.
- **Writing.** The editor saves to the layer the block is in. A private block is encrypted on the device before it is uploaded, so editor-made private content is safe on the server.
- **The local folder.** `ohm vault sync` brings both stores into line with the folder: it pulls friends files as they are, pulls private ciphertext and decrypts it with the member's key, and pushes changes back to the layer each block is in. The existing rules apply: nothing is removed on its own, and conflicts are kept beside the file. Agents, Obsidian, `ohm vault add`, the index and ohm-cortex keep working on the folder.
- **Which layer a file is in, in the folder.** In the folder every file is plain text, so the layer has to be written down. A block gets a `visibility` property (`private`, `friends` or `public`), as post files already have, with private when it is absent. It replaces the block lexicon's `intent`. `ohm vault sync` refuses to upload a file whose visibility changed from private until the member confirms, as in the table above.
- **Agents.** Through the local folder and its tools they read every layer the member's devices can read. Through the server they reach only public and friends; the server cannot give an agent anything private.

## The local editor bridge

An earlier draft proposed `ohm vault serve`: a small program on the member's machine that a browser editor talks to over localhost, so the editor reads and writes the folder directly. It does not sync anything; it is a way for a browser to reach local files.

This design makes it unnecessary for now. The web app can store private content safely as ciphertext, and `ohm vault sync` brings everything to the folder. A local bridge could come back later for working offline, or for keeping a vault that never touches the server at all.

## How this relates to AT Protocol's private data work

As understood when this was written, AT Protocol's proposals for private data ("spaces", permissioned data) are about access control: the host keeps the records, can read them, and lets only a space's members read them. Check the current proposals before relying on any detail.

- **The friends layer matches that model.** A friends block is a record a host keeps and reads, and shows only to the DIDs the member chose. If spaces arrive in AT Protocol, the friends store could move into one.
- **The private layer goes further.** It trusts no host, so it sits outside what spaces are designed to do.

## What changes from today

- Private posts are stored as readable text today, in the service's D1 `posts` table and in the site's KV under `private:`. They move to the private store, and then the readable copies are deleted.
- Friends-only posts stay readable, as they are now. The store is generalised from posts to every kind of block.
- The block lexicon's `intent` becomes `visibility`, which is now access control, deciding which store a block is kept in.

## Steps

1. ~~`visibility` on blocks in place of `intent`, read and written by `vault/node.mjs`, with private as the default.~~ Done. A file with `visibility`, no `kind` and nothing only a block has is still read as a post file, so existing post files do not change; post sync reads files with the post reader and is unaffected.
2. ~~Generalise the friends store from posts to vault files, with the friend list by DID and access checks.~~ Done on the service: `blocks` and `friends` tables (`service/migrations/0002_friends_layer.sql`), the Friends requests, friends-only posts readable by friends through the same requests. Friends-only posts stay in `posts`; other blocks are kept as files. Adding a friend is session-only. Not yet used by the editor or sync, and the migration is not applied to the deployed database.
3. Keys: setup (master key, recovery code, first passkey), unlock with OAuth and the passkey's PRF, recovery with the code, the wrapped copies on the server, file keys. **Built in ohm-onboarding**, the account app: `packages/keys` (the device side, tested with a stand-in authenticator) and the account service's `keys.*` requests for the wrapped copies, with the setup, unlock, recovery and management screens, and master key rotation. The recovery is a 56-character code rather than 24 words, because no word list was taken in; its version byte leaves room for one.
4. ~~The private store: the ciphertext format, opaque IDs, and compare-and-swap on ciphertext versions.~~ Done on the service (see "The two stores"). The migration is not applied to the deployed database, and nothing uses it yet but tests.
5. `ohm vault sync` between both stores and the local folder, with confirmation before anything leaves the private layer.
6. ~~Device linking by QR.~~ Built in ohm-onboarding (see above). Not tried with a real camera between two devices.
7. The web app: server-rendered public and friends; private decrypted, searched and graphed on the device.
8. Move existing private posts out of D1 and KV into the private store, then delete the readable copies.

## Open questions

- Which passkey providers support the PRF extension today, on which browsers and systems, so the app can say ahead of time whether a passkey will unlock or the code will be needed.
- How much metadata to hide in the private store (padding sizes, batching writes), against the cost.
- Whether a phone with a large private vault needs a local index, kept encrypted on the device.
- Friend lists: one list per member to start, or channel-level groups (closer to spaces) from the beginning.
- How long readable backups of the friends store are kept, since that bounds what moving a block back to private can promise.

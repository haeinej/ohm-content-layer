# Three layers: public, friends, and a private vault the server cannot read

Written 19 November 2026, revised the same day. A proposal; nothing here is built. It extends [vault.md](vault.md).

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
| The member's public encryption key, and each linked device's public key | Yes | Device links can be checked. Public keys reveal nothing |
| Private-layer blocks, as `{ id, ciphertext, version }` | **No** | Storage and sync only |

Never held by the server in readable form: the master key, the recovery phrase, and the text, title, path, channels, links, origin or journal of any private block.

The server can still see that private files exist, how big they are and when they change. Padding sizes can blunt this but not remove it.

## Keys (private layer)

- **Master key.** Made on the member's first device, and never sent anywhere unencrypted.
- **Recovery phrase.** Shown once at setup. It is the only way back if every device is lost. ohm cannot recover a private vault, and the app says so plainly before one is created.
- **Unlock.** A passkey on each device (WebAuthn, with the PRF extension where available, and a passphrase where not) unlocks the master key, which is stored wrapped on that device.
- **File keys.** Each private file is encrypted with its own key, wrapped by the master key, so keys can be rotated without re-encrypting every file.

## Devices

A new device shows a QR code. A device already signed in scans it, checks the new device's public key, and sends it the master key encrypted to that key. The server carries the handoff but cannot read it. Removing a device rotates the master key and re-wraps the file keys.

A device that is not linked can still sign in and use the public and friends layers, because those need no key. It sees that private blocks exist, and nothing else about them.

## The two stores

- **Friends store.** It holds readable vault files: today's D1 `posts` table, generalised from posts to every kind of block, so a block, a channel or an entity can be friends-only. Writes use compare-and-swap on `replaces`, as the post store does now.
- **Private store.** A vault file `{ path, text }` becomes `{ id, ciphertext, version }`.
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

1. `visibility` on blocks in place of `intent`, read and written by `vault/node.mjs`, with private as the default.
2. Generalise the friends store from posts to vault files, with the friend list by DID and access checks.
3. Keys: master key, recovery phrase, passkey unlock, file keys.
4. The private store: the ciphertext format, opaque IDs, and compare-and-swap on ciphertext versions.
5. `ohm vault sync` between both stores and the local folder, with confirmation before anything leaves the private layer.
6. Device linking by QR.
7. The web app: server-rendered public and friends; private decrypted, searched and graphed on the device.
8. Move existing private posts out of D1 and KV into the private store, then delete the readable copies.

## Open questions

- Which passkey providers support the PRF extension well enough to rely on.
- How much metadata to hide in the private store (padding sizes, batching writes), against the cost.
- Whether a phone with a large private vault needs a local index, kept encrypted on the device.
- Friend lists: one list per member to start, or channel-level groups (closer to spaces) from the beginning.
- How long readable backups of the friends store are kept, since that bounds what moving a block back to private can promise.

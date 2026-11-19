# A web vault the server cannot read

Written 19 November 2026. A proposal; nothing here is built. It extends [vault.md](vault.md).

## The idea

ohm is a web app that works like a messenger with linked devices: open it on any device, and your vault is there, rendered, searchable and editable. But the server never sees private content. It stores and relays data it cannot read. Your devices hold the key, the way a wallet holds yours.

This is closer to WhatsApp or Signal with linked devices, or to 1Password and Proton, than to Telegram. Telegram's ordinary cloud chats are readable by Telegram; only its Secret Chats are end-to-end encrypted, and those do not sync between devices.

## What the server holds, and what it never holds

The server holds what must be public or verifiable, and nothing private.

| Held by the server | Why |
| --- | --- |
| The ohm account and the DID it is linked to | Sign-in, and proof of which identity is yours (today's `links` table) |
| Handle and profile | Already public in AT Protocol |
| Published posts (`com.ohmmmm.post`) | Public by design; they live on the member's PDS and ohm may index them |
| The member's public encryption key, and each linked device's public key | So others can share with them and device links can be checked. Public keys reveal nothing |
| Encrypted vault files `{ id, ciphertext, version }` | Storage and sync only; unreadable without the member's key |

Never held by the server, in readable form:
- the master key or the recovery phrase;
- the text, title, path, channels, links, origin or journal of any private or friends-only block.

The server can still see that files exist, their sizes, and when they change. Padding sizes can blunt this but not remove it.

## Keys

- **Master key.** Made on the member's first device, never sent anywhere unencrypted.
- **Recovery phrase.** Shown once at setup. It is the only way back if every device is lost; ohm cannot recover a vault, and the app says so plainly before it is created.
- **Unlock.** A passkey on each device (WebAuthn, with the PRF extension where available) unlocks the master key stored wrapped on that device.
- **File keys.** Each file is encrypted with its own key, wrapped by the master key, so keys can be rotated and single files shared.

## Devices

A new device shows a QR code. A device already signed in scans it, checks the new device's public key, and sends it the master key encrypted to that key. The server carries the handoff but cannot read it. Removing a device rotates the master key and re-wraps file keys.

## The encrypted store

- A vault file `{ path, text }` becomes `{ id, ciphertext, version }`. The ID is opaque, because paths and file names are content too.
- `version` is computed over the ciphertext, so the server can still refuse a stale write (compare-and-swap on `replaces`, as the post store does today) without reading anything.
- The journal, the index and the configuration of roots are encrypted the same way, or kept only on devices.

## Using it

- **Reading.** The app downloads ciphertext, decrypts it on the device, and renders it. Search, connections and the graph run on the device: `vault/node.mjs` and the word index already work on `{ path, text }` and need no server.
- **Writing.** The editor encrypts on the device, then uploads. Editor-made content is safe to keep on the server because the server only holds ciphertext.
- **The local folder.** `ohm vault sync` pulls ciphertext, decrypts it with the member's key, writes the folder, and pushes changes back, with the existing rules: nothing removed on its own, conflicts kept beside the file. Agents, Obsidian, `ohm vault add` and the index keep working on the folder.
- **Agents.** They work through the local tools, or a browser session the member unlocked. The server cannot give an agent anything readable.

## Visibility

| Visibility | Where | Who can read it |
| --- | --- | --- |
| Public | `com.ohmmmm.post` records on the member's PDS | Anyone |
| Friends | A channel with DID members; its channel key is encrypted to each member's public key | Those members' devices |
| Private | The encrypted vault | The member's devices |

**Publishing** is the one moment content leaves the encrypted vault: the device decrypts the block, the member approves, and the device writes the public record to the PDS, as the editor's publish step does today.

## How this relates to AT Protocol's private data work

As understood when this was written, AT Protocol's proposals for private data ("spaces", permissioned data) are about access control: records kept by a host and readable only by a space's members, but the host enforces that and can read the data. Check the current proposals before relying on any detail.

- Shared shape: a space is like a channel with DID members, and data stays portable under the member's identity. The friends layer above is modelled on that.
- Different trust: spaces trust the host; this vault trusts no server. A friends channel encrypted as above could still be stored by a spaces-capable host without that host reading it.

## What changes from today

The vault service now stores private and friends-only posts as readable text in D1 (`posts`). Under this design they move into the encrypted store. The service keeps only identity, links, public keys, published records and ciphertext in its database.

## Steps

1. Keys: master key, recovery phrase, passkey unlock, file keys.
2. The encrypted file format and store, with compare-and-swap on versions.
3. `ohm vault sync` between the encrypted store and the local folder.
4. Device linking by QR.
5. The web app reads and writes through decryption on the device; search and graph run locally.
6. Friends channels with keys encrypted to members.
7. Move existing private and friends-only posts out of readable storage, then remove them from D1.

## Open questions

- Which passkey providers support the PRF extension well enough to rely on, and what the fallback is (a passphrase).
- How much metadata to hide (padding sizes, batching writes) against the cost.
- Whether search on a phone over a large vault needs a local index kept encrypted on the device.

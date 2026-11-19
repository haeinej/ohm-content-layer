# App data sources

[HomeSource](../../src/data/source.ts) is the browser data contract for versioned
vault files, ordered channels, evidence, entities, sources, search, history,
visibility, Friends and the publish plan. [The workspace guide](../../README.md)
walks through the sample experience. The [workspace store](../../src/workspace/store.ts)
uses the sample adapter's synchronous projection for the imported editor and
tree. Search reads the same adapter through the shared UI and WebMCP handler.
The service adapter is a member-side integration entry point. The workspace
currently runs on the sample adapter.

Use `listBlocks` and `readBlock` to find a file and its version. Pass that exact
version as `replaces` to update it, or `null` to create it. Refresh and review the
current file after a conflict. `vault()` returns the canonical
[`readVault`](../../../vault/vault/node.mjs) view, including entities and sources.
Use `vault.items(channel)` for resolved order and `connections()` for the vault's
evidence edges. This interface serves the workspace. Cortex continues to read
through its [read-only vault contract](../../../contract/vault-reader.mjs).

`createServiceSource({ origin, did })` uses the member's same-origin
`/vault/xrpc/*` session. The DID selects the signed-in account's vault. The
[service](../../../vault/service/CAPABILITIES.md) validates access. Shared reads
require `sharedServiceToken` for the reader's DID and the exact request method.
Use the account app's browser `packages/keys` exports as `privateSession.keys` and
supply the active DID and unlocked keyring through `privateSession.unlocked`.
The callback returns `null` on lock. Private reads and writes use the package's
`vaultPrivateFiles` with `openFile` and `sealFile`. Sealed files carry a UTF-8 JSON
vault file with `path` and `text` inside. When unlocked, search matches locally
and the query stays on the device. With the private layer locked, search covers
public and Friends content.

Call `visibilityMove` before asking the member to confirm. A Friends-to-private
move writes the sealed copy first, then removes the readable copy using its
original version. `cleanupPending` means the destination write succeeded and
removal requires review. A private-to-Friends copy discloses its contents to
the vault service and friends. Publication starts with `publishPlan`, which
previews the changes. The member-facing confirmation and publishing flows can
use these operations when connected.

From the repo root, run `npm --prefix app test` after `npm ci --prefix app`.
Tests cover the sample store, version conflicts, request routing and a synthetic
keys fixture. Live sign-in, the account app's unlock screens, and publishing
await app integration and live verification. Kept versions in the service
adapter currently cover private files. The local source awaits the decision
about the local bridge.

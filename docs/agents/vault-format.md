# Vault folder format: agent reference

Human guide: [docs/vault-format.md](../vault-format.md). Design and what comes next: [plans/vault.md](../../plans/vault.md).

## Purpose and boundary

[vault/node.mjs](../../vault/node.mjs) reads and writes a vault folder as four kinds of nodes (block, channel, entity, source) and derives evidence edges from their content. It is pure: callers pass `{ path, text }` pairs and write what they get back. It does no I/O, indexing, sync or publishing, and it holds no inference: agent conclusions live in ohm-cortex, which refers to blocks by ID.

**Implemented and unit-tested:** the format, round-trips, vault-wide checks and evidence ([test/node.test.mjs](../../test/node.test.mjs)). **Not built:** sync roots (`.vault/config.json`), `.vault/index.sqlite`, the cortex vault contract, the MCP tools and service storage for non-post blocks. The service, `syncFolder` and publishing still handle posts only.

## Schemas

[lexicons/com/ohmmmm/vault/](../../lexicons/com/ohmmmm/vault/): `block`, `channel`, `entity`, `source`, all `key: tid`. They describe file contents; nothing is written to a PDS. A test pins each lexicon's property list to `BLOCK_FIELDS`, `CHANNEL_FIELDS`, `ENTITY_FIELDS` and `SOURCE_FIELDS` and its known values to the exported enums. Change both together. `com.ohmmmm.post` is unchanged and remains fixed (AGENTS.md rule 2).

## Paths

| Path | Node | Notes |
| --- | --- | --- |
| `<folders>/<name>.md` | block | `home` = folders joined by `/` (`''` at the vault's top). `slug` = `slug` property or `slugOf(name)` |
| `<folders>/_channel.md` | channel | `path` = folders. Body = description. Not valid at the vault's top |
| `_entities/<kind>/<name>.md` | entity | `kind` comes from the folder: `person`, `work`, `place`, `org` |
| `_sources/<id>/source.json` | source | Folder name is the ID. Other files in that folder (extracted text, original) are not nodes |
| any segment starting `.`, other `_` paths and files, non-`.md` files | none | `readNode` returns `null`. Attachments such as `churn.sql` are reached through embeds |

## Contracts

- `readNode(path, text) -> { node, problems } | null`. Problems are sentences for the author; a node is still returned where possible. Unknown properties are kept in `node.properties`.
- `nodeFile(node) -> { path, text }`. It throws `VaultProblem` for a node it cannot write. Invariant: `readNode(nodeFile(n).path, nodeFile(n).text).node` deep-equals `n` for any node `readNode` produced. `kind` is written only when it was given or differs from `inferKind(body)`; `slug` only when it was given or differs from the file name.
- **Posts.** A file with `kind: post`, or with no `kind` and a `visibility` property, is read through `filePost` and written through `postFile` ([vault/file.mjs](../../vault/file.mjs)). `node.post` is the unchanged post object, so `postVersion` and `syncFolder` behave as before. `channels` is stored as an ordinary post property; the home channel is the label/sublabel folder; posts stay at most two folders deep.
- **IDs** are `newNodeId()` (= `newPostId`, 13-character TID). A node without one is keyed `block:<path>` / `channel:<path>` until given one. `nodeKey(node)` gives `block:<id>`, `channel:<id|path>`, `entity:<id>` or `source:<id>`.
- `originKind(origin)` returns `local` (`/`, `~/`, `C:\`), `drive` (`gdrive:` or `/Library/CloudStorage/GoogleDrive-`), `web`, `atproto`, or `null` (refused).
- `readVault(files) -> { blocks, channels, entities, sources, problems: [{path, problems}], items(channelPath) }`.
  - Every folder that holds a block or channel, and each folder above it, is a channel; those without `_channel.md` have `implicit: true`.
  - It reports duplicate IDs, duplicate block slugs (an ambiguous `[[slug]]`), `channels` naming no folder, and `from` naming no source.
  - `items` lists the channel's `order` first, then the remaining child channels and blocks newest first (`created`, then ID).
- `evidence(vault) -> [{ kind, from, to, at }]`, with kinds `contains`, `links`, `embeds`, `mentions`, `from` and `quotes`.
  - `at` is the line number counted from the start of the body (after the frontmatter), or the property it came from (`folder`, `channels`, `connect`, `from`, `excerpt`).
  - Targets are node keys, or `url:`, `at:`, `file:<name>`, or `missing:<as written>`.
  - Fenced code and inline code spans are skipped, and so are e-mail addresses.
  - `[[x]]` resolves against block slug, path, file name and title, then entity slug, name and aliases.

## Use

```js
import { readVault, evidence, nodeFile } from './vault/node.mjs';
const vault = readVault(files);            // files: [{ path, text }] relative to the vault root
const edges = evidence(vault);
const { path, text } = nodeFile({ ...vault.blocks[0], channels: ['reading'] });
```

## Verification

From the repository root: `node --test test/node.test.mjs`, then `npm test` for the whole suite (the post-file tests prove nothing about posts changed).

## Maintenance

When a field changes, update the lexicon, the `*_FIELDS` constant, the reader and writer in `node.mjs`, both guides, and the test. Keep evidence free of model output; anything inferred belongs in ohm-cortex.

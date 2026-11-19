# Vault folder format: agent reference

Human guide: [docs/vault-format.md](../vault-format.md). Design and what comes next: [plans/vault.md](../../plans/vault.md).

## Purpose and boundary

[vault/node.mjs](../../vault/node.mjs) reads and writes a vault folder as four kinds of nodes (block, channel, entity, source) and derives evidence edges from their content. It is pure: callers pass `{ path, text }` pairs and write what they get back. It does no I/O, indexing, sync or publishing, and it holds no inference: agent conclusions live in ohm-cortex, which refers to blocks by ID.

**Implemented and tested:** the format, round-trips, vault-wide checks and evidence ([test/node.test.mjs](../../test/node.test.mjs)); read-only roots and the index ([test/indexer.test.mjs](../../test/indexer.test.mjs), real temporary folders and node:sqlite). **Not built:** two-way roots, the cortex vault contract, the MCP tools, and service storage for non-post blocks. The service, `syncFolder` and publishing still handle posts only.

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

## Roots and the index

[vault/roots.mjs](../../vault/roots.mjs): `readConfig(json, { vault, home }) -> { roots, problems }` for `.vault/config.json` (`CONFIG`).
- Each root has `name`, an absolute `path` (`~/` expanded), `mode`, `channel` (default: the name), `include` and `exclude` globs (`globTest`), and `retain` (default `reference` for a Drive path, otherwise `text`).
- The canonical root is the vault folder itself, named `vault` (`CANONICAL`). It is implicit, and that name is reserved.
- `mode` is `read` only. `two-way` is refused with a message saying it is not built.
- A root may not be the vault itself, be inside it, or contain it. A bad entry is dropped with a problem; the other entries still apply.

[vault/indexer.mjs](../../vault/indexer.mjs). Node only (fs, `node:sqlite` passed in as `DatabaseSync`).
- `openIndex(vault, { DatabaseSync })` opens `.vault/index.sqlite` (`INDEX`).
  - A different `INDEX_VERSION` drops every table and recreates the schema.
  - An unreadable file is renamed `index.sqlite.damaged-<ms>` and recreated.
  - The index is derived data only and never the sole copy of anything.
- `scan({ vault, db, home })` walks the vault (excluding `.`-prefixed entries and `node_modules`, never following symlinks) and each root (by its `takes(relative)`).
  - **Stamps:** a file is re-read only when its stamp `ino:size:mtimeMs:ctimeMs` changes.
  - **Reading:** `reference` roots are never opened (`hash` null). Other files are read and addressed with `blobCid` (CIDv1 raw SHA-256). A `full` root's bytes are copied to `.vault/cache/<cid>` atomically.
  - **Kept text:** in the vault, only `.md` text. In a `text` or `full` root, any `TEXT_ENDINGS` file.
  - **Moves:** a file is moved when it vanishes from one path and appears at another in the same root with the same hash, or the same inode and size.
  - **Unavailable roots:** an unreadable root keeps its rows and adds a problem. A root removed from the configuration has its rows deleted.
  - **One transaction:** nodes, edges, terms and problems are rebuilt from the `files` table in the same transaction.
  - **Report:** `{ roots[{name,path,files,available}], added, changed, removed, moved, unchanged, opened, cached, problems[{root,path,problems}], nodes, edges }`.
- How root files become nodes:
  - A root's `.md` with kept text is read through `readNode` at `<channel>/<relative>`, and given `origin` = its absolute path when it has none.
  - Any other root file becomes a block. Its `kind` is `code` for `CODE_ENDINGS`, `media` for image, video and audio, and `file` otherwise. Its `slug` is `<name>-<ending>`, its `title` is the file name, and its `origin` is the absolute path.
  - Keys follow `nodeKey`, so a block without an ID is `block:<path>` (the virtual path for root files).
- `inspect(db, ref)` looks a node up by key, then slug (blocks first), then path or file. It returns `{ key, node, root, origin{where,kind}, file{root,path,abs,size,mtime,hash,cached,seen}, out[], in[] }`.
- `search(db, query, { limit })`: `words()` lowercases, splits on non-letters and digits, and splits Korean, Japanese and Chinese runs into character bigrams. Results are ranked by the number of distinct matched terms, then summed weight (title, slug, aliases and tags weigh 2; body and a root's text 1). This does not use FTS5, because Node 22.12's SQLite lacks it.
- `summary(db)` gives counts by table and by root, plus the last scan time.

Tables: `meta`, `files(root,path,…)`, `nodes(key,…,node JSON)`, `edges`, `terms`, `problems`. Never write to them outside `scan`.

CLI: [scripts/vault.mjs](../../scripts/vault.mjs), run as `ohm vault init|index|status|inspect REF|search WORDS [--vault DIR] [--limit N]`. It defaults to `OHM_VAULT_FOLDER`, then the current folder. It prints JSON and exits 1 with a sentence on failure. Without `node:sqlite` it re-runs itself with `--experimental-sqlite`. It makes no network calls.

## Use

```js
import { readVault, evidence, nodeFile } from './vault/node.mjs';
const vault = readVault(files);            // files: [{ path, text }] relative to the vault root
const edges = evidence(vault);
const { path, text } = nodeFile({ ...vault.blocks[0], channels: ['reading'] });
```

## Verification

From the repository root: `node --test test/node.test.mjs`, `node --experimental-sqlite --test test/indexer.test.mjs`, then `npm test` for the whole suite (the post-file tests prove nothing about posts changed). Not verified: a real Google Drive mount; the reference-only path is tested with an unreadable file instead.

## Maintenance

When a field changes, update the lexicon, the `*_FIELDS` constant, the reader and writer in `node.mjs`, both guides, and the test. Keep evidence free of model output; anything inferred belongs in ohm-cortex.

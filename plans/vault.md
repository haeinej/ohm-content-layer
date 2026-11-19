# ohm-vault: the canonical store

Written 19 November 2026. A proposal. It takes `personal-brain.md` (blocks, channels, sources, entities, evidence vs inference) and narrows it to one repository with one job: **ohm-vault holds what you know and made, and nothing about you as a person or an agent's memory of you.** That is ohm-cortex's job, at `~/development/cortex`.

## The split

| | ohm-vault | ohm-cortex |
| --- | --- | --- |
| Holds | blocks, channels, sources, entities, published posts | identity, memories, notes, skills, tools, working memory, journal |
| Edges | **evidence** only: what the content itself shows | **inference**: cortex nodes pointing down at vault blocks (`grounds`, `observes`, `learned`, `acts`) |
| Talks to the other through | the vault contract cortex already defines in `cortex/src/vault.mjs`: `shape()`, `read(id)`, `exists(ids)`, `changes(cursor)`, `profile()`, `search()` | block IDs only |

The vault never imports cortex, and cortex never imports the vault. The contract is the boundary.

## Format on disk

The vault is a folder. It opens in Obsidian as-is and is readable by cortex's existing folder vault.

```
~/Vault/
  writing/                     # a folder is a channel (Are.na: a block's "home" channel)
    _channel.md                # the channel itself: id, description, order of items
    trap-of-independency.md    # a block
    collisions/                # a channel inside a channel
      _channel.md
      ep-01.md
  analytics/
    _channel.md
    churn-query.md             # a block about a file …
    churn.sql                  # … and the file, kept beside it (or left where it is: see origin)
  _sources/<id>/source.json    # what came in from outside, + extracted.md, + original.<ext>
  _entities/<kind>/<slug>.md   # people, works, places, orgs
  .vault/
    config.json                # sync roots (below)
    index.sqlite               # derived: nodes, edges, FTS, file stats, hashes. Delete it and it rebuilds
    cache/<cid>                # bytes fetched from elsewhere, by content address
    sync.json                  # last-synced path + version per block (today's .ohm/sync.json)
```

`_` and `.` folders are already skipped by `vault/file.mjs`, so Obsidian sees blocks and channels and nothing else.

### A block

```markdown
---
id: 3m4k7xq2a9bcd
kind: code
title: Q3 churn query
channels: [analytics, sql-snippets]
origin: ~/work/queries/churn.sql
tags: [retention]
---

What I used for the board review. Joins on `account_id`, not `user_id`, because of the merge.

![[churn.sql]]
```

- **`kind`**: `text` (your writing), `excerpt`, `link`, `media`, `file`, `code`, `post`. The same idea as Are.na's Text / Link / Image / Attachment, plus `code` and `excerpt`.
- **`channels`**: every channel the block is in, besides its folder. Many-to-many, as on Are.na; the folder is only the first one, and gives the published address.
- **`from`** and **`excerpt`**: the source a block was captured from, and the exact words kept from it.
- A channel's `_channel.md` holds its `title`, `kind`, `order` and `site`; its body is the description.
- **`origin`**: where the original lives when it is not this file. One of: a local path, a Google Drive path (`gdrive:My Drive/…` or the mounted path), a URL, an `at://` URI.
- Links are `[[slug]]` / `[[slug|words]]`, mentions `@handle`, embeds `![[file]]`: the same syntax ohm-ux and Obsidian use.

### Why cache info is not in the frontmatter

Decided 19 November 2026: one hidden index.

What a person reads and edits goes in the file: `origin`, `channels`, `kind`, `title`. What only a machine needs — size, mtime, content hash, CID, `fetchedAt`, whether Drive has the bytes locally — goes in `.vault/index.sqlite`, one database for every block.

- **For:** a file changes only when you change it, and the folder holds only what you wrote. Writing cache data into files would rewrite every block on every scan, turning every sync into a conflict and every git diff into noise. If the index is deleted or corrupted, a rescan rebuilds it and nothing is lost.
- **Against:** opening a note does not show its cache info. It is shown instead by `vault inspect <block>`, by the MCP `vault_read` tool, and in the editor's side panel next to the open block.

The one exception is a source: `_sources/<id>/source.json` is machine-written anyway, so its snapshot record (`hash`, `cid`, `retain`, `capturedAt`) lives there, as in `personal-brain.md`.

## What Markdown can hold

CommonMark has no notion of SQL or code; it has **fenced code blocks** with a language tag, and that is enough:

````markdown
```sql
select account_id, count(*) from events group by 1;
```
````

Everything renders as text with syntax colouring, nothing runs. On top of CommonMark, Obsidian (and so the vault) understands:

| Syntax | What | Vault treats it as |
| --- | --- | --- |
| ` ```sql `, ` ```python `, any language | code | text of the block; `kind: code` when the block is mostly one fence |
| ` ```mermaid ` | a diagram, rendered | text |
| `$…$`, `$$…$$` | math | text |
| `> [!note]` | a callout | text |
| `[[slug]]`, `[[slug\|words]]` | link | **`links` evidence** |
| `![[file.ext]]` | embed of a file or another note | **`embeds` evidence**, and the file is an attachment |
| `#tag` | tag | indexed, not an edge |
| ` ```dataview ` | an Obsidian plugin query | text (the vault does not run plugins) |

So: write SQL or code inside a block as a fence. When the code is its own file (`churn.sql`, `model.py`, `data.csv`, a PDF), keep the file and give it a block that embeds it, so it can sit in channels, carry notes and be linked. This is Are.na's attachment block.

## Sync roots: local paths and Drive

`.vault/config.json` names the other places the vault reads from. Each root is a folder on this machine. The vault's own folder is always the canonical root, named `vault`, and is not listed: the service, when used, is a mirror of it, not the other way round.

```json
{
  "roots": [
    { "name": "drive",   "path": "~/Library/CloudStorage/GoogleDrive-<account>/My Drive/Research", "channel": "research" },
    { "name": "queries", "path": "~/work/queries", "include": ["*.sql", "*.md"], "retain": "full" }
  ]
}
```

- **`mode`**: `read` (the default and, for now, the only one). The vault indexes the files and makes a block for each, with `origin` set to its path. It never writes there.
- **`two-way`** (planned, refused until built): today's `syncFolder` rules, with an `id` property, version hashes, conflicts left beside the file and nothing deleted on its own, for a folder such as an Obsidian vault.
- **`retain`**: `reference` (path, size and dates only; the file is never opened, so it has no hash), `text` (its words kept for search), `full` (its bytes cached in `.vault/cache/<cid>`). Drive defaults to `reference`, because Google Drive for desktop keeps files online-only and reading one downloads it.
- **Change detection** is cortex's approach: a stat stamp (`ino:size:mtime:ctime`) first, a content address only when the stamp moved. A file that moves keeps being recognised, by the same hash or the same inode and size.

Google Drive through the desktop mount needs no API key and no OAuth. A Drive API connector (by file ID, for machines without the mount) can come later as another root kind.

## Lexicons

| NSID | Status | Where it lives |
| --- | --- | --- |
| `com.ohmmmm.post` | unchanged, fixed | PDS, when a block is published |
| `com.ohmmmm.vault.block` | new | the folder; validated by the lexicon, never written to a PDS |
| `com.ohmmmm.vault.channel` | new | `_channel.md` |
| `com.ohmmmm.vault.source` | new | `_sources/<id>/source.json` |
| `com.ohmmmm.vault.entity` | new | `_entities/` |

These replace the `com.ohmmmm.brain.*` names in `personal-brain.md` (namespace decided 19 November 2026). The files are Markdown; the lexicons describe the frontmatter, so one validator serves the folder, the MCP tools and the service.

## Steps

1. ~~Rename to ohm-vault, remove the cortex MVP and the zombies.~~ Done.
2. ~~Lexicons for block, channel, source, entity, and the folder format.~~ Done: `lexicons/com/ohmmmm/vault/`, `vault/node.mjs`, [human guide](../docs/vault-format.md), [agent reference](../docs/agents/vault-format.md). Posts read as `kind: post` blocks with the same IDs, through the unchanged post code.
3. ~~`.vault/config.json` roots and the indexer.~~ Done: read-only roots (`vault/roots.mjs`), `.vault/index.sqlite` (`vault/indexer.mjs`), `ohm vault init|index|status|inspect|search`. The vault folder is the implicit canonical root and is not listed; `two-way` roots are refused until built. A `reference` root is never opened, so it has no hash. Search uses a word table, not FTS5 (absent from Node 22.12's SQLite).
4. ~~Implement cortex's vault contract over the index.~~ Done: `vault/cortex.mjs` (read-only, no database, compatible with cortex's folder reader: ids, channels, cursor, hash), opened by ohm-cortex's new `module` vault kind (`cortex vault connect ~/Vault --module …/vault/cortex.mjs`, ohm-cortex branch `vault-module`).
   - Also done: provenance. `.vault/journal.jsonl` (append-only, not derived), `ohm vault add` (files and addresses, with `origin` and `by`), recognising dropped files by content address and by macOS's download record, and `ohm vault hook` for Claude Code's PostToolUse.
   - Next for the editor: a local `ohm vault serve` so the browser editor writes the folder directly; the vault service stores editor-made blocks only as a working copy until they sync, using the same `{ path, text, id, version }` and the journal's `via: editor`.
5. Local MCP: `vault_search`, `vault_read`, `vault_neighbors`, `vault_capture`, `vault_collect`.
6. ohm-ux graph reads the index instead of sample data.

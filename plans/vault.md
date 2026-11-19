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
- **`origin`**: where the original lives when it is not this file. One of: a local path, a Google Drive path (`gdrive:My Drive/…` or the mounted path), a URL, an `at://` URI.
- Links are `[[slug]]` / `[[slug|words]]`, mentions `@handle`, embeds `![[file]]`: the same syntax ohm-ux and Obsidian use.

### Why cache info is not in the frontmatter

What a person reads and edits goes in the file: `origin`, `channels`, `kind`, `title`. What only a machine needs — size, mtime, content hash, CID, `fetchedAt`, whether Drive has the bytes locally — goes in `.vault/index.sqlite`. Writing it into the file would change every block on every scan, which turns every sync into a conflict and every git diff into noise. `vault inspect <block>` (and the MCP `vault_read` tool) shows both together, so the information is never hidden, only kept where it does not churn.

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

`.vault/config.json` names the places the vault reads from. Each root is a folder on this machine.

```json
{
  "roots": [
    { "name": "main",     "path": "~/Vault",                                                  "mode": "canonical" },
    { "name": "obsidian", "path": "~/Documents/Obsidian/Notes",                               "mode": "two-way",  "channel": "notes" },
    { "name": "drive",    "path": "~/Library/CloudStorage/GoogleDrive-<account>/My Drive/Research", "mode": "read", "retain": "reference", "channel": "research" },
    { "name": "queries",  "path": "~/work/queries", "include": ["*.sql", "*.md"],             "mode": "read", "retain": "full" }
  ]
}
```

- **`canonical`**: the vault itself. The service, when used, is a mirror of it, not the other way round.
- **`two-way`**: today's `syncFolder` rules: `id` property, version hashes, conflicts left beside the file, never deletes on its own.
- **`read`**: the vault indexes the files and makes a block for each, with `origin` set to its path. It never writes there.
- **`retain`**: `reference` (path and hash only), `text` (extracted text cached), `full` (bytes cached in `.vault/cache`). Drive defaults to `reference`, because Google Drive for desktop keeps files online-only and reading one downloads it.
- **Change detection** is cortex's approach: a stat stamp (`ino:size:mtime`) first, a SHA-256 only when the stamp moved. A moved file with the same hash keeps its block.

Google Drive through the desktop mount needs no API key and no OAuth. A Drive API connector (by file ID, for machines without the mount) can come later as another root kind.

## Lexicons

| NSID | Status | Where it lives |
| --- | --- | --- |
| `com.ohmmmm.post` | unchanged, fixed | PDS, when a block is published |
| `com.ohmmmm.vault.block` | new | the folder; validated by the lexicon, never written to a PDS |
| `com.ohmmmm.vault.channel` | new | `_channel.md` |
| `com.ohmmmm.vault.source` | new | `_sources/<id>/source.json` |
| `com.ohmmmm.vault.entity` | new | `_entities/` |

These replace the `com.ohmmmm.brain.*` names in `personal-brain.md`. The files are Markdown; the lexicons describe the frontmatter, so one validator serves the folder, the MCP tools and the service.

## Steps

1. Rename to ohm-vault, remove the cortex MVP and the zombies (separate change, no new behaviour).
2. Lexicons for block, channel, source, entity; extend `vault/file.mjs` to read and write them. Today's posts read as `kind: post` blocks with the same IDs, labels as channels.
3. `.vault/config.json` roots and the indexer (`index.sqlite`: nodes, evidence edges, FTS, stats).
4. Implement cortex's vault contract over the index, so `cortex vault connect ~/Vault` works unchanged.
5. Local MCP: `vault_search`, `vault_read`, `vault_neighbors`, `vault_capture`, `vault_collect`.
6. ohm-ux graph reads the index instead of sample data.

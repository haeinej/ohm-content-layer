# Your vault as a folder

Until now a vault held one kind of thing: posts, each filed under one label. That is enough for a website, but not for thinking. An article you saved, the passage you kept from it, a SQL query, a PDF on Google Drive and your own half-formed idea all had to be "a post", and each could sit in only one place.

The vault now reads a folder the way Are.na arranges things. A **block** is one unit of thought. A **channel** is an ordered collection, and a block can be in as many channels as you like. **Sources** keep what came in from outside as it was, and **entities** are the people, works, places and organisations many blocks are about. Your existing posts are blocks too, so nothing you already have changes.

This guide covers the file format, the other folders a vault can read, and its index. The agent tools come next; see [the plan](../plans/vault.md).

## What you need, and why

| You need | Why |
| --- | --- |
| A folder | The vault is the folder. Every block, channel and entity is a Markdown file in it, so it opens in Obsidian, any editor, or Finder, and is yours without ohm. |
| Node 22 or newer | The index is a SQLite database, which Node has built in. Before Node 22.13 the command turns it on for itself. |
| Nothing else | No account and no service are needed to write, read or index the vault. Publishing a block as a post still goes through the vault service, as before. |

## A small vault

```
Vault/
  writing/
    _channel.md                 the channel "writing": its title and order
    trap-of-independency.md     a block (here, a post you published)
    collisions/                 a channel inside "writing"
      ep-01.md
  analytics/
    churn-query.md              a block about a query
    churn.sql                   the query itself
  _entities/person/ada-lovelace.md
  _sources/<id>/source.json     an article you captured
```

A block's folder is its **home channel**. To put it in more channels, list them:

```markdown
---
kind: code
title: Q3 churn query
channels: [sql-snippets]
origin: ~/work/queries/churn.sql
---

What I used for the board review. It joins on `account_id`, not `user_id`, because of the merge.

![[churn.sql]]
```

- **kind** says what the block is: `text`, `excerpt`, `link`, `media`, `file`, `code` or `post`. You rarely write it. A block that is one fenced code block is `code`, one embedded file is `file` or `media`, one address is a `link`, and anything else is `text`. Write it when you mean something else, as above.
- **origin** is where the original lives, when it is not this file: a path on your computer (`~/…` or `/…`), a Google Drive path (`gdrive:My Drive/…`, or the folder Google Drive for desktop mounts), a web address, or an AT URI.
- **from** names the source a block was captured from, and **excerpt** holds the exact words you kept: `excerpt: {"quote": "the words"}`.
- **by**, **status** and **intent** say who made a block (`me` or `agent:<name>`), whether it is `proposed`, `kept` or `archived`, and who you mean it for when published.

The file stays readable: SQL, Python or any other code goes in a fenced block with its language, and Obsidian's `[[links]]`, `![[embeds]]`, callouts, Mermaid diagrams and math all keep working. The vault never runs code.

## How things connect

The vault draws a connection only where your content shows one, and says where it found it:

| Connection | Comes from |
| --- | --- |
| A channel contains a block | the block's folder, or its `channels` list |
| A channel contains a channel | a folder inside a folder |
| A block links to something | `[[slug]]`, `[[slug|words]]`, a `[words](https://…)` link, or a post's `connect` list |
| A block embeds something | `![[file.sql]]` or `![[another-block]]` |
| A block mentions an entity | `@handle`, matched to an entity's aliases |
| A block is from, or quotes, a source | its `from` and `excerpt` |

Anything inside code is never a connection, so an example of `[[a link]]` in a code block stays an example. A link to something the vault does not have is kept as missing rather than dropped. Conclusions an agent draws about your blocks are not connections here: they belong to ohm-cortex, which points at your blocks without changing them.

## Reading other folders: Google Drive, Obsidian, a code folder

Some of what you know is not in the vault folder: papers on Google Drive, an Obsidian vault you already keep, a folder of SQL you run at work. The vault can read those folders where they are, without copying them in or ever writing to them. Each one is a **root**, and its files appear as blocks in a channel of their own.

Start a vault's configuration once, from inside the vault folder:

```sh
npx github:haeinej/ohm-vault vault init
```

Then name the folders in `.vault/config.json`:

```json
{
  "roots": [
    { "name": "research", "path": "~/Library/CloudStorage/GoogleDrive-you@example.com/My Drive/Research", "include": ["**/*.pdf", "**/*.md"] },
    { "name": "notes", "path": "~/Documents/Obsidian/Notes", "channel": "reading/notes" },
    { "name": "queries", "path": "~/work/queries", "include": ["*.sql"], "retain": "full" }
  ]
}
```

| Setting | What it changes |
| --- | --- |
| `name` | What the root is called. Lowercase letters, digits and hyphens. |
| `path` | The folder, absolute or starting `~/`. It cannot be the vault itself, or a folder inside or around it. |
| `channel` | The channel its files appear in. The root's name, unless you say otherwise. Folders inside the root become channels inside that one. |
| `include`, `exclude` | Which files to take, as patterns: `*.sql` matches by name anywhere, `docs/*.md` only in that folder, `**` any depth. Everything, unless you say otherwise. |
| `retain` | How much the vault keeps. `reference`: where the file is, its size and date, and nothing more; the file is never opened. `text`: its words too, so search finds it. `full`: a copy of its bytes in `.vault/cache` as well. |

A Google Drive folder keeps only references unless you say otherwise. Google Drive for desktop keeps many files online, and opening one makes Drive download it; a reference never opens the file.

Every file a root takes becomes a block whose `origin` is the file's own path. A Markdown file is read as the block it is, with its links and properties. A `.sql`, `.py` or other code file is a `code` block, an image or video is `media`, and anything else is a `file`. A root is read only: two-way sync with a folder like Obsidian is not built yet.

## The index

```sh
npx github:haeinej/ohm-vault vault index           # bring the index up to date
npx github:haeinej/ohm-vault vault search 서울 rain
npx github:haeinej/ohm-vault vault inspect churn-query
npx github:haeinej/ohm-vault vault status
```

`vault index` reads your vault folder and every root, and keeps what it found in `.vault/index.sqlite`: every block, channel, entity and source, every connection, the words for search, and each file's size, date and content address. The first time, it reads everything. After that it reads only files whose size or dates changed, so an unchanged vault takes as long as listing its folders. It says what was added, changed, moved and removed. A file that was renamed or moved is recognised as the same file.

`vault inspect` shows one block with everything known about it, including what is not in its file: where its original is, its size, when it last changed, its content address, whether a copy is cached, and what links to it.

`vault search` finds blocks by their words. Words in a title, name or tag count more than words in the text. Korean, Japanese and Chinese are found without spaces.

If Google Drive is not running, its root cannot be read. The index keeps what it knew about it and says so, rather than treating its files as removed. The index can always be deleted: the next `vault index` makes it again from your files.

## What happens to your files

The vault reads your files and writes them back exactly as it found them, so your folder only changes when you change something. Size, dates and content addresses are not written into your files; they are in `.vault/index.sqlite`, which can always be rebuilt. Nothing is ever written in a root, and indexing never reaches the vault service or publishes anything.

When something cannot be read, the vault says so in a sentence and leaves the file as it is: a channel that is not a folder, two files with the same name, an origin it does not understand, a copied file that carries another file's ID.

A post stays a post. It keeps its label, its address and its visibility, and sync and publishing treat it exactly as before. Listing extra `channels` on it does not change where it is published.

[The agent reference](agents/vault-format.md) has the exact contracts.

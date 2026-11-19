# A personal brain: schemas and sync

Written 19 November 2026. A proposal, nothing here is built. It keeps the cortex and the vault as they are and adds a graph layer between them, so that ohm becomes a personal knowledge base that lives in a local folder, syncs when the owner says so, and is used through agents over MCP.

## Vocabulary

Each word means one thing, and belongs to one of three layers. A word from one layer is never used for a thing in another.

| Layer | Word | Means | Not |
| --- | --- | --- | --- |
| Thinking | **block** | One unit of thought: something you wrote, a passage you kept, a link, an image. Can sit in many channels | Not a paragraph in the editor |
| | **channel** | An ordered collection of blocks and other channels. A block can be in any number of them | Not a folder: nothing is in only one |
| | **evidence** | A connection the content itself shows: a channel contains a block, a block links, quotes, mentions or was captured from something. Checkable, rebuilt from files | Never written by a model |
| | **inference** | A conclusion the cortex drew from evidence, held as a cortex node that points at what it was drawn from | Never an edge between two blocks |
| | **source** | The original something came from, kept as captured | Not your words about it; those are a block |
| | **entity** | A person, work, place or organization that many blocks are about | Not an idea; an idea is a concept channel |
| Publishing | **post** | A block you published, as a `com.ohmmmm.post` record | Not anything unpublished |
| | **label**, **sublabel** | The section of your site a post sits in, and a group inside it | Not how you organize your thinking; that is channels |
| | **form** | What kind of object a post is, identified for you (`writing`, `note`, `image`...) | |
| Storage | **file**, **folder** | How the brain is kept on disk, and only that | Not a unit of thought, not a collection |
| | **attachment** | The bytes of an image, video, audio or file inside a block or post | |
| Cortex | **memory**, **note**, **skill** | What agents know about you; an agent's observation waiting to be settled; an approved method | |

Three words keep a second, narrower meaning elsewhere, and should not spread further:

- **block** is also a paragraph in the ohm-ux editor ("block handle"), as in Notion and Tiptap. That stays inside the editor. Agent tools, schemas and docs use block only for the unit of thought.
- **note** is both a post form (an untitled post) and a cortex observation. The vault code also calls posts notes in many comments and some names (`assembleRecord(note)`); that predates this vocabulary and is a candidate for its own cleanup.
- **collection** is AT Protocol's word for a record type (`com.ohmmmm.post` is a collection). Never use it for a channel.

A block becomes a post when published, through a release. A channel marked with `site` is shown on your site as a label or sublabel. That is the whole bridge between thinking and publishing.

## What is built today

| Piece | What it holds | Shape | Where |
| --- | --- | --- | --- |
| Post (`com.ohmmmm.post`) | Something published | Body, title, form, label, sublabel, `connect[]` (≤32 URIs), `source`, media | PDS; `lexicons/com/ohmmmm/post.json` |
| Vault | Working copy of every post at three visibilities | D1 `posts` table, versioned, CAS on `replaces` | `vault/`, `service/schema.sql` |
| Folder sync | The vault as Markdown + frontmatter, Obsidian-compatible | Two-way, never auto-deletes, conflicts left as `.from-ohm`, state in `.ohm/` | `vault/sync.mjs`, `vault/file.mjs` |
| Cortex | What agents know about *the owner* | Identity, `vault.md`, memories, working memory per agent, distill, notes → settle, skills needing approval, proposed tools, hooks for Claude Code and Codex, history | ohm-cortex (`~/development/cortex`), a folder. The `cortex/` MVP in this repository is retired: see [cortex-and-history.md](https://github.com/haeinej/ohm-cortex/blob/main/docs/journal-and-history.md) |
| MCP | `vault_*` tools here; `cortex_*` tools in ohm-cortex | Two-call confirm for anything that changes visibility or deletes | `mcp/` |
| Graph (mock) | You → cortex → channels → blocks → sources and entities | Evidence edges (contains, links, mentions, from) and inference edges (grounds, observes, learned, acts) | `ohm-ux/src/graph/model.ts`, sample data only |
| Workspace item (proposed) | Private draft separate from the post; kinds note/file/reference | Not deployed | `ohm-onboarding/lexicons/com/ohmmmm/workspace/item.json` |

## What is missing for a brain

1. **The vault is a tree.** A post sits in one label and one sublabel. Are.na's whole point is that a block lives in many channels at once.
2. **Everything is a post.** An imported tweet, a saved article and your own thought about it are the same kind of thing. A brain needs the original (what you captured) apart from your block (what you made of it).
3. **Connections are weak.** `connect[]` is a list of URIs with no kind and a 32 cap, and body `[[links]]` are only read. Worse, nothing separates what the content shows from what a model guessed.
4. **The cortex knows the owner, not the knowledge.** Memories are about preferences and projects. Nothing holds concepts, people or works that recur across blocks.
5. **The service is canonical.** Folder sync exists, but the working copy on ohm is the source of truth. "Syncs locally when I want to" means the folder is canonical and the service is an optional mirror.

## The model

Everything is a node in one knowledge graph: you, the cortex, channels, blocks, sources and entities. Four node kinds are new (source, block, channel, entity); all are private, never written to the PDS, and published only by projecting into a post.

There are two kinds of edge, and the whole design rests on keeping them apart:

```
            ┌──────────── inference (cortex) ────────────┐
            │  memory · note · skill · tool               │
            │     each points at what it was drawn from   │
            └──────┬──────────────┬───────────────┬───────┘
                   ▼              ▼               ▼
evidence:   channel ──contains──▶ block ──links──▶ block
                                   │  ──quotes/from──▶ source
                                   │  ──mentions──▶ entity
                                   └──released as──▶ com.ohmmmm.post (PDS)
```

- **Evidence is what the content shows.** It is never asserted by a model, so it needs no review: anyone can check it against the files, and the indexer rebuilds it from them.
- **Inference is what the cortex concludes.** A model never draws an edge between two blocks. It writes a cortex node (a memory, a note, a skill, a tool) whose edges point down at the evidence it was drawn from. Delete the inference and the evidence is untouched; the evidence never depends on a model having been right.
- **The model reasons in between at query time.** Paths through evidence ("these two blocks share a source and a channel") are found when asked, not stored. Only a conclusion worth keeping becomes a node.

### `com.ohmmmm.brain.source`: the original

What came in from outside, kept as it was. Re-syncing a connector updates its snapshot; it never edits your blocks.

| Field | |
| --- | --- |
| `id` | TID, immutable |
| `kind` | `page`, `post`, `file`, `image`, `video`, `audio`, `thread`, `book`, `other` |
| `uri` | Where it lives: URL, `at://`, `file://` |
| `platform` | `x`, `substack`, `arena`, `website`, `kindle`, `local`... |
| `platformId` | The platform's own ID, for dedupe on re-import |
| `title`, `author`, `publishedAt` | As the source said |
| `capturedAt` | When you took it in |
| `retain` | `reference` (metadata only), `text` (extracted Markdown), `full` (bytes too) |
| `snapshot` | `{ text: path, file: blobCid, hash, at }`, present per `retain` |
| `meta` | Anything else the connector found, kept losslessly |

Default `retain: text`. That is what makes the meta-layer work without hoarding: you can search and quote an article without keeping its bytes.

### `com.ohmmmm.brain.block`: your atom

The Are.na block. Small, yours, and the thing everything else points at.

| Field | |
| --- | --- |
| `id` | TID |
| `kind` | `text` (your writing), `excerpt` (a passage of a source), `link` (a source as a whole), `media`, `post` (an existing vault post) |
| `body` | Markdown. For `excerpt`, your note on it; the quoted words are in `excerpt` |
| `source` | Source ID, for excerpt/link/media |
| `excerpt` | `{ quote, prefix, suffix, position }`, a W3C-style text selector so it survives re-snapshot |
| `title` | Optional |
| `by` | `me` or `agent:<name>`; agent-made blocks start `status: proposed` |
| `status` | `proposed`, `kept`, `archived` |
| `createdAt`, `updatedAt`, `version` | Version is the existing `recordVersion` hash |
| `intent` | Publication intent: `private`, `friends`, `public`. Not access control (as in workspace.item) |

An existing vault post becomes a block of kind `post` with the same ID, so nothing re-keys.

### `com.ohmmmm.brain.channel`: a collection

Replaces label and sublabel as the way to organize, and is many-to-many.

| Field | |
| --- | --- |
| `id`, `slug`, `title`, `description` | |
| `kind` | `collection` (default), `concept` (a channel that *is* an idea), `inbox`, `import` (one per connector, e.g. "From X") |
| `items` | Ordered `[{ ref, addedAt, by, note? }]`, refs to blocks or channels |
| `site` | Optional `{ label, sublabel }`: this channel is a section of the public site. That is how labels survive |

Order lives in the channel, so the same block can be third in one channel and first in another.

### Evidence: edges the content shows

There is no connection record. Every evidence edge is read from something already in the files:

| Edge | From → to | Read from |
| --- | --- | --- |
| `contains` | channel → block or channel | `channel.items`: you put it there |
| `links` | block → block | `[[slug]]` or an `at://` link in the body; `connect[]` on a post |
| `quotes` | block → source | `block.excerpt`: the exact words, with a selector into the source's text |
| `from` | block → source | `block.source`: captured from it |
| `mentions` | block → entity | `@handle`, or a name matched to an entity's `aliases` |
| `released` | block → post | a release record |

Each edge keeps where it was read: the span in the body, the channel item, the excerpt. That is the evidence. If you want to say *how* two blocks relate ("this contradicts that"), you write it: in a block's body, next to a link. Your words are evidence too, because they are in the content.

### `com.ohmmmm.brain.entity`: what recurs

People, works, places, organizations: things that are not your thoughts but that many blocks are about.

| Field | |
| --- | --- |
| `id`, `kind` (`person`, `work`, `place`, `org`), `name`, `aliases[]` | |
| `uri` | A DID, a Wikidata ID, a URL: whatever identifies it outside |
| `body` | Your notes on it |

Ideas are not entities; they are `concept` channels, because an idea is something you collect toward. That keeps one place for "what I think about X".

### The cortex: the inference layer

The cortex already works this way for knowledge about you: an agent records a note, and it becomes a memory only once evidence from two or more sessions supports it. The change is to let it infer about your knowledge too, using nodes as evidence alongside sessions.

| Cortex node | What it is | Points at, and how | Becomes real when |
| --- | --- | --- | --- |
| **note** | One observation, waiting | `observes`: the node or nodes it was about | Settled: dropped, kept, or folded into a memory |
| **memory** | A settled conclusion: about you (`person`, `preference`, `project`) or about your knowledge (`insight`: a pattern across nodes) | `grounds`: every node it was drawn from | An insight needs at least two distinct evidence nodes, and each must still exist; a preference needs two sessions, as now. Stated outranks inferred, as now |
| **skill** | A method for a kind of task | `learned`: the channels and blocks where you did it that way | Three consistent repetitions, or you say so; then your approval |
| **tool** | A capability: a deterministic lookup or another system | `acts`: what it reads or writes (a connector → its import channel and sources) | Built and enabled by ohm, never by an agent |

So the layers connect like this: **evidence joins your content to itself; the cortex sits above it and joins to content only through `grounds`, `observes`, `learned` and `acts`.** Memories link to each other only through shared evidence, not directly. A skill may name the memories that led to it, which is the one edge inside the cortex.

When evidence a memory rests on is deleted or changed, the memory is marked stale and waits to be settled again, the same way a contradicting note does now.

### Unchanged

- **`com.ohmmmm.post`** stays the publication schema and is never edited. A `release` record (from the onboarding plan) maps a block or channel revision to the post it was published as.

## Storage: the folder is the brain

```
~/Brain/
  blocks/<slug>.md            # frontmatter: id, kind, source, excerpt, by, status, intent, channels
  channels/<slug>.md          # frontmatter: id, kind, site; body = description; items as an ordered list of [[links]]
  entities/<kind>/<slug>.md
  sources/<id>/source.json    # + extracted.md, + original.<ext> when retain: full
  cortex/<name>.md            # memoryFile() already writes this format
  .brain/index.sqlite         # derived, rebuildable: nodes, edges, FTS5, embeddings
  .ohm/                       # sync state, as today
```

- **Markdown for what you write, JSON for sources.** Blocks and channels open in Obsidian. There is no edge file: evidence is read from the content, and inferences live in `cortex/`, each with its `grounds` list in its frontmatter.
- **The index is disposable.** Delete `.brain/` and it rebuilds from files. Search, neighbors and paths read it; nothing writes to it but the indexer.
- **Sync stays opt-in.** `ohm brain sync` runs the existing `syncFolder` rules (id property, version hashes, conflicts beside the file, never auto-delete) against the service, extended to the new kinds. Without it, the brain is entirely local.

## Agents

A local MCP server reads the folder and its index directly, so any MCP agent can use the brain offline with no ohm account. The service-backed `vault_*` tools stay for publishing.

| Tool | Does |
| --- | --- |
| `brain_capture` | URL, text or file in → a source (per `retain`) and a block in the inbox channel |
| `brain_search` | Full-text plus embeddings over blocks, sources' text, channels, entities |
| `brain_read` | One node with its channels, evidence and source, and the cortex nodes that rest on it |
| `brain_neighbors` | The graph around a node, by depth and edge kind; evidence and inference kept apart in the answer |
| `brain_path` | The evidence paths between two nodes: what the model reasons over before it concludes anything |
| `brain_collect` | Add or reorder items in a channel (your act, so it is evidence) |
| `cortex_note`, `cortex_settle` | As now, with `observes` and `grounds` able to name nodes as well as sessions |
| `brain_import` | Run a connector (X, Substack, Are.na, website, the existing vault) as a preview, then with a value from the preview |

Agent-made content is always `by: agent:<name>` and `status: proposed`. Removing anything or changing `intent` keeps the two-call confirm the vault tools use.

## From what exists to this

1. **Lexicons and file format.** Write the four node schemas (source, block, channel, entity) and extend `vault/file.mjs` to read and write blocks, channels and entities. No service change.
2. **Indexer and local MCP.** `.brain/index.sqlite` built from the folder; `brain_search`, `brain_read`, `brain_neighbors`. This is the first point where an agent can use it.
3. **Migrate the vault.** Each post → a `post` block with the same ID; each label → a channel with `site.label`, each sublabel → a channel inside it with `site.sublabel`; `connect[]` stays as `links` evidence; `source` → a source record. Publishing still reads posts, so the site does not change.
4. **Capture and connectors.** `brain_capture`, then the existing mirror and importer emit sources and blocks into `import` channels instead of posts.
5. **Cortex over nodes.** Add the `insight` memory kind and let `notes`/`grounds` name nodes; mark memories stale when their evidence changes.
6. **Graph view.** Done on sample data in `ohm-ux/src/graph/model.ts`: evidence grey, inference green. Next is reading the index instead of the sample.
7. **Service sync for the new kinds**, last, and only if wanted.

## Open questions

- **Muse.** Which agent is meant, and does it speak MCP? If it is the Muse canvas app, the brain could also export a channel as a board.
- **How many nodes make an insight.** Proposed: two distinct evidence nodes, from at least two channels or sources, so one essay cannot ground a pattern on its own.
- **Embeddings.** Local model (private, slower) or an API (needs the text to leave the machine). Proposed: local by default.
- **Entities.** Worth having from the start, or wait until concept channels prove too little?

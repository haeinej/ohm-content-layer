// Synthetic data for the wireframe. No real person, no real records.

import { BLOCK_KINDS, newNodeId, nodeKey } from "../../../vault/vault/node.mjs"

export type Visibility = "public" | "friends" | "private"
export type BlockKind = "text" | "excerpt" | "link" | "media" | "file" | "code" | "post"
export type CortexKind = "identity" | "memory" | "observation" | "skill" | "tool" | "playbook" | "working" | "inference"
export type Kind = BlockKind | CortexKind
export const isBlockKind = (kind: string): kind is BlockKind => BLOCK_KINDS.includes(kind)
export type Platform = "own" | "bluesky" | "instagram" | "x"

export type Doc = {
  id: string
  kind: Kind
  title: string
  slug: string
  /** A vault block's home channel. Cortex files are filed by kind. */
  homeChannel?: string
  visibility: Visibility
  body: string
  updated: string
  /** An emoji shown above the title. */
  icon?: string
  /** Where a post first appeared: "own" for nowhere else, or the platform it was brought in from. */
  platform?: Platform
  /** Channels the block is collected into besides its home channel, as `channel` or `channel/inner`. */
  channels?: string[]
  /**
   * Blocks this one connects to, made by you: each by slug, with an optional line on why. Inline
   * connections live in the body as `[[slug]]` or `[[slug|the words]]`; these are whole-block ones.
   */
  connect?: Connection[]
  /** Exact versions of the vault nodes an inference came from. */
  evidence?: { node: string; version: string }[]
}

export const isBlock = (doc?: Doc | null): doc is Doc & { kind: BlockKind; homeChannel: string } =>
  doc != null && isBlockKind(doc.kind) && doc.homeChannel !== undefined
export const locationOf = (doc: Doc) => doc.homeChannel ?? doc.kind
export const blockKey = (id: string) => nodeKey({ type: "block", id })

export type Connection = { to: string; why?: string }

export type Entity = { did: string; handle: string; name: string }

export const owner: Entity = { did: "did:plc:example0wner", handle: "mira.example", name: "Mira" }

export const entities: Entity[] = [
  owner,
  { did: "did:plc:example0june", handle: "june.example", name: "June" },
  { did: "did:plc:example0theo", handle: "theo.example", name: "Theo" },
  { did: "did:plc:example0sana", handle: "sana.example", name: "Sana" },
]

const fixtureId = (index: number) => newNodeId(Date.UTC(2026, 7, 1) + index, 0)
export const fixtureIds = {
  garden: fixtureId(1), slow: fixtureId(2), address: fixtureId(3), monday: fixtureId(4), tokyo: fixtureId(5), tokyoTwo: fixtureId(6),
  scans: fixtureId(7), workspace: fixtureId(8), reading: fixtureId(9), sketches: fixtureId(10), dusk: fixtureId(11), paragraphs: fixtureId(12),
  privateFirst: fixtureId(13), captions: fixtureId(14), renameJournal: fixtureId(15), suggestChannels: fixtureId(16), search: fixtureId(17), slowness: fixtureId(18),
}

export const blocks: Doc[] = [
  {
    id: fixtureIds.garden, kind: "post", title: "Why I keep a garden of notes", slug: "garden-of-notes", homeChannel: "writing/essays",
    visibility: "public", updated: "2026-11-02",
    body: "# Why I keep a garden of notes\n\nA note is a seed. Most stay small; a few grow into [[slow-software]].\n\nI learned this from @june.example, who writes everything twice.",
  },
  {
    id: fixtureIds.slow, kind: "post", platform: "x", title: "Slow software", slug: "slow-software", homeChannel: "writing/essays", channels: ["slowness"],
    visibility: "public", updated: "2026-10-21",
    body: "# Slow software\n\nTools that wait for you. A draft that is private until you say otherwise.\n\nSee [[garden-of-notes]] and the [[tokyo-walks]] series for the same idea in pictures.",
  },
  {
    id: fixtureIds.address, kind: "text", platform: "bluesky", title: "On owning your address", slug: "owning-your-address", homeChannel: "writing/essays",
    visibility: "friends", updated: "2026-11-09",
    body: "# On owning your address\n\nYour DID is the root. Everything else hangs from it.\n\n@theo.example disagrees, kindly.",
    connect: [{ to: "ohm-workspace", why: "The workspace is where owning your address gets built." }],
  },
  {
    id: fixtureIds.monday, kind: "text", title: "Monday, rain", slug: "monday-rain", homeChannel: "writing/journal", channels: ["slowness"],
    visibility: "private", updated: "2026-11-11",
    body: "# Monday, rain\n\nNothing shipped. Read for an hour. Thought about [[slow-software]] again.",
  },
  {
    id: fixtureIds.tokyo, kind: "post", platform: "instagram", title: "Tokyo walks, day one", slug: "tokyo-walks", homeChannel: "photos/tokyo",
    visibility: "public", updated: "2026-09-14",
    body: "# Tokyo walks, day one\n\nYanaka in the morning, with @sana.example.\n\n![A quiet street](https://example.com/street.jpg)",
  },
  {
    id: fixtureIds.tokyoTwo, kind: "post", platform: "instagram", title: "Tokyo walks, day two", slug: "tokyo-walks-2", homeChannel: "photos/tokyo",
    visibility: "public", updated: "2026-09-15",
    body: "# Tokyo walks, day two\n\nKiyosumi garden. Continues [[tokyo-walks]].",
  },
  {
    id: fixtureIds.scans, kind: "media", platform: "instagram", title: "Film scans", slug: "film-scans", homeChannel: "photos",
    visibility: "friends", updated: "2026-08-30",
    body: "# Film scans\n\nA roll from the summer. @june.example lent the camera.",
  },
  {
    id: fixtureIds.workspace, kind: "post", title: "ohm workspace", slug: "ohm-workspace", homeChannel: "projects/tools",
    visibility: "public", updated: "2026-11-14",
    body: "# ohm workspace\n\nA light place to read and write a vault. Built with @theo.example.\n\nStarted from [[slow-software]].",
  },
  {
    id: fixtureIds.sketches, kind: "text", title: "Graph sketches", slug: "graph-sketches", homeChannel: "projects/tools",
    visibility: "private", updated: "2026-11-12",
    body: "# Graph sketches\n\nA person in the middle, their memory around them, then the vault. Notes for [[ohm-workspace]], after [[garden-of-notes]].",
  },
  {
    id: fixtureIds.dusk, kind: "media", platform: "instagram", title: "Yanaka at dusk", slug: "yanaka-dusk", homeChannel: "photos/tokyo", channels: ["slowness"],
    visibility: "friends", updated: "2026-09-16",
    body: "# Yanaka at dusk\n\nThe same street as [[tokyo-walks]], later. Shot on the camera from [[film-scans]].",
  },
  {
    id: fixtureIds.reading, kind: "text", title: "Reading list", slug: "reading-list", homeChannel: "other", channels: ["projects/tools"],
    visibility: "private", updated: "2026-10-01",
    body: "# Reading list\n\n- A pattern language\n- Notes on the synthesis of form\n\nFor [[slow-software]] and [[ohm-workspace]].",
  },
]

export const cortex: Doc[] = [
  { id: fixtureIds.paragraphs, kind: "memory", title: "Writes in short paragraphs", slug: "short-paragraphs", visibility: "private", updated: "2026-11-01",
    body: "# Writes in short paragraphs\n\nStated. Keep drafts to short paragraphs; no headings inside a post under 300 words." },
  { id: fixtureIds.privateFirst, kind: "inference", title: "Prefers private first", slug: "private-first", visibility: "private", updated: "2026-10-12",
    body: "# Prefers private first\n\nInferred from three sessions. New things start private and are shared later." },
  { id: fixtureIds.captions, kind: "memory", title: "Photo captions are one line", slug: "photo-captions", visibility: "private", updated: "2026-09-20",
    body: "# Photo captions are one line\n\nSeen in two sessions, project photos." },
  { id: fixtureIds.renameJournal, kind: "observation", title: "Asked to rename 'journal'", slug: "rename-journal", visibility: "private", updated: "2026-11-13",
    body: "# Asked to rename 'journal'\n\nOne session. Might want 'diary'. Not settled." },
  { id: fixtureIds.suggestChannels, kind: "skill", title: "Suggest channels", slug: "suggest-channels", visibility: "private", updated: "2026-10-30",
    body: "# Suggest channels\n\nOffer the plain default and ask." },
  { id: fixtureIds.search, kind: "tool", title: "vault_search", slug: "vault-search", visibility: "private", updated: "2026-10-30",
    body: "# vault_search\n\nSearches the vault by text." },
  { id: fixtureIds.slowness, kind: "inference", title: "Slowness ties the essays to the photos", slug: "slowness-thread", visibility: "private", updated: "2026-11-15",
    body: "# Slowness ties the essays to the photos\n\nInferred, not stated. [[slow-software]] links to [[tokyo-walks]]; [[yanaka-dusk]] returns to the same street later; all three were collected into the slowness channel. The essays and the walks argue the same thing in two forms." },
]

export const all: Doc[] = [...blocks, ...cortex]

export const bySlug = (slug: string) => all.find(d => d.slug === slug)
/** Every channel a block is in, with its home channel first. */
export const channelsOf = (doc: Doc) => isBlock(doc) ? [...new Set([doc.homeChannel, ...(doc.channels ?? [])])] : []
/** A secondary tree row identifies both the block and the channel path. */
export const channelRowId = (id: string, path: string) => `${id}/${path}`
/**
 * A channel is a record of its own: it exists whether or not anything is in it, keeps its own order
 * of blocks (the same block can be first in one channel and last in another), and has an id that
 * stays the same when it is renamed or moved. Blocks still name the channels they are in by path in
 * this wireframe; the store keeps the two in step.
 */
export type ChannelRecord = { id: string; path: string; description?: string; order: string[]; created: string }
export const channelRecords: ChannelRecord[] = []
let channelSeq = 0
export const channelByPath = (path: string) => channelRecords.find(c => c.path === path)
/** The record for a channel path, made if it does not exist yet; a channel inside one makes its parent too. */
export function ensureChannel(path: string, created = new Date().toISOString().slice(0, 10)): ChannelRecord {
  const held = channelByPath(path)
  if (held) return held
  if (path.includes("/")) ensureChannel(path.split("/")[0], created)
  const record = { id: `ch${++channelSeq}`, path, order: [], created }
  channelRecords.push(record)
  return record
}
/** A block not in a channel's order goes after the ordered ones, in the order it was made. */
export function inOrder(path: string, docs: Doc[]) {
  const order = channelByPath(path)?.order ?? []
  const rank = (d: Doc) => (order.includes(d.id) ? order.indexOf(d.id) : order.length + docs.indexOf(d))
  return [...docs].sort((a, b) => rank(a) - rank(b))
}
export const docIdOf = (rowId: string) => rowId.split("/", 1)[0]
export const placedIn = (rowId: string) => rowId.includes("/") ? rowId.slice(rowId.indexOf("/") + 1) : null
export const byId = (id: string) => all.find(d => d.id === id)
export const titleOf = (d: Doc) => d.title || "Untitled block"
export const entityByHandle = (h: string) => entities.find(p => p.handle === h || p.did === h)

/** `@handle` mentions in a body. */
export const mentions = (doc: Doc) => [...doc.body.matchAll(/@([a-z0-9.-]+\.[a-z]+)/gi)].map(m => m[1])
/** `[[slug]]` and `[[slug|the words]]` links in a body. */
export const LINK = /\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]/gi
/**
 * Every block this one connects to, as evidence: the links in its text and the connections you made
 * on the whole block. Each says where it was read, so it can be checked.
 */
export type Outgoing = { slug: string; inText: boolean; why?: string; words?: string }
export function outgoing(doc: Doc): Outgoing[] {
  const out = new Map<string, Outgoing>()
  for (const m of doc.body.matchAll(LINK)) if (m[1] !== doc.slug && !out.has(m[1])) out.set(m[1], { slug: m[1], inText: true, words: m[2] })
  for (const c of doc.connect ?? []) out.set(c.to, { ...(out.get(c.to) ?? { slug: c.to, inText: false }), why: c.why, inText: out.get(c.to)?.inText ?? false })
  return [...out.values()]
}
/** Blocks that connect to this one, in their text or as a whole. */
export const incoming = (doc: Doc) => blocks.filter(p => p.id !== doc.id && outgoing(p).some(o => o.slug === doc.slug))

export type InboxItem = {
  id: string
  kind: "mention" | "reply" | "friend" | "observation"
  from: string
  text: string
  at: string
  /** The post or cortex item it is about. */
  ref?: string
  unread: boolean
}

export const inbox: InboxItem[] = [
  { id: "i1", kind: "reply", from: "june.example", text: "Writing everything twice is the only way I know.", at: "2026-11-14", ref: fixtureIds.garden, unread: true },
  { id: "i2", kind: "mention", from: "theo.example", text: "Mentioned you in “Owning nothing, kindly”.", at: "2026-11-13", unread: true },
  { id: "i3", kind: "friend", from: "sana.example", text: "Wants to be friends. Friends see blocks you mark for friends.", at: "2026-11-12", unread: true },
  { id: "i4", kind: "observation", from: "cortex", text: "An observation is waiting to settle: asked to rename “journal”.", at: "2026-11-13", ref: fixtureIds.renameJournal, unread: false },
  { id: "i5", kind: "reply", from: "sana.example", text: "Day two was the better light.", at: "2026-09-16", ref: fixtureIds.tokyoTwo, unread: false },
]

export type Audience = "private" | "friends" | "public"
/** Who sees what: you see everything; friends see friends and public blocks; everyone sees public ones. */
export const sees = (audience: Audience, d: Doc) =>
  (audience === "private" || (isBlock(d) && (d.visibility === "public" || (audience === "friends" && d.visibility === "friends"))))

// Every channel the sample blocks are in, as records, and two more of your own that are still empty.
for (const p of blocks) for (const c of channelsOf(p)) ensureChannel(c, p.updated)
ensureChannel("reading", "2026-11-18")
ensureChannel("projects/someday", "2026-11-18")

import type { BlockKind } from "./block-kind"

export type Visibility = "public" | "friends" | "private"
export type Kind = "post" | "memory" | "observation" | "skill" | "tool"
export type Platform = "own" | "bluesky" | "instagram" | "x"

export type Doc = {
  id: string
  kind: Kind
  vaultKind?: BlockKind
  title: string
  slug: string
  /** Vault: the label (section) and sublabel. Cortex: the folder. */
  label: string
  sublabel?: string
  visibility: Visibility
  body: string
  updated: string
  /** An emoji shown above the title. */
  icon?: string
  /** Where a post first appeared: "own" for nowhere else, or the platform it was brought in from. */
  platform?: Platform
  /** Channels the block is collected into besides its site section, as `channel` or `channel/inner`. */
  channels?: string[]
  /**
   * Blocks this one connects to, made by you: each by slug, with an optional line on why. Inline
   * connections live in the body as `[[slug]]` or `[[slug|the words]]`; these are whole-block ones.
   */
  connect?: Connection[]
  /** Cortex only: what it was drawn from, as a channel (`label`, `label/sublabel`) or a block's slug. */
  about?: string[]
}

export type Connection = { to: string; why?: string }

export type Person = { did: string; handle: string; name: string }

/** The channel that is a block's site section: `label` or `label/sublabel`. */
export const sectionOf = (d: Doc) => (d.sublabel ? `${d.label}/${d.sublabel}` : d.label)
/** Every channel a block is in: its site section first, then any others it was collected into. */
export const channelsOf = (d: Doc) => [sectionOf(d), ...(d.channels ?? []).filter(c => c !== sectionOf(d))]
/**
 * A tree row for a block in a channel other than its section is `id@channel`, so the same block can
 * show in many channels; its row in its section keeps the plain id.
 */
export const PLACED = "@"
/**
 * A channel is a record of its own: it exists whether or not anything is in it, keeps its own order
 * of blocks (the same block can be first in one channel and last in another), and has an id that
 * stays the same when it is renamed or moved. Blocks still name the channels they are in by path in
 * this wireframe; the store keeps the two in step.
 */
export type ChannelRecord = { id: string; path: string; description?: string; order: string[]; created: string }
export const docIdOf = (rowId: string) => rowId.split(PLACED)[0]
export const placedIn = (rowId: string) => (rowId.includes(PLACED) ? rowId.slice(rowId.indexOf(PLACED) + 1) : null)
export const titleOf = (d: Doc) => d.title || "Untitled page"
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

export type Audience = "personal" | "friends" | "public"
/** Who sees what: you see everything; friends see friends and public posts; everyone sees public ones. */
export const sees = (audience: Audience, d: Doc) =>
  (audience === "personal" || (d.kind === "post" && (d.visibility === "public" || (audience === "friends" && d.visibility === "friends"))))

// Every channel the sample blocks are in, as records, and two more of your own that are still empty.

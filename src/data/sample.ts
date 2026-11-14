// Synthetic data for the wireframe. No real person, no real records.

export type Visibility = "public" | "friends" | "private"
export type Kind = "post" | "memory" | "note" | "skill" | "tool"

export type Doc = {
  id: string
  kind: Kind
  title: string
  slug: string
  /** Vault: the label (section) and sublabel. Cortex: the folder. */
  label: string
  sublabel?: string
  visibility: Visibility
  body: string
  updated: string
}

export type Person = { did: string; handle: string; name: string }

export const owner: Person = { did: "did:plc:example0wner", handle: "mira.example", name: "Mira" }

export const people: Person[] = [
  owner,
  { did: "did:plc:example0june", handle: "june.example", name: "June" },
  { did: "did:plc:example0theo", handle: "theo.example", name: "Theo" },
  { did: "did:plc:example0sana", handle: "sana.example", name: "Sana" },
]

export const posts: Doc[] = [
  {
    id: "p1", kind: "post", title: "Why I keep a garden of notes", slug: "garden-of-notes", label: "writing", sublabel: "essays",
    visibility: "public", updated: "2026-11-02",
    body: "# Why I keep a garden of notes\n\nA note is a seed. Most stay small; a few grow into [[slow-software]].\n\nI learned this from @june.example, who writes everything twice.",
  },
  {
    id: "p2", kind: "post", title: "Slow software", slug: "slow-software", label: "writing", sublabel: "essays",
    visibility: "public", updated: "2026-10-21",
    body: "# Slow software\n\nTools that wait for you. A draft that is private until you say otherwise.\n\nSee [[garden-of-notes]] and the [[tokyo-walks]] series for the same idea in pictures.",
  },
  {
    id: "p3", kind: "post", title: "On owning your address", slug: "owning-your-address", label: "writing", sublabel: "essays",
    visibility: "friends", updated: "2026-11-09",
    body: "# On owning your address\n\nYour DID is the root. Everything else hangs from it.\n\n@theo.example disagrees, kindly.",
  },
  {
    id: "p4", kind: "post", title: "Monday, rain", slug: "monday-rain", label: "writing", sublabel: "journal",
    visibility: "private", updated: "2026-11-11",
    body: "# Monday, rain\n\nNothing shipped. Read for an hour. Thought about [[slow-software]] again.",
  },
  {
    id: "p5", kind: "post", title: "Tokyo walks, day one", slug: "tokyo-walks", label: "photos", sublabel: "tokyo",
    visibility: "public", updated: "2026-09-14",
    body: "# Tokyo walks, day one\n\nYanaka in the morning, with @sana.example.\n\n![A quiet street](https://example.com/street.jpg)",
  },
  {
    id: "p6", kind: "post", title: "Tokyo walks, day two", slug: "tokyo-walks-2", label: "photos", sublabel: "tokyo",
    visibility: "public", updated: "2026-09-15",
    body: "# Tokyo walks, day two\n\nKiyosumi garden. Continues [[tokyo-walks]].",
  },
  {
    id: "p7", kind: "post", title: "Film scans", slug: "film-scans", label: "photos",
    visibility: "friends", updated: "2026-08-30",
    body: "# Film scans\n\nA roll from the summer. @june.example lent the camera.",
  },
  {
    id: "p8", kind: "post", title: "ohm workspace", slug: "ohm-workspace", label: "projects",
    visibility: "public", updated: "2026-11-14",
    body: "# ohm workspace\n\nA light place to read and write a vault. Built with @theo.example.\n\nStarted from [[slow-software]].",
  },
  {
    id: "p9", kind: "post", title: "Reading list", slug: "reading-list", label: "other",
    visibility: "private", updated: "2026-10-01",
    body: "# Reading list\n\n- A pattern language\n- Notes on the synthesis of form",
  },
]

export const cortex: Doc[] = [
  { id: "c1", kind: "memory", title: "Writes in short paragraphs", slug: "short-paragraphs", label: "memories", sublabel: "always", visibility: "private", updated: "2026-11-01",
    body: "# Writes in short paragraphs\n\nStated. Keep drafts to short paragraphs; no headings inside a post under 300 words." },
  { id: "c2", kind: "memory", title: "Prefers private first", slug: "private-first", label: "memories", sublabel: "always", visibility: "private", updated: "2026-10-12",
    body: "# Prefers private first\n\nInferred from three sessions. New things start private and are shared later." },
  { id: "c3", kind: "memory", title: "Photo captions are one line", slug: "photo-captions", label: "memories", visibility: "private", updated: "2026-09-20",
    body: "# Photo captions are one line\n\nSeen in two sessions, project photos." },
  { id: "c4", kind: "note", title: "Asked to rename 'journal'", slug: "rename-journal", label: "notes", sublabel: "waiting", visibility: "private", updated: "2026-11-13",
    body: "# Asked to rename 'journal'\n\nOne session. Might want 'diary'. Not settled." },
  { id: "c5", kind: "skill", title: "Suggest labels", slug: "suggest-labels", label: "skills", visibility: "private", updated: "2026-10-30",
    body: "# Suggest labels\n\nOffer the plain default and ask." },
  { id: "c6", kind: "tool", title: "vault_search", slug: "vault-search", label: "tools", visibility: "private", updated: "2026-10-30",
    body: "# vault_search\n\nSearches the vault by text." },
]

export const all: Doc[] = [...posts, ...cortex]

export const bySlug = (slug: string) => all.find(d => d.slug === slug)
export const byId = (id: string) => all.find(d => d.id === id)
export const personByHandle = (h: string) => people.find(p => p.handle === h || p.did === h)

/** `@handle` mentions in a body. */
export const mentions = (doc: Doc) => [...doc.body.matchAll(/@([a-z0-9.-]+\.[a-z]+)/gi)].map(m => m[1])
/** `[[slug]]` links in a body. */
export const links = (doc: Doc) => [...doc.body.matchAll(/\[\[([a-z0-9-]+)\]\]/gi)].map(m => m[1])

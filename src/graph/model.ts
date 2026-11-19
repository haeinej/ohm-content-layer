// The graph's data: one person's knowledge graph, centred on them. Positions come from the force
// layout in GraphView; this file says what the nodes are, which layer each belongs to, and every edge.
//
//   0 you ─ 1 cortex (memories, notes, skills, tools) ─ 2 channels ─ 3 channels inside them
//         ─ 4 blocks ─ 5 sources and entities
//
// Edges come in two families, and the difference is the point:
//
// - Evidence is what the content itself shows, so anyone can check it and it can be rebuilt from
//   the files: a channel contains a block, a block links to another, mentions an entity, or was
//   captured from a source. No model writes evidence.
// - Inference is what the cortex concluded from evidence. A model never draws an edge between two
//   blocks; it writes a memory, note, skill or tool, and that node points at the things it was
//   drawn from. Remove the inference and the evidence is untouched.
import { bySlug, channelRecords, channelsOf, cortex, mentions, outgoing, owner, personByHandle, posts, sees, type Audience, type Doc, type Person } from "@/data/sample"

export type Layer = 0 | 1 | 2 | 3 | 4 | 5
export type NodeType = "person" | "memory" | "note" | "skill" | "tool" | "channel" | "block" | "source" | "entity"
export type GraphNode = {
  id: string
  layer: Layer
  type: NodeType
  name: string
  /** The top-level branch it belongs to: "cortex" or a top-level channel. Empty for you, sources and entities. */
  branch: string
  doc?: Doc
  person?: Person
  degree: number
}

/** Evidence: shown by the content, checkable, rebuilt from files. */
export type EvidenceKind = "contains" | "links" | "mentions" | "from"
/** Inference: a cortex node pointing at what it was drawn from. */
export type InferenceKind = "grounds" | "observes" | "learned" | "acts"
/** Structure: you hold your top-level channels and your cortex. */
export type EdgeKind = EvidenceKind | InferenceKind | "holds"
export type EdgeFamily = "evidence" | "inference" | "structure"
export const familyOf = (kind: EdgeKind): EdgeFamily =>
  kind === "holds" ? "structure" : kind === "grounds" || kind === "observes" || kind === "learned" || kind === "acts" ? "inference" : "evidence"

export type GraphEdge = { source: string; target: string; kind: EdgeKind }
export type Graph = { center: Person; nodes: GraphNode[]; edges: GraphEdge[] }

export type GraphFilters = {
  /** Handle or DID. Defaults to the owner. */
  center?: string
  /** The repo's prime folders, checked in or out. */
  cortex?: boolean
  vault?: boolean
  /** Entities: people a block mentions. */
  people?: boolean
  /** Blocks linking to blocks. */
  links?: boolean
  /** The originals imported blocks were captured from. */
  sources?: boolean
  /** Who is looking: only what they can see is drawn. The cortex is yours alone. */
  audience?: Audience
  /** The repository's filters, as a test each page must pass. */
  keep?: (d: Doc) => boolean
}
export const DEFAULT_FILTERS = { cortex: true, vault: true, people: true, links: true, sources: true, audience: "personal" as Audience }

/** What each kind of cortex item says about the things it points at. */
const INFERENCE: Record<string, InferenceKind> = { memory: "grounds", note: "observes", skill: "learned", tool: "acts" }
const PLATFORM_NAME: Record<string, string> = { x: "X", bluesky: "Bluesky", instagram: "Instagram" }

const channelId = (path: string) => `channel:${path}`

export function buildGraph(filters: GraphFilters = {}): Graph {
  const f = { ...DEFAULT_FILTERS, ...filters }
  const center = (f.center && personByHandle(f.center)) || owner
  const isOwner = center.did === owner.did

  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const add = (n: Omit<GraphNode, "degree">) => (nodes.has(n.id) ? nodes.get(n.id)! : (nodes.set(n.id, { ...n, degree: 0 }), nodes.get(n.id)!))
  const edge = (source: string, target: string, kind: EdgeKind) => {
    if (source !== target && nodes.has(source) && nodes.has(target)) edges.push({ source, target, kind })
  }

  add({ id: center.did, layer: 0, type: "person", name: `@${center.handle}`, branch: "", person: center })

  // Someone else at the centre: the owner's blocks that mention them, and the owner as an entity.
  const docs = !f.vault ? [] : (isOwner ? posts : posts.filter(p => mentions(p).includes(center.handle)))
    .filter(d => sees(f.audience, d) && (!filters.keep || filters.keep(d)))

  // 2–4 · Channels and blocks. A block can be in any number of channels; a path `a/b` is channel b
  // inside channel a. Containment is evidence: you put it there.
  for (const d of docs) {
    add({ id: d.id, layer: 4, type: "block", name: d.title, branch: channelsOf(d)[0].split("/")[0], doc: d })
    for (const path of channelsOf(d)) {
      const [top, inner] = path.split("/")
      add({ id: channelId(top), layer: 2, type: "channel", name: top, branch: top })
      if (inner) {
        add({ id: channelId(path), layer: 3, type: "channel", name: inner, branch: top })
        edge(channelId(top), channelId(path), "contains")
      }
      edge(channelId(path), d.id, "contains")
    }
  }
  // Channels are records: yours show even when empty.
  if (isOwner && f.vault && f.audience === "personal") {
    for (const { path } of channelRecords) {
      const [top, inner] = path.split("/")
      add({ id: channelId(top), layer: 2, type: "channel", name: top, branch: top })
      if (inner) {
        add({ id: channelId(path), layer: 3, type: "channel", name: inner, branch: top })
        edge(channelId(top), channelId(path), "contains")
      }
    }
  }
  for (const n of nodes.values()) if (n.type === "channel" && n.layer === 2) edge(center.did, n.id, "holds")

  // 1 · The cortex: the owner's alone. Each item points at the channels and blocks it was drawn from.
  if (isOwner && f.cortex && f.audience === "personal") {
    for (const c of cortex.filter(c => !filters.keep || filters.keep(c))) {
      add({ id: c.id, layer: 1, type: c.kind as NodeType, name: c.title, branch: "cortex", doc: c })
      edge(center.did, c.id, "holds")
      for (const a of c.about ?? []) {
        const target = nodes.has(channelId(a)) ? channelId(a) : bySlug(a)?.id
        if (target) edge(c.id, target, INFERENCE[c.kind] ?? "grounds")
      }
    }
  }

  // Evidence across the hierarchy: links between blocks, the people they mention, where they came from.
  const blockNodes = [...nodes.values()].filter(n => n.type === "block")
  if (f.links) {
    // Links in the text and connections you made on the whole block: both are yours, both evidence.
    for (const n of blockNodes) for (const { slug } of outgoing(n.doc!)) {
      const target = bySlug(slug)
      if (target) edge(n.id, target.id, "links")
    }
  }
  if (f.people) {
    for (const n of blockNodes) {
      const who = new Set(mentions(n.doc!))
      if (!isOwner) who.add(owner.handle)
      who.delete(center.handle)
      for (const h of who) {
        const person = personByHandle(h) ?? { did: `handle:${h}`, handle: h, name: h }
        add({ id: person.did, layer: 5, type: "entity", name: `@${person.handle}`, branch: "", person })
        edge(n.id, person.did, "mentions")
      }
    }
  }
  if (f.sources) {
    for (const n of blockNodes) {
      const platform = n.doc!.platform
      if (!platform || platform === "own") continue
      const id = `source:${n.doc!.id}`
      add({ id, layer: 5, type: "source", name: `${PLATFORM_NAME[platform] ?? platform} original`, branch: "" })
      edge(n.id, id, "from")
    }
  }

  dedupe(edges)
  for (const e of edges) {
    nodes.get(e.source)!.degree++
    nodes.get(e.target)!.degree++
  }
  return { center, nodes: [...nodes.values()], edges }
}

/** One edge per pair. Evidence wins over inference, so a fact is never shown as a guess. */
function dedupe(edges: GraphEdge[]) {
  const rank: Record<EdgeFamily, number> = { evidence: 0, structure: 1, inference: 2 }
  const best = new Map<string, number>()
  edges.forEach((e, i) => {
    const key = [e.source, e.target].sort().join("|")
    const held = best.get(key)
    if (held === undefined || rank[familyOf(e.kind)] < rank[familyOf(edges[held].kind)]) best.set(key, i)
  })
  const keep = new Set(best.values())
  for (let i = edges.length - 1; i >= 0; i--) if (!keep.has(i)) edges.splice(i, 1)
}

// The graph's data: one person's blocks and how they connect. Positions come from the force layout
// in GraphView; this file says what the nodes are and every edge.
//
// Only blocks are nodes. A channel is not a node but a dimension of the blocks in it: GraphView
// draws each channel as a soft area around its blocks, a channel inside it as an area inside that,
// and a block in several channels sits where their areas meet.
//
// Every edge is the person's own: a link they wrote in a block's text (`[[slug]]`), or a connection
// they made between whole blocks. Both are evidence, rebuilt from the content. What agents work out
// about the person stays in the cortex and is not drawn here.
import { blockKey, blocks, byId, channelRecords, channelsOf, entityByHandle, mentions, owner, sees, type Audience, type Doc, type Entity } from "@/data/sample"
import { sampleSource } from "@/data/sample-source"
import type { VaultEvidence } from "@/data/source"

export type GraphNode = {
  id: string
  name: string
  doc: Doc
  /** Every channel the block is in, as paths (`writing/journal`). The first is its home. */
  channels: string[]
  degree: number
}

/** A link written in the text, or a connection made between whole blocks. */
export type EdgeKind = VaultEvidence[number]["kind"]
/**
 * One edge per pair of blocks. `kinds` says which ways they are joined; `weight` is how strongly:
 * one for each evidence kind, and one for each channel they share. GraphView draws it as
 * the line's thickness.
 */
export type GraphEdge = { source: string; target: string; kinds: EdgeKind[]; weight: number; wholeBlock?: boolean; why?: string }

/** A channel, as the area its blocks are drawn in. */
export type GraphChannel = { path: string; name: string; parent?: string; depth: number; members: string[] }

export type Graph = { center: Entity; nodes: GraphNode[]; edges: GraphEdge[]; channels: GraphChannel[] }

export type GraphFilters = {
  /** Handle or DID. Defaults to the owner; anyone else shows the owner's blocks that mention them. */
  center?: string
  /** The repo's prime folders. The graph draws the vault's blocks only; without the vault it is empty. */
  vault?: boolean
  /** Links written in the text. */
  links?: boolean
  /** Connections made between whole blocks. */
  connections?: boolean
  /** Who is looking: only what they can see is drawn. */
  audience?: Audience
  /** The repository's filters, as a test each page must pass. */
  keep?: (d: Doc) => boolean
}
export const DEFAULT_FILTERS = { vault: true, links: true, connections: true, audience: "private" as Audience }

export function buildGraph(filters: GraphFilters = {}): Graph {
  const f = { ...DEFAULT_FILTERS, ...filters }
  const center = (f.center && entityByHandle(f.center)) || owner
  const isOwner = center.did === owner.did

  const docs = !f.vault ? [] : (isOwner ? blocks : blocks.filter(p => mentions(p).includes(center.handle)))
    .filter(d => sees(f.audience, d) && (!filters.keep || filters.keep(d)))
  const nodes = new Map<string, GraphNode>(docs.map(d => [blockKey(d.id), { id: blockKey(d.id), name: d.title, doc: d, channels: channelsOf(d), degree: 0 }]))

  // Channels, with every channel above them: `a/b` is b inside a.
  const channels = new Map<string, GraphChannel>()
  const channel = (path: string) => {
    const parts = path.split("/")
    for (let at = 1; at <= parts.length; at++) {
      const p = parts.slice(0, at).join("/")
      if (!channels.has(p)) channels.set(p, { path: p, name: parts[at - 1], parent: at > 1 ? parts.slice(0, at - 1).join("/") : undefined, depth: at - 1, members: [] })
    }
    return channels.get(path)!
  }
  for (const n of nodes.values()) {
    for (const path of n.channels) {
      channel(path)
      // A block in a channel is in every channel around it too, so the outer area holds it.
      const parts = path.split("/")
      for (let at = 1; at <= parts.length; at++) {
        const members = channels.get(parts.slice(0, at).join("/"))!.members
        if (!members.includes(n.id)) members.push(n.id)
      }
    }
  }
  // Channels are records: yours show even when empty, as a label with no area yet.
  if (isOwner && f.vault && f.audience === "private") for (const { path } of channelRecords) channel(path)

  // Edges: what each block points at, merged into one per pair.
  const edges = new Map<string, GraphEdge>()
  const join = (a: string, b: string, kind: EdgeKind, wholeBlock: boolean, why?: string) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return
    const key = [a, b].sort().join("|")
    const held = edges.get(key) ?? { source: a, target: b, kinds: [], weight: 0 }
    if (!held.kinds.includes(kind)) held.kinds.push(kind)
    if (wholeBlock) held.wholeBlock = true
    if (why && !held.why) held.why = why
    edges.set(key, held)
  }
  for (const edge of sampleSource.workspace.evidence()) {
    const wholeBlock = edge.kind === "links" && edge.at === "connect"
    if (wholeBlock ? !f.connections : !f.links) continue
    const target = byId(edge.to.slice("block:".length))
    const why = wholeBlock && target
      ? nodes.get(edge.from)?.doc.connect?.find(each => each.to === target.slug)?.why
      : undefined
    join(edge.from, edge.to, edge.kind, wholeBlock, why)
  }
  // How strongly: each way they are joined, and each channel they share.
  for (const e of edges.values()) {
    const a = nodes.get(e.source)!, b = nodes.get(e.target)!
    const shared = a.channels.filter(c => b.channels.includes(c)).length
    e.weight = e.kinds.length + shared
    a.degree++
    b.degree++
  }

  return {
    center,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    channels: [...channels.values()].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
  }
}

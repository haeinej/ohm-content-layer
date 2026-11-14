// The graph's data: who and what sits around one person, as a hierarchy that then intertwines.
// Positions come from the force layout in GraphView; this file says what the nodes are, which
// layer each belongs to, and every edge.
//
//   0 person ─ 1 cortex (memories, skills, notes) ─ 2 vault labels ─ 3 sublabels ─ 4 posts ─ 5 people
//
// The cortex is the layer closest to the person, a ring of what their agents know about them. It
// is also what connects the person to their vault: each label hangs from the memories that know
// about it (or from the person, when none does), and memories reach the sublabels and posts they
// are about more loosely. Posts then cross the hierarchy: [[links]]
// between posts, and people mentioned in several posts, tie distant branches together.
import { bySlug, cortex, links, mentions, owner, personByHandle, posts, sees, type Audience, type Doc, type Person } from "@/data/sample"

export type Layer = 0 | 1 | 2 | 3 | 4 | 5
export type NodeType = "person" | "memory" | "label" | "sublabel" | "post"
export type GraphNode = {
  id: string
  layer: Layer
  type: NodeType
  name: string
  /** The top-level branch it belongs to: "cortex" or a label. Empty for people. */
  branch: string
  doc?: Doc
  person?: Person
  degree: number
}
export type EdgeKind = "hierarchy" | "knows" | "about" | "link" | "mention"
export type GraphEdge = { source: string; target: string; kind: EdgeKind }
export type Graph = { center: Person; nodes: GraphNode[]; edges: GraphEdge[] }

export type GraphFilters = {
  /** Handle or DID. Defaults to the owner. */
  center?: string
  /** The repo's prime folders, checked in or out. */
  cortex?: boolean
  vault?: boolean
  people?: boolean
  links?: boolean
  /** Who is looking: only what they can see is drawn. The cortex is yours alone. */
  audience?: Audience
}
export const DEFAULT_FILTERS = { cortex: true, vault: true, people: true, links: true, audience: "personal" as Audience }

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

  // Someone else at the centre: the owner's posts that mention them, and the owner as a person.
  const docs = !f.vault ? [] : (isOwner ? posts : posts.filter(p => mentions(p).includes(center.handle)))
    .filter(d => sees(f.audience, d))

  // 1 · The cortex: the owner's alone.
  const withCortex = isOwner && f.cortex && f.audience === "personal"
  if (withCortex) {
    for (const c of cortex) {
      add({ id: c.id, layer: 1, type: "memory", name: c.title, branch: "cortex", doc: c })
      edge(center.did, c.id, "hierarchy")
    }
  }

  // 2–4 · The vault: labels, sublabels, posts.
  for (const d of docs) {
    const label = `label:${d.label}`
    add({ id: label, layer: 2, type: "label", name: d.label, branch: d.label })
    let parent = label
    if (d.sublabel) {
      parent = `sublabel:${d.label}/${d.sublabel}`
      add({ id: parent, layer: 3, type: "sublabel", name: d.sublabel, branch: d.label })
      edge(label, parent, "hierarchy")
    }
    add({ id: d.id, layer: 4, type: "post", name: d.title, branch: d.label, doc: d })
    edge(parent, d.id, "hierarchy")
  }
  // Each label once from its parent: drop repeated hierarchy edges.
  dedupe(edges)

  // Labels hang from the memories that know about them; memories reach sublabels and posts loosely.
  const known = new Set<string>()
  if (withCortex) {
    for (const c of cortex) {
      for (const a of c.about ?? []) {
        if (!a.includes("/") && nodes.has(`label:${a}`)) {
          edge(c.id, `label:${a}`, "knows")
          known.add(`label:${a}`)
          continue
        }
        const target = a.includes("/") ? `sublabel:${a}` : bySlug(a)?.id
        if (target) edge(c.id, target, "about")
      }
    }
  }
  for (const n of nodes.values()) if (n.type === "label" && !known.has(n.id)) edge(center.did, n.id, "hierarchy")

  // Posts intertwine: links between them, and the people they mention.
  const postNodes = [...nodes.values()].filter(n => n.type === "post")
  if (f.links) {
    for (const n of postNodes) for (const slug of links(n.doc!)) {
      const target = bySlug(slug)
      if (target) edge(n.id, target.id, "link")
    }
  }
  if (f.people) {
    for (const n of postNodes) {
      const who = new Set(mentions(n.doc!))
      if (!isOwner) who.add(owner.handle)
      who.delete(center.handle)
      for (const h of who) {
        const person = personByHandle(h) ?? { did: `handle:${h}`, handle: h, name: h }
        add({ id: person.did, layer: 5, type: "person", name: `@${person.handle}`, branch: "", person })
        edge(n.id, person.did, "mention")
      }
    }
  }

  dedupe(edges)
  for (const e of edges) {
    nodes.get(e.source)!.degree++
    nodes.get(e.target)!.degree++
  }
  return { center, nodes: [...nodes.values()], edges }
}

function dedupe(edges: GraphEdge[]) {
  const seen = new Set<string>()
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i]
    const key = [e.source, e.target].sort().join("|")
    if (seen.has(key)) edges.splice(i, 1)
    else seen.add(key)
  }
}

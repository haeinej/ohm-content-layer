// A radial graph centred on one person. Rings say what a node is:
// 0 the person, 1 groups (labels, the cortex), 2 posts and cortex items, 3 other people.
// Computed from the data, not simulated: the same data always lands in the same place.
import { cortex, mentions, links, owner, people, personByHandle, posts, bySlug, type Doc, type Person } from "@/data/sample"

export type GraphNode =
  | { id: string; ring: 0 | 3; type: "person"; x: number; y: number; person: Person }
  | { id: string; ring: 1; type: "group"; x: number; y: number; name: string; group: string }
  | { id: string; ring: 2; type: "doc"; x: number; y: number; doc: Doc; group: string }

export type GraphEdge = { from: string; to: string; kind: "tree" | "mention" | "link" }

export type Graph = { center: Person; nodes: GraphNode[]; edges: GraphEdge[]; size: number }

const SIZE = 1000
const C = SIZE / 2
const R = { 1: 150, 2: 290, 3: 430 }
const at = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) })

export function buildGraph(centerHandle?: string): Graph {
  const center = (centerHandle && personByHandle(centerHandle)) || owner
  const isOwner = center.did === owner.did

  // Which docs belong around this person.
  const docs = isOwner ? posts : posts.filter(p => mentions(p).includes(center.handle))
  const groups = new Map<string, Doc[]>()
  for (const d of docs) groups.set(d.label, [...(groups.get(d.label) ?? []), d])
  if (isOwner) groups.set("cortex", cortex.filter(c => c.kind === "memory" || c.kind === "skill"))

  const nodes: GraphNode[] = [{ id: center.did, ring: 0, type: "person", person: center, x: C, y: C }]
  const edges: GraphEdge[] = []

  // Each group gets a slice in proportion to what it holds, never less than a minimum.
  const weights = [...groups].map(([g, list]) => [g, Math.max(list.length, 1.5)] as const)
  const total = weights.reduce((s, [, w]) => s + w, 0)
  let angle = -Math.PI / 2
  const gap = groups.size > 1 ? 0.06 : 0

  for (const [g, w] of weights) {
    const span = (w / total) * Math.PI * 2
    const mid = angle + span / 2
    const gid = `group:${g}`
    nodes.push({ id: gid, ring: 1, type: "group", name: g, group: g, ...at(R[1], mid) })
    edges.push({ from: center.did, to: gid, kind: "tree" })

    const list = groups.get(g)!
    const inner = span - gap * 2
    list.forEach((doc, i) => {
      const a = list.length === 1 ? mid : angle + gap + (inner * (i + 0.5)) / list.length
      const r = R[2] + (list.length > 3 ? (i % 2 ? 26 : -26) : 0)
      nodes.push({ id: doc.id, ring: 2, type: "doc", doc, group: g, ...at(r, a) })
      edges.push({ from: gid, to: doc.id, kind: "tree" })
    })
    angle += span
  }

  // Other people: everyone mentioned, plus the owner when centred on someone else.
  const docNodes = nodes.filter((n): n is Extract<GraphNode, { type: "doc" }> => n.type === "doc")
  const around = new Map<string, Extract<GraphNode, { type: "doc" }>[]>()
  for (const n of docNodes) {
    const who = new Set(mentions(n.doc))
    if (!isOwner) who.add(owner.handle)
    who.delete(center.handle)
    for (const h of who) around.set(h, [...(around.get(h) ?? []), n])
  }
  for (const [h, near] of around) {
    const person = personByHandle(h) ?? { did: `handle:${h}`, handle: h, name: h }
    // Sit at the mean angle of the posts that mention them.
    const sx = near.reduce((s, n) => s + (n.x - C), 0)
    const sy = near.reduce((s, n) => s + (n.y - C), 0)
    const a = Math.atan2(sy, sx)
    nodes.push({ id: person.did, ring: 3, type: "person", person, ...at(R[3], a) })
    for (const n of near) edges.push({ from: n.id, to: person.did, kind: "mention" })
  }

  // Links between posts on the graph.
  const onGraph = new Set(docNodes.map(n => n.id))
  for (const n of docNodes) {
    for (const slug of links(n.doc)) {
      const target = bySlug(slug)
      if (target && onGraph.has(target.id) && target.id !== n.id) edges.push({ from: n.id, to: target.id, kind: "link" })
    }
  }

  return { center, nodes, edges, size: SIZE }
}

export const knownPeople = people

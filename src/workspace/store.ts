// Workspace state, and the handlers both the UI and the WebMCP tools call (AGENTS.md rule 2).
import { useSyncExternalStore } from "react"
import { all, byId, owner, posts, type Doc } from "@/data/sample"
import { buildGraph } from "@/graph/layout"
import type { AgentState } from "@/components/agent-status"

export type Side = "vault" | "cortex" | null
export type View =
  | { kind: "empty" }
  | { kind: "doc"; id: string; mode: "read" | "edit" }
  | { kind: "graph"; center: string }

type State = {
  side: Side
  view: View
  searchOpen: boolean
  agent: { state: AgentState; label: string } | null
  rev: number
}

/** On a phone the side panel lies over the main panel, so it starts closed and closes when something opens. */
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
const sideAfterOpen = () => (narrow() ? { side: null } : {})

let state: State = { side: narrow() ? null : "vault", view: { kind: "empty" }, searchOpen: false, agent: null, rev: 0 }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export const useWorkspace = () =>
  useSyncExternalStore(cb => (listeners.add(cb), () => listeners.delete(cb)), () => state)

// Rack
export const toggleSide = (side: Exclude<Side, null>) => set({ side: state.side === side ? null : side })
export const setSearchOpen = (searchOpen: boolean) => set({ searchOpen })
export const setAgent = (agent: State["agent"]) => set({ agent })

// Handlers shared by the UI and the tools.
export function open(id: string, mode: "read" | "edit" = "read") {
  const doc = byId(id)
  if (!doc) throw new DOMException(`Nothing with id ${id}`, "NotFoundError")
  set({ view: { kind: "doc", id, mode }, searchOpen: false, ...sideAfterOpen() })
  return { id, title: doc.title, view: mode, next: mode === "edit" ? "workspace.save-draft" : "workspace.open" }
}

export function showGraph(center?: string) {
  const g = buildGraph(center)
  set({ view: { kind: "graph", center: g.center.handle }, searchOpen: false, ...sideAfterOpen() })
  return { center: g.center.handle, nodes: g.nodes.length, edges: g.edges.length }
}

let draftCount = 0
export function createDraft(input: { label?: string; title?: string } = {}) {
  draftCount += 1
  const slug = `untitled-${Date.now().toString(36)}`
  const doc: Doc = {
    id: `draft-${draftCount}`, kind: "post", slug, title: input.title?.trim() || "Untitled",
    label: input.label?.trim() || "other", visibility: "private",
    updated: new Date().toISOString().slice(0, 10), body: "",
  }
  posts.push(doc)
  all.push(doc)
  set({ view: { kind: "doc", id: doc.id, mode: "edit" }, rev: state.rev + 1, searchOpen: false, ...sideAfterOpen() })
  return { id: doc.id, slug, view: "edit", next: "workspace.save-draft" }
}

/** Saves the open post as private. Never publishes. */
export function saveDraft(input: { title?: string; body?: string }) {
  const v = state.view
  if (v.kind !== "doc") throw new DOMException("No post is open in the editor", "InvalidStateError")
  const doc = byId(v.id)
  if (!doc || doc.kind !== "post") throw new DOMException("Only posts are edited here", "DataError")
  // Changing a post other people can see needs the person's approval (AGENTS.md rule 11): its own flow.
  if (doc.visibility !== "private") throw new DOMException("This post is not private; changing it needs approval", "NotAllowedError")
  if (input.title !== undefined) doc.title = input.title.trim() || "Untitled"
  if (input.body !== undefined) doc.body = input.body
  if (doc.id.startsWith("draft-")) doc.slug = slugify(doc.title) || doc.slug
  doc.updated = new Date().toISOString().slice(0, 10)
  set({ view: { kind: "doc", id: doc.id, mode: "read" }, rev: state.rev + 1 })
  return { id: doc.id, slug: doc.slug, visibility: doc.visibility }
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
export const me = owner

// Workspace state, and the handlers both the UI and the WebMCP tools call (AGENTS.md rule 2).
import { useSyncExternalStore } from "react"
import { all, byId, inbox, owner, posts, type Audience, type Doc, type Visibility } from "@/data/sample"
import { buildGraph } from "@/graph/model"
import type { AgentState } from "@/components/agent-status"
import type { SettingsTab } from "./settings-tabs"

/** What the side panel shows. The rack chooses it. */
export type Side = "repo" | "visibility" | "inbox" | "profile" | null
export type View =
  | { kind: "empty" }
  | { kind: "doc"; id: string; mode: "read" | "edit" }
  | { kind: "inbox"; id: string }
  | { kind: "settings"; tab: SettingsTab }
export type Appearance = "system" | "light" | "dark"
export type RepoScope = "all" | "cortex" | "vault"
export const SIDE_WIDTH = { min: 220, max: 640, initial: 300 }
const savedWidth = () => {
  try { const w = Number(localStorage.getItem("ohm-ux:side-width")); return w >= SIDE_WIDTH.min && w <= SIDE_WIDTH.max ? w : SIDE_WIDTH.initial } catch { return SIDE_WIDTH.initial }
}
export type ToolName = "workspace.search" | "workspace.open" | "workspace.graph" | "workspace.create" | "workspace.save-draft"

type State = {
  side: Side
  /** The personal repo: as a tree, or as the graph. */
  repoMode: "tree" | "graph"
  /** Which of the repo's two prime folders the side panel and the graph show. */
  scope: RepoScope
  /** The side panel's width, set with its handle. */
  sideWidth: number
  /** Who you are looking as: yourself, a friend, or anyone. */
  audience: Audience
  graphCenter: string
  view: View
  searchOpen: boolean
  agent: { state: AgentState; label: string } | null
  rev: number
  appearance: Appearance
  agentsAllowed: boolean
  offered: Record<ToolName, boolean>
}

/** On a phone the side panel lies over the main panel, so it starts closed and closes when something opens. */
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
const sideAfterOpen = (): Partial<State> => (narrow() ? { side: null } : {})

let state: State = {
  side: narrow() ? null : "repo", repoMode: "tree", scope: "all", sideWidth: savedWidth(), audience: "personal",
  graphCenter: owner.handle, view: { kind: "empty" }, searchOpen: false, agent: null, rev: 0,
  appearance: "system", agentsAllowed: true,
  offered: { "workspace.search": true, "workspace.open": true, "workspace.graph": true, "workspace.create": true, "workspace.save-draft": true },
}
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}
const bump = () => ({ rev: state.rev + 1 })

export const useWorkspace = () =>
  useSyncExternalStore(cb => (listeners.add(cb), () => listeners.delete(cb)), () => state)

// Rack
export const toggleSide = (side: Exclude<Side, null>) => set({ side: state.side === side ? null : side })
export const setSearchOpen = (searchOpen: boolean) => set({ searchOpen })
export const setAgent = (agent: State["agent"]) => set({ agent })

// Personal repo
export const setRepoMode = (repoMode: State["repoMode"]) => set({ repoMode, side: "repo" })
export const setScope = (scope: RepoScope) => set({ scope })
export function setSideWidth(w: number) {
  const sideWidth = Math.round(Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, w)))
  try { localStorage.setItem("ohm-ux:side-width", String(sideWidth)) } catch { /* a convenience only */ }
  set({ sideWidth })
}
/** The graph filters a scope stands for. */
export const scopeFolders = (scope: RepoScope) => ({ cortex: scope !== "vault", vault: scope !== "cortex" })

// Visibility
export const setAudience = (audience: Audience) => set({ audience })
/** Marks who a post is for. Marking is not publishing; making a post less private asks first (the panel's dialog). */
export function setVisibility(id: string, visibility: Visibility) {
  const doc = byId(id)
  if (!doc || doc.kind !== "post") throw new DOMException("Only posts have a visibility", "DataError")
  doc.visibility = visibility
  set(bump())
}

// Inbox
export function openInbox(id: string) {
  const item = inbox.find(i => i.id === id)
  if (!item) throw new DOMException(`Nothing in the inbox with id ${id}`, "NotFoundError")
  item.unread = false
  set({ view: item.ref ? { kind: "doc", id: item.ref, mode: "read" } : { kind: "inbox", id }, ...bump(), ...sideAfterOpen() })
}

// Profile and settings
export function openSettings(tab: SettingsTab = "profile") {
  set({ side: narrow() && state.side === "profile" ? null : "profile", view: { kind: "settings", tab }, searchOpen: false })
}
export const closeSettings = () => set({ side: "repo", view: { kind: "empty" } })
export function setAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance
  set({ appearance })
}
export const setAgentsAllowed = (agentsAllowed: boolean) => set({ agentsAllowed })
export const setOffered = (name: ToolName, on: boolean) => set({ offered: { ...state.offered, [name]: on } })

// Handlers shared by the UI and the tools.
export function open(id: string, mode: "read" | "edit" = "read") {
  const doc = byId(id)
  if (!doc) throw new DOMException(`Nothing with id ${id}`, "NotFoundError")
  set({ view: { kind: "doc", id, mode }, searchOpen: false, ...sideAfterOpen() })
  return { id, title: doc.title, view: mode, next: mode === "edit" ? "workspace.save-draft" : "workspace.open" }
}

/** The graph lives in the side panel, in the personal repo. */
export function showGraph(center?: string) {
  const g = buildGraph({ center, audience: state.audience, ...scopeFolders(state.scope) })
  set({ side: "repo", repoMode: "graph", graphCenter: g.center.handle, searchOpen: false })
  return { center: g.center.handle, nodes: g.nodes.length, edges: g.edges.length }
}

let draftCount = 0
export function createDraft(input: { label?: string; title?: string } = {}) {
  draftCount += 1
  const slug = `untitled-${Date.now().toString(36)}`
  const doc: Doc = {
    id: `draft-${draftCount}`, kind: "post", slug, title: input.title?.trim() ?? "",
    label: input.label?.trim() || "other", visibility: "private",
    updated: new Date().toISOString().slice(0, 10), body: "",
  }
  posts.push(doc)
  all.push(doc)
  set({ view: { kind: "doc", id: doc.id, mode: "edit" }, ...bump(), searchOpen: false, ...sideAfterOpen() })
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
  if (input.title !== undefined) doc.title = input.title.trim()
  if (input.body !== undefined) doc.body = input.body
  if (doc.id.startsWith("draft-")) doc.slug = slugify(doc.title) || doc.slug
  // The editor keeps the post open; saving changes nothing about what is on screen.
  doc.updated = new Date().toISOString().slice(0, 10)
  set(bump())
  return { id: doc.id, slug: doc.slug, visibility: doc.visibility }
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
export const me = owner

/** A page's icon: an emoji shown above its title. */
export function setIcon(id: string, icon: string | undefined) {
  const doc = byId(id)
  if (!doc) return
  doc.icon = icon
  set(bump())
}
/** Saves as you type, for private posts only. */
export function autosave(id: string, patch: { title?: string; body?: string }) {
  const doc = byId(id)
  if (!doc || doc.kind !== "post" || doc.visibility !== "private") return
  if (patch.title !== undefined) doc.title = patch.title
  if (patch.body !== undefined) doc.body = patch.body
  if (doc.id.startsWith("draft-") && patch.title) doc.slug = slugify(patch.title) || doc.slug
  doc.updated = new Date().toISOString().slice(0, 10)
  set(bump())
}

// Workspace state, and the handlers both the UI and the WebMCP tools call (AGENTS.md rule 2).
import { useSyncExternalStore } from "react"
import { all, byId, inbox, owner, posts, titleOf, type Audience, type Doc, type Visibility } from "@/data/sample"
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
/** How tight corners and menus are; src/theme.css holds the values. */
export type Density = "compact" | "comfortable" | "rounded"
const savedDensity = (): Density => {
  try { const d = localStorage.getItem("ohm-ux:density"); return d === "comfortable" || d === "rounded" ? d : "compact" } catch { return "compact" }
}
/** Which of the repository's two prime folders are shown. "All" is both. */
export type RepoScope = { cortex: boolean; vault: boolean }
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
  /** The repository shows who each page is for, with a pill to change it. */
  showVisibility: boolean
  graphCenter: string
  view: View
  searchOpen: boolean
  agent: { state: AgentState; label: string } | null
  rev: number
  appearance: Appearance
  density: Density
  /** Pages opened, oldest first, and where we are in them: back and forward walk this. */
  history: string[]
  at: number
  /** Where to go back to when settings close. */
  returnTo: { view: View; side: Side } | null
  /** Ask the tree to show something (a page or a folder): it opens the way to it and scrolls to it. */
  reveal: { target: string; n: number } | null
  /** The panel last shown, for ⌘\ to bring back. */
  lastSide: Exclude<Side, null>
  agentsAllowed: boolean
  offered: Record<ToolName, boolean>
}

/** On a phone the side panel lies over the main panel, so it starts closed and closes when something opens. */
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
const sideAfterOpen = (): Partial<State> => (narrow() ? { side: null } : {})

let state: State = {
  side: narrow() ? null : "repo", repoMode: "tree", scope: { cortex: true, vault: true }, sideWidth: savedWidth(), audience: "personal", showVisibility: false,
  graphCenter: owner.handle, view: { kind: "empty" }, searchOpen: false, agent: null, rev: 0,
  appearance: "system", density: savedDensity(), agentsAllowed: true,
  history: [], at: -1, returnTo: null, reveal: null, lastSide: "repo",
  offered: { "workspace.search": true, "workspace.open": true, "workspace.graph": true, "workspace.create": true, "workspace.save-draft": true },
}
const listeners = new Set<() => void>()
let walking = false
const set = (patch: Partial<State>) => {
  // The one place the open page changes: record it in history, and have the tree reveal it.
  const next = patch.view
  if (next?.kind === "doc" && !(state.view.kind === "doc" && state.view.id === next.id)) {
    if (!walking) {
      const history = [...state.history.slice(0, state.at + 1).filter(id => id !== next.id), next.id].slice(-50)
      patch = { ...patch, history, at: history.length - 1 }
    }
    patch = { ...patch, reveal: { target: next.id, n: (state.reveal?.n ?? 0) + 1 } }
  }
  if (patch.side) patch = { ...patch, lastSide: patch.side }
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}
const bump = () => ({ rev: state.rev + 1 })

export const useWorkspace = () =>
  useSyncExternalStore(cb => (listeners.add(cb), () => listeners.delete(cb)), () => state)

// Rack
export const toggleSide = (side: Exclude<Side, null>) => {
  if (state.side === "profile" && state.view.kind === "settings") return closeSettings()
  set({ side: state.side === side ? null : side })
}
/** ⌘\: hide the side panel, or bring back the one last shown. The page stays as it is either way. */
export const togglePanel = () => set({ side: state.side ? null : state.lastSide })

// History
const existing = (id: string) => !!byId(id)
export const canGo = (dir: -1 | 1) => {
  for (let i = state.at + dir; i >= 0 && i < state.history.length; i += dir) if (existing(state.history[i])) return true
  return false
}
export function go(dir: -1 | 1) {
  for (let i = state.at + dir; i >= 0 && i < state.history.length; i += dir) {
    const id = state.history[i]
    if (!existing(id)) continue
    walking = true
    set({ view: { kind: "doc", id, mode: "read" }, at: i, ...sideAfterOpen() })
    walking = false
    return true
  }
  return false
}

/** Shows a folder in the tree: the panel opens on the repository, and the way to it opens. */
export function revealFolder(prime: "vault" | "cortex", path: string) {
  set({
    side: "repo", repoMode: "tree",
    scope: { ...state.scope, [prime]: true },
    reveal: { target: `${prime}:${path}`, n: (state.reveal?.n ?? 0) + 1 },
  })
}
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
export const scopeFolders = (scope: RepoScope) => scope

// Visibility
export const setAudience = (audience: Audience) => set({ audience })
export const setShowVisibility = (showVisibility: boolean) =>
  set({ showVisibility, side: "repo", repoMode: "tree", ...(showVisibility ? {} : { audience: "personal" as Audience }) })
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
  // Remember where you were, once, so leaving settings goes back there.
  const returnTo = state.view.kind === "settings" ? state.returnTo : { view: state.view, side: state.side === "profile" ? state.lastSide : state.side }
  set({ side: narrow() && state.side === "profile" ? null : "profile", view: { kind: "settings", tab }, searchOpen: false, returnTo })
}
/** Leaving settings: back to the page and panel you came from. */
export function closeSettings() {
  const back = state.returnTo
  const view = back?.view.kind === "doc" && !byId(back.view.id) ? { kind: "empty" as const } : back?.view ?? { kind: "empty" as const }
  set({ view, side: back?.side === "profile" ? "repo" : back?.side ?? "repo", returnTo: null })
}
export function setAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance
  set({ appearance })
}
export function setDensity(density: Density) {
  document.documentElement.dataset.density = density
  try { localStorage.setItem("ohm-ux:density", density) } catch { /* a convenience only */ }
  set({ density })
}
/** Applies the saved density before the first paint. */
export const applyDensity = () => { document.documentElement.dataset.density = state.density }
export const setAgentsAllowed = (agentsAllowed: boolean) => set({ agentsAllowed })
export const setOffered = (name: ToolName, on: boolean) => set({ offered: { ...state.offered, [name]: on } })

// Handlers shared by the UI and the tools.
export function open(id: string, mode: "read" | "edit" = "read") {
  const doc = byId(id)
  if (!doc) throw new DOMException(`Nothing with id ${id}`, "NotFoundError")
  marks.unread.delete(id)
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

/** Files a post under another label (and sublabel). Moving keeps who it is for. */
export function moveDoc(id: string, label: string, sublabel?: string) {
  const doc = byId(id)
  if (!doc || doc.kind !== "post") throw new DOMException("Only posts can be filed in the vault", "DataError")
  doc.label = label
  doc.sublabel = sublabel
  set(bump())
}

/** Opens a Markdown or text file as a new private page. */
export function openFile(name: string, text: string) {
  const title = name.replace(/\.(md|markdown|txt)$/i, "")
  const draft = createDraft({ title })
  autosave(draft.id, { body: text })
  return draft
}

// ─── Row actions: the ⋯ menu on a page in the repository ──────────────────────

/** Pinned pages show on top of the repository; unread ones carry a dot until opened; archived ones leave the tree. */
export const marks = { pinned: new Set<string>(), unread: new Set<string>(["p11"]), archived: new Set<string>() }
const flip = (set: Set<string>, id: string, on = !set.has(id)) => { if (on) set.add(id); else set.delete(id); set_(bump()) }
const set_ = (patch: Partial<State>) => set(patch)

export const togglePin = (id: string) => flip(marks.pinned, id)
export const toggleUnread = (id: string) => flip(marks.unread, id)
export const toggleArchive = (id: string) => {
  flip(marks.archived, id)
  if (marks.archived.has(id)) marks.pinned.delete(id)
}

/** Renames a page. Its address follows for a draft; a published page keeps its slug. */
export function renameDoc(id: string, title: string) {
  const doc = byId(id)
  if (!doc) return
  doc.title = title.trim()
  if (doc.id.startsWith("draft-")) doc.slug = slugify(doc.title) || doc.slug
  doc.updated = new Date().toISOString().slice(0, 10)
  set(bump())
}

/** Removes a page from the vault. Taking a published one down from the repository is its own step. */
export function deleteDoc(id: string) {
  for (const list of [posts, all]) {
    const i = list.findIndex(d => d.id === id)
    if (i >= 0) list.splice(i, 1)
  }
  for (const s of Object.values(marks)) s.delete(id)
  const wasOpen = state.view.kind === "doc" && state.view.id === id
  // Take it out of history; the position moves back one if it was at or before where we are.
  const idx = state.history.indexOf(id)
  const history = state.history.filter(h => h !== id)
  const at = idx >= 0 && idx <= state.at ? state.at - 1 : state.at
  set({ ...bump(), history, at })
  if (!wasOpen) return
  // Deleting the open page lands on the page before it (or after it), never a blank editor.
  const landing = history[at] ?? history[at + 1]
  if (landing && byId(landing)) {
    walking = true
    set({ view: { kind: "doc", id: landing, mode: "read" }, at: history.indexOf(landing) })
    walking = false
  } else set({ view: { kind: "empty" } })
}

/**
 * Renames a vault folder (`label` or `label/sublabel`): every page in it is refiled under the new
 * name. Folders are the owner's words; a published page's address follows on its next publish.
 */
export function renameFolder(path: string, name: string) {
  const [label, sublabel] = path.split("/")
  const next = name.trim().toLowerCase().replace(/\s+/g, "-")
  let published = 0
  for (const p of posts) {
    if (p.label !== label || (sublabel !== undefined && p.sublabel !== sublabel)) continue
    if (sublabel === undefined) p.label = next
    else p.sublabel = next
    if (p.visibility !== "private") published++
  }
  set(bump())
  return { published }
}

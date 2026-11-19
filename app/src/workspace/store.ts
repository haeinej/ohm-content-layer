// Workspace state, and the handlers both the UI and the WebMCP tools call (AGENTS.md rule 2).
import { newNodeId, inferKind, isChannelPath } from "../../../vault/vault/node.mjs"
import { useSyncExternalStore } from "react"
import { fixtureIds, isBlock, channelsOf, type Audience, type Doc, type Visibility } from "@/data/sample"
import { sampleSource } from "@/data/sample-source"
import { buildGraph } from "@/graph/model"
import type { AgentState } from "@/components/agent-status"
import type { SettingsTab } from "./settings-tabs"
import { NO_FILTERS, passes, type Filters } from "./filters"
import type { DeadEnd, Snapshot } from "@/data/journal"

const data = sampleSource.workspace
const { getDoc: byId, getChannel: channelByPath, ensureChannel, inOrder, owner } = data
const { actor, applySnapshot, changeById, linesFor, recordSession, save: saveJournal, snap, snapshotAt, syncJournal } = data.journal

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
  | "history.list" | "history.save" | "history.session" | "history.revert" | "history.versions" | "history.restore"

type State = {
  side: Side
  /** The home: as a tree, or as the graph. */
  repoMode: "tree" | "graph" | "history"
  /** Which of the repo's two prime folders the side panel and the graph show. */
  scope: RepoScope
  /** The side panel's width, set with its handle. */
  sideWidth: number
  /** Who you are looking as: yourself, a friend, or anyone. */
  audience: Audience
  /** The repository shows who each page is for, with a pill to change it. */
  showVisibility: boolean
  /** What the repository's tree and graph are narrowed to. */
  filters: Filters
  graphCenter: string
  view: View
  searchOpen: boolean
  agent: { state: AgentState; label: string } | null
  rev: number
  /** The last page brought back by a restore or revert, so only its open editor re-reads it. */
  restored: { id: string; n: number } | null
  /** A change chosen in the repository's timeline: its page's history card opens on it. */
  historyFocus: { id: string; line: string; n: number } | null
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
  side: narrow() ? null : "repo", repoMode: "tree", scope: { cortex: true, vault: true }, sideWidth: savedWidth(), audience: "private", showVisibility: false, filters: NO_FILTERS,
  graphCenter: owner.handle, view: { kind: "empty" }, searchOpen: false, agent: null, rev: 0, restored: null, historyFocus: null,
  appearance: "system", density: savedDensity(), agentsAllowed: true,
  history: [], at: -1, returnTo: null, reveal: null, lastSide: "repo",
  offered: {
    "workspace.search": true, "workspace.open": true, "workspace.graph": true, "workspace.create": true, "workspace.save-draft": true,
    "history.list": true, "history.save": true, "history.session": true, "history.revert": true, "history.versions": true, "history.restore": true,
  },
}
const listeners = new Set<() => void>()
let walking = false
let pendingChange: Parameters<typeof syncJournal>[0]
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
  // Every change to the repository goes into the journal (data/journal.ts): who, what, when.
  if (patch.rev !== undefined) { syncJournal(pendingChange); pendingChange = undefined }
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

// Home
export const setRepoMode = (repoMode: State["repoMode"]) => set({ repoMode, side: "repo" })
export const setScope = (scope: RepoScope) => set({ scope })
export const setFilters = (filters: Filters) => set({ filters })
/** Whether a page shows in the repository under the current filters. */
export const kept = (d: Doc) => passes(state.filters, d, marks)
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
  set({ showVisibility, side: "repo", repoMode: "tree", ...(showVisibility ? {} : { audience: "private" as Audience }) })
/** Marks who a post is for. Marking is not publishing; making a post less private asks first (the panel's dialog). */
export function setVisibility(id: string, visibility: Visibility) {
  const doc = byId(id)
  if (!doc || !isBlock(doc)) throw new DOMException("Only blocks have visibility", "DataError")
  doc.visibility = visibility
  set(bump())
}

// Inbox
export function openInbox(id: string) {
  const item = data.inbox().find(i => i.id === id)
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

/** The graph lives in the side panel, in the home. */
export function showGraph(center?: string) {
  const g = buildGraph({ center, audience: state.audience, ...scopeFolders(state.scope), keep: kept })
  set({ side: "repo", repoMode: "graph", graphCenter: g.center.handle, searchOpen: false })
  return { center: g.center.handle, nodes: g.nodes.length, edges: g.edges.length }
}

const usedSlugs = new Set(data.slugs())
export function createDraft(input: { homeChannel?: string; channels?: string[]; title?: string } = {}) {
  const homeChannel = input.homeChannel?.trim() || "other"
  if (!isChannelPath(homeChannel) || homeChannel.length > 120 || homeChannel.split("/").length > 2) throw new DOMException("Choose a channel up to two folders deep.", "DataError")
  const title = input.title?.trim() ?? ""
  const stem = slugify(title) || "untitled"
  let slug = stem
  for (let suffix = 2; usedSlugs.has(slug); suffix++) {
    slug = `${stem.slice(0, 59 - String(suffix).length)}-${suffix}`
  }
  usedSlugs.add(slug)
  // Everything about the new page is set here, before the one change that records it.
  let id = newNodeId()
  while (byId(id)) id = newNodeId()
  const doc: Doc = {
    id, kind: "text", slug, title, homeChannel,
    ...(input.channels?.length ? { channels: [...input.channels] } : {}), visibility: "private",
    updated: new Date().toISOString().slice(0, 10), body: "",
  }
  for (const c of channelsOf(doc)) ensureChannel(c)
  data.addDoc(doc)
  set({ view: { kind: "doc", id: doc.id, mode: "edit" }, ...bump(), searchOpen: false, ...sideAfterOpen() })
  return { id: doc.id, slug, view: "edit", next: "workspace.save-draft" }
}

/** Saves the open block as private. Never publishes. */
export function saveDraft(input: { title?: string; body?: string }) {
  const v = state.view
  if (v.kind !== "doc") throw new DOMException("No block is open in the editor", "InvalidStateError")
  const doc = byId(v.id)
  if (!doc || !isBlock(doc)) throw new DOMException("Only blocks are edited here", "DataError")
  // Changing a block other people can see needs the person's approval (AGENTS.md rule 11): its own flow.
  if (doc.visibility !== "private") throw new DOMException("This block is not private; changing it needs approval", "NotAllowedError")
  if (input.title !== undefined) doc.title = input.title.trim()
  if (input.body !== undefined) updateBody(doc, input.body)
  // The editor keeps the block open; saving changes nothing about what is on screen.
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
function updateBody(doc: Doc, body: string) {
  doc.body = body
  if (doc.kind !== "post" && doc.kind !== "excerpt") doc.kind = inferKind(body) as Doc["kind"]
}
/** Saves as you type, for private blocks only. */
export function autosave(id: string, patch: { title?: string; body?: string }) {
  const doc = byId(id)
  if (!doc || !isBlock(doc) || doc.visibility !== "private") return
  if (patch.title !== undefined) doc.title = patch.title
  if (patch.body !== undefined) updateBody(doc, patch.body)
  doc.updated = new Date().toISOString().slice(0, 10)
  set(bump())
}

/**
 * Collects a block into a channel, keeping every channel it is already in: a block can be in any
 * number of them. Moving the home row changes the block's home channel.
 */
export function collect(id: string, path: string) {
  const doc = byId(id)
  if (!doc || !isBlock(doc)) throw new DOMException("Only blocks can be collected into channels", "DataError")
  ensureChannel(path)
  if (doc.homeChannel === path || doc.channels?.includes(path)) return { added: false }
  doc.channels = [...(doc.channels ?? []), path]
  set(bump())
  return { added: true }
}

/** Puts a block before or after another in one channel's own order. */
function place(path: string, id: string, at: { before?: string; after?: string }) {
  const list = inOrder(path, data.blocks().filter(p => channelsOf(p).includes(path))).map(d => d.id).filter(x => x !== id)
  const i = at.before ? list.indexOf(at.before) : at.after ? list.indexOf(at.after) + 1 : -1
  list.splice(i < 0 ? list.length : i, 0, id)
  ensureChannel(path).order = list
}

/**
 * Moves a block's row between channel placements and updates its order.
 * Moving the home row can change the block's address on its next publish. With `keep`, the
 * move collects the block into another channel and keeps the existing placements (⌥ while dragging).
 */
export function moveBlock(id: string, from: string, to: string, opts: { before?: string; after?: string; keep?: boolean } = {}) {
  const doc = byId(id)
  if (!doc || !isBlock(doc)) throw new DOMException("Only blocks move between channels", "DataError")
  let homeChannelChanged = false
  ensureChannel(to)
  if (from !== to) {
    if (opts.keep) collect(id, to)
    else if (doc.homeChannel === from) {
      doc.homeChannel = to
      doc.channels = doc.channels?.filter(c => c !== to)
      homeChannelChanged = true
    } else {
      doc.channels = (doc.channels ?? []).filter(c => c !== from)
      if (doc.homeChannel !== to && !doc.channels.includes(to)) doc.channels.push(to)
    }
  }
  if (opts.before || opts.after) place(to, id, opts)
  set(bump())
  return { homeChannelChanged, published: homeChannelChanged && doc.visibility !== "private" }
}

/**
 * Moves a channel into another, or to the top with `into` null: what dragging a channel's row does.
 * Every block in it goes along, and keeps its order. A channel inside a channel holds no channels of
 * its own yet, so a channel that holds some cannot go inside another.
 */
export function moveChannel(path: string, into: string | null) {
  const name = path.split("/").at(-1)!
  const next = into ? `${into}/${name}` : name
  if (into && into.includes("/")) throw new DOMException("A channel inside a channel can't hold channels yet", "DataError")
  if (into && (into === path || into.startsWith(`${path}/`))) throw new DOMException("A channel can't go inside itself", "DataError")
  if (into && data.channels().some(c => c.path.startsWith(`${path}/`))) throw new DOMException(`“${name}” holds channels of its own, so it can't go inside another yet`, "DataError")
  if (next === path) return { path, published: 0 }
  let published = 0
  for (const p of data.blocks()) {
    if (p.homeChannel === path) {
      p.homeChannel = next
      if (p.visibility !== "private") published++
    }
    if (p.channels) p.channels = p.channels.map(c => (c === path ? next : c))
  }
  // The record moves and keeps its id; into a channel of the same name, the two merge. A channel
  // only blocks name (say, brought back by a restore) gets its record now.
  const record = ensureChannel(path)
  const there = channelByPath(next)
  if (there) { there.order = [...there.order, ...record.order.filter(id => !there.order.includes(id))]; data.removeChannel(path) }
  else record.path = next
  if (into) ensureChannel(into)
  set(bump())
  return { path: next, published }
}

/**
 * Makes a channel: at the top, or inside a top-level channel. It is empty until something is moved or
 * added into it, and stays when it is emptied again. Returns its path.
 */
export function createChannel(inside?: string) {
  if (inside?.includes("/")) throw new DOMException("A channel inside a channel can't hold channels yet", "DataError")
  let n = 1, path = inside ? `${inside}/untitled` : "untitled"
  while (channelByPath(path)) path = `${inside ? `${inside}/` : ""}untitled-${++n}`
  ensureChannel(path)
  set(bump())
  return path
}

/** Removes an empty channel. One with blocks or channels in it is refused: move them out first. */
export function deleteChannel(path: string) {
  if (data.blocks().some(p => channelsOf(p).some(c => c === path || c.startsWith(`${path}/`))) || data.channels().some(c => c.path.startsWith(`${path}/`)))
    throw new DOMException(`“${path.replace("/", " › ")}” is not empty: move what is in it out first`, "DataError")
  data.removeChannel(path)
  set(bump())
}

/** Takes a block out of a channel. Its first channel stays: moving it (moveBlock) changes that. */
export function uncollect(id: string, path: string) {
  const doc = byId(id)
  if (!doc?.channels?.includes(path)) return { removed: false }
  doc.channels = doc.channels.filter(c => c !== path)
  set(bump())
  return { removed: true }
}

/**
 * Connects one block to another as a whole, with an optional line on why. Yours to make: it is
 * evidence, so no agent tool does it. Like the text, it changes only a private block here; a block
 * other people see is changed through the steps that ask first.
 */
export function connectDocs(id: string, toId: string, why?: string) {
  const doc = byId(id), target = byId(toId)
  if (!doc || !target || !isBlock(doc) || !isBlock(target)) throw new DOMException("Only blocks connect to blocks", "DataError")
  if (doc.id === target.id) throw new DOMException("A block does not connect to itself", "DataError")
  if (doc.visibility !== "private") throw new DOMException("Connecting changes what others see; it is not part of this wireframe yet", "NotAllowedError")
  if (doc.connect?.some(c => c.to === target.slug)) return { added: false }
  doc.connect = [...(doc.connect ?? []), { to: target.slug, ...(why?.trim() ? { why: why.trim() } : {}) }]
  doc.updated = new Date().toISOString().slice(0, 10)
  set(bump())
  return { added: true }
}

/** Says why a connection is there, or clears it. */
export function setWhy(id: string, toSlug: string, why: string) {
  const doc = byId(id)
  const c = doc?.connect?.find(c => c.to === toSlug)
  if (!doc || !c || doc.visibility !== "private") return
  if (why.trim()) c.why = why.trim(); else delete c.why
  set(bump())
}

/** Takes a whole-block connection away. A link in the text is removed by editing the text. */
export function disconnect(id: string, toSlug: string) {
  const doc = byId(id)
  if (!doc?.connect || doc.visibility !== "private") return
  doc.connect = doc.connect.filter(c => c.to !== toSlug)
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

/** Pinned pages show on top of the repository; unread ones show in weight until opened; archived ones leave the tree. */
export const marks = { pinned: new Set<string>(), unread: new Set<string>([fixtureIds.dusk]), archived: new Set<string>() }
const flip = (set: Set<string>, id: string, on = !set.has(id)) => { if (on) set.add(id); else set.delete(id); set_(bump()) }
const set_ = (patch: Partial<State>) => set(patch)

export const togglePin = (id: string) => flip(marks.pinned, id)
export const toggleUnread = (id: string) => flip(marks.unread, id)
export const toggleArchive = (id: string) => {
  flip(marks.archived, id)
  if (marks.archived.has(id)) marks.pinned.delete(id)
}

/** Renames a page and keeps its slug so links and connections still resolve. */
export function renameDoc(id: string, title: string) {
  const doc = byId(id)
  if (!doc) return
  doc.title = title.trim()
  doc.updated = new Date().toISOString().slice(0, 10)
  set(bump())
}

/** Removes a page from the vault. Taking a published one down from the repository is its own step. */
export function deleteDoc(id: string) {
  data.removeDoc(id)
  for (const s of Object.values(marks)) s.delete(id)
  const wasOpen = state.view.kind === "doc" && state.view.id === id
  // Take it out of history; the position moves back one if it was at or before where we are.
  const idx = state.history.indexOf(id)
  const history = state.history.filter(h => h !== id)
  const at = idx >= 0 && idx <= state.at ? state.at - 1 : state.at
  set({ ...bump(), history, at, ...(state.reveal?.target === id ? { reveal: null } : {}) })
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
 * Renames a channel by path: every page in it is refiled under the new
 * name. Folders are the owner's words; a published page's address follows on its next publish.
 */
export function renameFolder(path: string, name: string) {
  const next = name.trim().toLowerCase().replace(/\s+/g, "-")
  let published = 0
  const to = [...path.split("/").slice(0, -1), next].join("/")
  if (to !== path && channelByPath(to)) throw new DOMException(`There is already a channel “${to.replace("/", " › ")}”`, "DataError")
  // The record keeps its id; the channels inside it follow.
  for (const c of data.channels()) if (c.path === path || c.path.startsWith(`${path}/`)) c.path = to + c.path.slice(path.length)
  for (const p of data.blocks()) {
    // A channel of your own is renamed wherever a block was collected into it.
    if (p.channels) p.channels = p.channels.map(c => (c === path ? to : c.startsWith(`${path}/`) ? to + c.slice(path.length) : c))
    if (!p.homeChannel || (p.homeChannel !== path && !p.homeChannel.startsWith(`${path}/`))) continue
    p.homeChannel = to + p.homeChannel.slice(path.length)
    if (p.visibility !== "private") published++
  }
  set(bump())
  return { published }
}

// ─── History: restore, revert, save, sessions (flows/history.md) ─────────────────────────────

const bodyReplacements = new WeakMap<Doc, number>()
export const bodyRevision = (doc: Doc) => bodyReplacements.get(doc) ?? 0

function markRestored(doc: Doc) {
  bodyReplacements.set(doc, bodyRevision(doc) + 1)
  set({ ...bump(), restored: { id: doc.id, n: bodyRevision(doc) } })
}

/**
 * Brings a private block back to an earlier version. History is never rewritten: the restore is a
 * new change, by whoever restored it, so it can itself be undone the same way. A block other people
 * see changes only through the steps that ask first, so it is refused here.
 */
export function restoreVersion(id: string, version: string, reason?: string) {
  const doc = byId(id), s = snapshotAt(version)
  if (!doc) throw new DOMException("There is no such page", "NotFoundError")
  if (!s || !linesFor(id).some(line => line.after === version)) throw new DOMException("There is no such version for this file", "NotFoundError")
  if (doc.visibility !== "private") throw new DOMException("Restoring changes what others see; it asks first, which is not part of this wireframe yet", "NotAllowedError")
  applySnapshot(doc, s)
  for (const c of channelsOf(doc)) ensureChannel(c)
  doc.updated = new Date().toISOString().slice(0, 10)
  pendingChange = { op: "restore", reason: reason?.trim() || `Restored version ${version}` }
  markRestored(doc)
  return { id: doc.id, version, by: actor().name }
}

/**
 * Undoes one change, as `git revert` does: only the parts of the page that change touched go back,
 * and later changes to other parts stay. If a later change touched the same part, it is refused, and
 * restoring a whole version is the way. Like a restore, it is a new change, so it can be undone too.
 */
export function revertChange(lineId: string) {
  const line = changeById(lineId)
  if (!line) throw new DOMException("There is no such change", "NotFoundError")
  const doc = byId(line.node)
  if (!doc) throw new DOMException("That page is gone; nothing to revert", "NotFoundError")
  if (doc.visibility !== "private") throw new DOMException("Reverting changes what others see; it asks first, which is not part of this wireframe yet", "NotAllowedError")
  if (!line.before || line.op === "create") throw new DOMException("This change made the page: to undo it, delete the page", "DataError")
  const before = snapshotAt(line.before)!, after = snapshotAt(line.after)!, now = snap(doc)
  const fields = line.fields as (keyof Snapshot)[]
  if (!fields.length) throw new DOMException("This change changed nothing to revert", "DataError")
  const later = fields.filter(f => JSON.stringify(now[f]) !== JSON.stringify(after[f]))
  const named = [...new Set(later.map(f => ({ body: "text", homeChannel: "home channel", connect: "connections" } as Record<string, string>)[f] ?? f))]
  if (later.length) throw new DOMException(`A later change also touched its ${named.join(" and ")}: restore a whole version instead`, "DataError")
  applySnapshot(doc, { ...now, ...Object.fromEntries(fields.map(f => [f, before[f]])) } as Snapshot)
  for (const c of channelsOf(doc)) ensureChannel(c)
  doc.updated = new Date().toISOString().slice(0, 10)
  pendingChange = { op: "revert", reason: `Reverted “${line.summary}” (${new Date(line.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` }
  markRestored(doc)
  return { id: doc.id, reverted: line.id, fields }
}

/** Opens the open page's history card on one change. */
export const focusHistory = (id: string, line: string) => set({ historyFocus: { id, line, n: (state.historyFocus?.n ?? 0) + 1 } })

/** Names the repository as it is now, so you or an agent can come back to it. It changes nothing. */
export function saveNow(name: string, note?: string) {
  if (!name.trim()) throw new DOMException("A save needs a name", "DataError")
  const line = saveJournal(name, note)
  set(bump())
  return { name: line.name, seq: line.seq }
}

/** An agent finishing a task: what it did, and the dead ends a later agent should not retry. */
export function finishSession(done: string, deadEnds: DeadEnd[] = []) {
  const who = actor()
  if (who.kind !== "agent") throw new DOMException("Sessions are written by agents, when they finish a task", "NotAllowedError")
  if (!done.trim()) throw new DOMException("Say in one line what was done", "DataError")
  const line = recordSession(who, done, deadEnds)
  set(bump())
  return { session: line.id, changes: line.changes.length, deadEnds: line.deadEnds.length }
}

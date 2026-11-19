import { bySlug } from "@/data/workspace-data"
// The notification center's record: what agents did through the page's WebMCP tools, and the
// workspace's own notices. Kept in memory for the wireframe, newest first, a week at most.
import { useSyncExternalStore } from "react"

export type NotificationKind = "agent" | "system"
export type NotificationItem = {
  id: string
  kind: NotificationKind
  title: string
  detail?: string
  at: number
  read: boolean
  tone?: "error" | "info"
  /** A block it is about, opened from the item. */
  ref?: string
}

const WEEK = 7 * 24 * 60 * 60 * 1000
const now = Date.now()
let items: NotificationItem[] = [
  { id: "n1", kind: "agent", title: "Searched your vault for “slow software”", detail: "workspace.search · 3 matches", at: now - 6 * 60_000, read: false },
  { id: "n2", kind: "agent", title: "Saved “Graph sketches” as private", detail: "workspace.save-draft", at: now - 2 * 3600_000, read: false, ref: bySlug("graph-sketches")?.id },
  { id: "n3", kind: "system", title: "Your vault is up to date", detail: "Nothing waiting to publish", at: now - 26 * 3600_000, read: true },
]
const listeners = new Set<() => void>()
const emit = () => { items = items.filter(i => now - i.at < WEEK || Date.now() - i.at < WEEK); listeners.forEach(l => l()) }

export function record(item: Omit<NotificationItem, "id" | "at" | "read">) {
  items = [{ ...item, id: crypto.randomUUID(), at: Date.now(), read: false }, ...items].slice(0, 100)
  emit()
}
export function markRead(kind: NotificationKind) {
  if (!items.some(i => i.kind === kind && !i.read)) return
  items = items.map(i => (i.kind === kind ? { ...i, read: true } : i))
  emit()
}
export function remove(id: string) { items = items.filter(i => i.id !== id); emit() }
export function clearAll() { items = []; emit() }

export const useNotifications = () =>
  useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => items)

export function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

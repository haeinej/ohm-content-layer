// Comments on a page, kept in memory for the wireframe.
import { useSyncExternalStore } from "react"

export type Comment = { id: string; quote: string; text: string; at: string }

const byDoc = new Map<string, Comment[]>()
const listeners = new Set<() => void>()
let version = 0

export function addComment(docId: string, c: { quote: string; text: string }) {
  const list = byDoc.get(docId) ?? []
  byDoc.set(docId, [...list, { id: crypto.randomUUID(), at: new Date().toISOString(), ...c }])
  version++
  listeners.forEach(l => l())
}

export function useComments(docId: string): Comment[] {
  useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => version)
  return byDoc.get(docId) ?? []
}

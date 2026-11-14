// The one search path. The overlay and the `workspace.search` WebMCP tool both call `search`.
// To connect a real search service later, call `setSearchProvider` with a function of the same shape:
// for example one that calls a vault service, or a tool another origin exposes through WebMCP.
import { all, type Doc, type Kind } from "./sample"

export type SearchScope = "all" | "vault" | "cortex"
export type SearchInput = { query: string; scope?: SearchScope; limit?: number }
export type SearchHit = { id: string; title: string; kind: Kind; label: string; excerpt: string }
export type SearchProvider = (input: SearchInput, signal?: AbortSignal) => Promise<SearchHit[]>

const inScope = (doc: Doc, scope: SearchScope) =>
  scope === "all" || (scope === "vault" ? doc.kind === "post" : doc.kind !== "post")

const excerpt = (body: string, q: string) => {
  const text = body.replace(/^#.*$/m, "").replace(/\s+/g, " ").trim()
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  const start = Math.max(0, at - 30)
  return (start > 0 ? "…" : "") + text.slice(start, start + 90) + (text.length > start + 90 ? "…" : "")
}

/** In memory, over the synthetic data. */
const local: SearchProvider = async ({ query, scope = "all", limit = 20 }) => {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return all
    .filter(d => inScope(d, scope))
    .map(d => ({ d, score: (d.title.toLowerCase().includes(q) ? 2 : 0) + (d.body.toLowerCase().includes(q) ? 1 : 0) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || b.d.updated.localeCompare(a.d.updated))
    .slice(0, limit)
    .map(({ d }) => ({ id: d.id, title: d.title, kind: d.kind, label: d.sublabel ? `${d.label} › ${d.sublabel}` : d.label, excerpt: excerpt(d.body, q) }))
}

let provider: SearchProvider = local

export function setSearchProvider(next: SearchProvider | null) {
  provider = next ?? local
}

export function search(input: SearchInput, signal?: AbortSignal): Promise<SearchHit[]> {
  if (!input.query || input.query.length > 200) {
    return Promise.reject(new DOMException("query must be 1–200 characters", "DataError"))
  }
  return provider(input, signal)
}

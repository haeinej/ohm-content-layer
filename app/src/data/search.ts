import type { Kind } from "./workspace-model"
import { getSource } from "./workspace-data"
import { searchInput } from "./source"

export type SearchScope = "all" | "vault" | "cortex" | "people" | "settings"
export type SearchInput = { query: string; scope?: SearchScope; limit?: number }
export type SearchHit = { id: string; title: string; kind: Kind | "person" | "setting"; label: string; excerpt: string }
export type SearchProvider = (input: SearchInput, signal?: AbortSignal) => Promise<SearchHit[]>

/** Both the overlay and the WebMCP step call this path. */
export async function search(input: SearchInput, signal?: AbortSignal): Promise<SearchHit[]> {
  searchInput(input)
  return getSource().search(input, signal)
}

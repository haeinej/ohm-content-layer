import type { Kind } from "./sample"
import { sampleSource } from "./sample-source"
import { searchInput } from "./source"

export type SearchScope = "all" | "vault" | "cortex" | "people" | "settings"
export type SearchInput = { query: string; scope?: SearchScope; limit?: number }
export type SearchHit = { id: string; title: string; kind: Kind | "person" | "setting"; label: string; excerpt: string }
export type SearchProvider = (input: SearchInput, signal?: AbortSignal) => Promise<SearchHit[]>

let provider: SearchProvider | null = null

export function setSearchProvider(next: SearchProvider | null) {
  provider = next
}

/** Both the overlay and the WebMCP step call this path. */
export async function search(input: SearchInput, signal?: AbortSignal): Promise<SearchHit[]> {
  searchInput(input)
  return (provider ?? sampleSource.search)(input, signal)
}

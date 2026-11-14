import { useEffect, useState } from "react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { search, type SearchHit, type SearchScope } from "@/data/search"
import { open, setSearchOpen, useWorkspace } from "./store"

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "vault", label: "Vault" },
  { id: "cortex", label: "Cortex" },
]

/** Search, as an overlay above the screen. It goes through `search`, the same path as the workspace.search tool. */
export function SearchOverlay() {
  const { searchOpen } = useWorkspace()
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<SearchScope>("all")
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (!query.trim()) return setHits([])
    const ac = new AbortController()
    const t = setTimeout(() => {
      search({ query, scope, limit: 20 }, ac.signal).then(h => !ac.signal.aborted && setHits(h)).catch(() => setHits([]))
    }, 120)
    return () => { clearTimeout(t); ac.abort() }
  }, [query, scope])

  const groups = [
    { name: "Vault", list: hits.filter(h => h.kind === "post") },
    { name: "Cortex", list: hits.filter(h => h.kind !== "post") },
  ].filter(g => g.list.length)

  return (
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="Search" description="Search the vault and the cortex">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search the vault and the cortex" value={query} onValueChange={setQuery} />
        <div role="radiogroup" aria-label="Where to search" className="flex gap-1 px-3 pt-2">
          {SCOPES.map(s => (
            <Button key={s.id} size="xs" role="radio" aria-checked={scope === s.id}
              variant={scope === s.id ? "secondary" : "ghost"} onClick={() => setScope(s.id)}>
              {s.label}
            </Button>
          ))}
        </div>
        <CommandList>
          {query.trim() && <CommandEmpty>Nothing matches</CommandEmpty>}
          {groups.map(g => (
            <CommandGroup key={g.name} heading={g.name}>
              {g.list.map(h => (
                <CommandItem key={h.id} value={h.id} onSelect={() => open(h.id)} className="flex-col items-start gap-0.5">
                  <span className="text-body">{h.title}</span>
                  <span className="text-small text-muted-foreground">{h.label} · {h.excerpt}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <p className="px-4 py-2 text-small text-muted-foreground">Searches through <code>workspace.search</code></p>
      </Command>
    </CommandDialog>
  )
}

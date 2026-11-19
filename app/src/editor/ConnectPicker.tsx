// Finding a block to connect to: a field, then the blocks that match it, through the one search path
// (data/search.ts). With nothing typed, the blocks you changed most recently. Used by the selection
// toolbar's Connect and by + Connect in a block's connections card.
import { useEffect, useId, useRef, useState } from "react"
import { FileTextIcon } from "lucide-react"
import { Icon } from "@/components/ui/icon"
import { byId, blocks, locationOf, titleOf, type Doc } from "@/data/workspace-data"
import { search } from "@/data/search"
import { cn } from "@/lib/cn"

const recent = (fromId: string) => blocks.filter(p => p.id !== fromId).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6)

export function ConnectPicker({ fromId, onPick, onCancel, placeholder = "Connect to…", className }: {
  fromId: string
  onPick: (doc: Doc) => void
  onCancel: () => void
  placeholder?: string
  className?: string
}) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Doc[]>(() => recent(fromId))
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    const q = query.trim()
    setAt(0)
    if (!q) { setHits(recent(fromId)); return }
    const ac = new AbortController()
    search({ query: q, scope: "vault", limit: 8 }, ac.signal)
      .then(found => !ac.signal.aborted && setHits(found.map(h => byId(h.id)).filter((d): d is Doc => !!d && d.id !== fromId)))
      .catch(() => {})
    return () => ac.abort()
  }, [query, fromId])

  return (
    <div className={cn("flex w-80 flex-col", className)}>
      <input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder} aria-label="Find a block to connect to"
        role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-activedescendant={hits[at] ? `${listId}-${hits[at].id}` : undefined}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt(i => Math.min(i + 1, hits.length - 1)) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt(i => Math.max(i - 1, 0)) }
          else if (e.key === "Enter") { e.preventDefault(); if (hits[at]) onPick(hits[at]) }
          else if (e.key === "Escape") { e.preventDefault(); onCancel() }
        }}
        className="h-8 min-w-0 bg-transparent px-2.5 text-body outline-none placeholder:text-muted-foreground" />
      <ul id={listId} role="listbox" aria-label="Blocks" className="flex max-h-64 flex-col overflow-y-auto pt-1">
        {hits.length === 0 && <li className="px-2.5 py-2 text-small text-muted-foreground">No block matches.</li>}
        {hits.map((d, i) => (
          <li key={d.id} id={`${listId}-${d.id}`} role="option" aria-selected={i === at}>
            <button type="button" onMouseDown={e => e.preventDefault()} onMouseEnter={() => setAt(i)} onClick={() => onPick(d)}
              className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body", i === at && "bg-primary text-primary-foreground")}>
              <Icon icon={FileTextIcon} size="sm" className="flex-none opacity-70" />
              <span className="min-w-0 flex-1 truncate">{d.icon ? `${d.icon} ` : ""}{titleOf(d)}</span>
              <span className={cn("flex-none truncate text-small", i === at ? "opacity-80" : "text-muted-foreground")}>{locationOf(d).replace("/", " › ")}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

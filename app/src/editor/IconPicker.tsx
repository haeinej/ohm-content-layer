import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import { EMOJI } from "./emoji"

/** Pick a page icon: search, jump to a group, choose; or clear it. */
export function IconPicker({ value, onPick }: { value?: string; onPick: (emoji: string | undefined) => void }) {
  const [q, setQ] = useState("")
  const [group, setGroup] = useState(EMOJI[0].id)
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase()
    if (!words) return EMOJI.filter(g => g.id === group)
    return [{ id: "results", label: "Results", emoji: EMOJI.flatMap(g => g.emoji).filter(([, k]) => k.includes(words)) }]
  }, [q, group])
  return (
    <div className="flex w-72 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-small text-muted-foreground">Icon</span>
        {value && <Button size="xs" variant="ghost" onClick={() => onPick(undefined)}>Clear</Button>}
      </div>
      <Input autoFocus placeholder="Search" value={q} onChange={e => setQ(e.target.value)} className="h-8 text-body" />
      {!q && (
        <div role="tablist" className="flex justify-between">
          {EMOJI.map(g => (
            <button key={g.id} type="button" role="tab" aria-selected={group === g.id} aria-label={g.label} onClick={() => setGroup(g.id)}
              className="flex size-8 items-center justify-center rounded-md text-body opacity-60 transition-opacity hover:bg-muted aria-selected:bg-muted aria-selected:opacity-100">
              {g.emoji[0][0]}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-56 overflow-y-auto">
        {shown.map(g => (
          <section key={g.id}>
            <p className="px-1 pt-1 pb-1.5 text-small text-muted-foreground">{g.label}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emoji.map(([e, k]) => (
                <button key={e} type="button" title={k} aria-label={k} onClick={() => onPick(e)}
                  className={cn("flex size-8 items-center justify-center rounded-md text-[20px] leading-none transition-transform duration-(--ohm-duration-press) hover:bg-muted active:scale-90", value === e && "bg-muted")}>
                  {e}
                </button>
              ))}
            </div>
            {!g.emoji.length && <p className="px-1 py-2 text-small text-muted-foreground">No icons match</p>}
          </section>
        ))}
      </div>
    </div>
  )
}

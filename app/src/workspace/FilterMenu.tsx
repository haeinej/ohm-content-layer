// The repository's filter: narrow the tree and the graph by where a page came from, what it is,
// who it is for, when it was edited, and whether it is unread or pinned.
import { FilterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/cn"
import { activeCount, EDITED, NO_FILTERS, PLATFORMS, TYPES, type Filters } from "./filters"
import { setFilters, useWorkspace } from "./store"

const chip = "h-7 rounded-full px-2.5 text-small font-normal text-muted-foreground aria-pressed:bg-[color-mix(in_oklab,var(--ohm-green-light)_35%,var(--ohm-card))] aria-pressed:text-primary dark:aria-pressed:bg-(--ohm-green-light)/15 dark:aria-pressed:text-(--ohm-green-light)"

function toggle<T>(set: Set<T>, v: T) {
  const n = new Set(set)
  if (n.has(v)) n.delete(v); else n.add(v)
  return n
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <p className="px-1 text-small text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </section>
  )
}

export function FilterMenu({ className }: { className?: string }) {
  const { filters: f, scope } = useWorkspace()
  const n = activeCount(f)
  const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch })
  return (
    <Popover>
      <PopoverTrigger render={
        <Button size="icon-sm" variant="ghost" aria-label={n ? `Filter, ${n} on` : "Filter"} title="Filter"
          className={cn("relative text-muted-foreground aria-expanded:bg-muted aria-expanded:text-foreground", n > 0 && "text-primary dark:text-(--ohm-green-light)", className)} />
      }>
        <Icon icon={FilterIcon} size="sm" />
        {n > 0 && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary dark:bg-(--ohm-green-light)" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3 p-3">
        <div className="flex items-center justify-between">
          <span className="text-body font-medium">Filter</span>
          <Button size="xs" variant="ghost" disabled={!n} onClick={() => setFilters(NO_FILTERS)}>Clear</Button>
        </div>
        <Section title="Platform">
          {PLATFORMS.map(p => (
            <Button key={p.id} size="sm" variant="ghost" className={chip} aria-pressed={f.platform.has(p.id)} onClick={() => set({ platform: toggle(f.platform, p.id) })}>{p.label}</Button>
          ))}
        </Section>
        <Section title="Type">
          {TYPES.filter(t => (t.cortex ? scope.cortex : scope.vault)).map(t => (
            <Button key={t.id} size="sm" variant="ghost" className={chip} aria-pressed={f.type.has(t.id)} onClick={() => set({ type: toggle(f.type, t.id) })}>{t.label}</Button>
          ))}
        </Section>
        <Section title="Who it is for">
          {([["public", "Everyone"], ["friends", "Friends"], ["private", "Only you"]] as const).map(([v, label]) => (
            <Button key={v} size="sm" variant="ghost" className={chip} aria-pressed={f.visibility.has(v)} onClick={() => set({ visibility: toggle(f.visibility, v) })}>{label}</Button>
          ))}
        </Section>
        <Section title="Edited">
          {EDITED.map(e => (
            <Button key={e.id} size="sm" variant="ghost" className={chip} aria-pressed={f.edited === e.id} onClick={() => set({ edited: e.id })}>{e.label}</Button>
          ))}
        </Section>
        <Section title="Status">
          {([["unread", "Unread"], ["pinned", "Pinned"]] as const).map(([v, label]) => (
            <Button key={v} size="sm" variant="ghost" className={chip} aria-pressed={f.status.has(v)} onClick={() => set({ status: toggle(f.status, v) })}>{label}</Button>
          ))}
        </Section>
      </PopoverContent>
    </Popover>
  )
}

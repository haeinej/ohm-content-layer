import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/react"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { filterGroups, type InsertGroup, type InsertItem } from "./commands"
import { slashStore } from "./extensions"

/** The grouped list both menus show: section labels, then items with a quiet hint. */
export function InsertList({ groups, active, onPick, onHover }: {
  groups: InsertGroup[]; active: number; onPick: (i: InsertItem) => void; onHover?: (index: number) => void
}) {
  let n = -1
  if (!groups.length) return <p className="px-3 py-2 text-small text-muted-foreground">Nothing matches</p>
  return (
    <div role="listbox" aria-label="Insert" className="flex flex-col">
      {groups.map(g => (
        <div key={g.label} role="group" aria-label={g.label}>
          <p className="px-2.5 pt-2 pb-1 text-small text-muted-foreground">{g.label}</p>
          {g.items.map(item => {
            n += 1
            const index = n
            return (
              <button key={item.id} type="button" role="option" aria-selected={active === index} data-index={index}
                onMouseMove={() => onHover?.(index)} onMouseDown={e => e.preventDefault()} onClick={() => onPick(item)}
                className="ux-menu-row flex w-full items-center gap-2.5 text-left">
                <Icon icon={item.icon} size="sm" className="text-muted-foreground" />
                <span className="font-medium whitespace-nowrap">{item.label}</span>
                {item.hint && <span className="truncate text-muted-foreground">{item.hint}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const menuSurface = "rounded-2xl bg-popover p-1 text-popover-foreground shade-4 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-(--ohm-duration-open)"

/** The "/" menu: follows the caret, filters as you type, arrows and Enter to pick. */
export function SlashMenu() {
  const s = useSyncExternalStore(slashStore.subscribe, slashStore.get)
  const groups = filterGroups(s.query)
  const items = groups.flatMap(g => g.items)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => setActive(0), [s.query, s.open])
  const pick = (item: InsertItem | undefined) => {
    if (!item || !s.editor || !s.range) return
    item.run(s.editor, s.range)
    slashStore.close()
  }
  useEffect(() => {
    if (!s.open) { slashStore.onKey(null); return }
    slashStore.onKey(e => {
      if (e.key === "ArrowDown") { setActive(a => (a + 1) % Math.max(items.length, 1)); return true }
      if (e.key === "ArrowUp") { setActive(a => (a - 1 + items.length) % Math.max(items.length, 1)); return true }
      if (e.key === "Enter") { pick(items[active]); return true }
      return false
    })
  })
  useLayoutEffect(() => {
    if (!s.open || !s.rect) return
    const h = box.current?.offsetHeight ?? 320
    const below = s.rect.bottom + 6
    const top = below + h > window.innerHeight - 8 ? Math.max(8, s.rect.top - h - 6) : below
    setPos({ top, left: Math.min(s.rect.left, window.innerWidth - 340) })
  }, [s.open, s.rect, s.query])
  useEffect(() => {
    box.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (!s.open) return null
  return createPortal(
    <div ref={box} style={pos} className={cn(menuSurface, "fixed z-50 max-h-80 w-80 overflow-y-auto")}>
      <InsertList groups={groups} active={active} onHover={setActive} onPick={pick} />
    </div>,
    document.body,
  )
}

/** The + button's menu, opened from the toolbar. */
export function PlusMenu({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [active, setActive] = useState(-1)
  return (
    <div className="max-h-[min(420px,60vh)] w-80 overflow-y-auto">
      <InsertList groups={filterGroups("")} active={active} onHover={setActive} onPick={item => { item.run(editor); onClose() }} />
    </div>
  )
}

// The ⋯ on a page in the repository, as a session list has it: it shows on hover (and right-click opens
// the same menu), and its single-key shortcuts work while the menu is open or the row has focus.
// Open in ›, Pin, Mark as unread, Rename (in place), Move to section ›, Archive, Delete.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EllipsisIcon } from "lucide-react"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { byId, posts, titleOf } from "@/data/sample"
import {
  marks, moveDoc, open, setRepoMode, showGraph, toggleArchive, togglePin, toggleUnread, useWorkspace,
} from "./store"
import { InlineRename, requestDelete } from "./PageActions"
import { useLinkedHover } from "@/editor/LinkPreview"

type Row = { id: string; top: number; height: number; textLeft: number }
const isPage = (id?: string) => !!id && !id.includes(":") && !!byId(id)

export function RowMenu({ container }: { container: HTMLElement | null }) {
  const { rev } = useWorkspace()
  const linked = useLinkedHover()
  const [row, setRow] = useState<Row | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const place = useCallback((el: HTMLElement) => {
    if (!container) return
    const base = container.getBoundingClientRect(), r = el.getBoundingClientRect()
    // Where the row's name starts, so renaming in place lines up with it.
    const label = el.querySelector<HTMLElement>("span.truncate") ?? el
    setRow({ id: el.dataset.id!, top: r.top - base.top + container.scrollTop, height: r.height, textLeft: label.getBoundingClientRect().left - base.left })
  }, [container])

  // Follow the pointer over page rows; hold still while the menu is open.
  useEffect(() => {
    if (!container) return
    const rowOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>("[data-row-id], [data-slot=file-tree-item]")
    const move = (e: PointerEvent) => {
      if (menuOpen || renaming) return
      if ((e.target as HTMLElement).closest("[data-row-menu]")) return
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (el && isPage(id)) { el.dataset.id = id; place(el) } else setRow(null)
    }
    const leave = () => { if (!menuOpen && !renaming) setRow(null) }
    const context = (e: MouseEvent) => {
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (!el || !isPage(id)) return
      e.preventDefault()
      el.dataset.id = id
      place(el)
      setMenuOpen(true)
    }
    // Shortcuts on a focused row, without opening the menu.
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || menuOpen || renaming) return
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (!isPage(id)) return
      if (run(e.key.toLowerCase(), id!)) { e.preventDefault(); place(el!) }
    }
    container.addEventListener("pointermove", move)
    container.addEventListener("pointerleave", leave)
    container.addEventListener("contextmenu", context)
    container.addEventListener("keydown", key)
    return () => {
      container.removeEventListener("pointermove", move)
      container.removeEventListener("pointerleave", leave)
      container.removeEventListener("contextmenu", context)
      container.removeEventListener("keydown", key)
    }
  }) // re-binds with the latest state

  // Unread pages carry a dot; the tree is ohm-ui's, so the mark goes on by attribute.
  useEffect(() => {
    container?.querySelectorAll<HTMLElement>("[data-slot=file-tree-item]").forEach(el => {
      el.toggleAttribute("data-unread", marks.unread.has(el.dataset.id ?? ""))
      // The page a hovered [[link]] points to, shaded green.
      el.toggleAttribute("data-linked", !!linked && el.dataset.id === linked)
    })
  })

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const p of posts) { set.add(p.label); if (p.sublabel) set.add(`${p.label}/${p.sublabel}`) }
    return [...set].sort()
  }, [rev]) // eslint-disable-line react-hooks/exhaustive-deps

  /** One letter, one action. Returns whether it did something. */
  function run(k: string, id: string): boolean {
    const doc = byId(id)
    if (!doc) return false
    const post = doc.kind === "post"
    const done = (message: string) => notify({ message, tone: "info" })
    switch (k) {
      case "p": togglePin(id); done(marks.pinned.has(id) ? `Pinned “${titleOf(doc)}”` : `Unpinned “${titleOf(doc)}”`); break
      case "u": toggleUnread(id); break
      case "r": if (!post) return false; setRenaming(id); break
      case "a": if (!post) return false; toggleArchive(id); done(marks.archived.has(id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`); break
      case "d": if (!post) return false; requestDelete(id); break
      default: return false
    }
    setMenuOpen(false)
    return true
  }

  const doc = row ? byId(row.id) : undefined
  const post = doc?.kind === "post"
  const here = doc ? (doc.sublabel ? `${doc.label}/${doc.sublabel}` : doc.label) : ""

  return <>
    {row && doc && !renaming && (
      <div data-row-menu className="pointer-events-none absolute inset-x-0 z-10" style={{ top: row.top, height: row.height }}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`More for “${titleOf(doc)}”`}
              className="pointer-events-auto absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--ohm-duration-press) animate-in fade-in-0 hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground" />
          }>
            <Icon icon={EllipsisIcon} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" sideOffset={6} className="w-60"
            onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && run(e.key.toLowerCase(), doc.id)) e.preventDefault() }}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Open in</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem onClick={() => open(doc.id)}>This window</DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`${location.pathname}?open=${encodeURIComponent(doc.id)}`, "_blank", "noopener")}>New tab</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { open(doc.id); setRepoMode("graph"); showGraph() }}>Graph</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => run("p", doc.id)}>{marks.pinned.has(doc.id) ? "Unpin" : "Pin"}<DropdownMenuShortcut>P</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => run("u", doc.id)}>{marks.unread.has(doc.id) ? "Mark as read" : "Mark as unread"}<DropdownMenuShortcut>U</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem disabled={!post} onClick={() => run("r", doc.id)}>Rename<DropdownMenuShortcut>R</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!post}>Move to section</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                {folders.map(f => (
                  <DropdownMenuCheckboxItem key={f} checked={f === here} onCheckedChange={() => {
                    const [label, sublabel] = f.split("/")
                    moveDoc(doc.id, label, sublabel)
                    notify({ message: `Moved to ${f.replace("/", " › ")}`, tone: "info" })
                    setMenuOpen(false)
                  }}>{f.replace("/", " › ")}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!post} onClick={() => run("a", doc.id)}>{marks.archived.has(doc.id) ? "Restore" : "Archive"}<DropdownMenuShortcut>A</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem disabled={!post} variant="destructive" onClick={() => run("d", doc.id)}>Delete<DropdownMenuShortcut>D</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )}

    {/* Renaming in place: a field over the row's name, the text selected. */}
    {renaming && row && row.id === renaming && (
      <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: row.top, height: row.height, paddingInlineStart: row.textLeft - 7 }}>
        <InlineRename id={renaming} className="me-1 h-7 flex-1 text-body"
          onDone={() => setRenaming(null)} />
      </div>
    )}
  </>
}

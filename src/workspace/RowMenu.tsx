// The ⋯ on a page in the repository, as a session list has it: it shows on hover (and right-click opens
// the same menu), and its single-key shortcuts work while the menu is open or the row has focus.
// Open in ›, Pin, Mark as unread, Rename, Fork, Move to section ›, Archive, Delete.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EllipsisIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { byId, posts, titleOf } from "@/data/sample"
import {
  deleteDoc, forkDoc, marks, moveDoc, open, renameDoc, setRepoMode, showGraph, toggleArchive, togglePin, toggleUnread, useWorkspace,
} from "./store"

type Row = { id: string; top: number; height: number }
const isPage = (id?: string) => !!id && !id.includes(":") && !!byId(id)

export function RowMenu({ container }: { container: HTMLElement | null }) {
  const { rev } = useWorkspace()
  const [row, setRow] = useState<Row | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const draft = useRef("")

  const place = useCallback((el: HTMLElement) => {
    if (!container) return
    const base = container.getBoundingClientRect(), r = el.getBoundingClientRect()
    setRow({ id: el.dataset.id!, top: r.top - base.top + container.scrollTop, height: r.height })
  }, [container])

  // Follow the pointer over page rows; hold still while the menu is open.
  useEffect(() => {
    if (!container) return
    const rowOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>("[data-row-id], [data-slot=file-tree-item]")
    const move = (e: PointerEvent) => {
      if (menuOpen) return
      if ((e.target as HTMLElement).closest("[data-row-menu]")) return
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (el && isPage(id)) { el.dataset.id = id; place(el) } else setRow(null)
    }
    const leave = () => { if (!menuOpen) setRow(null) }
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
      if (e.metaKey || e.ctrlKey || e.altKey || menuOpen) return
      const el = rowOf(e.target)
      const id = el?.dataset.rowId ?? el?.dataset.id
      if (!isPage(id)) return
      if (run(e.key.toLowerCase(), id!)) e.preventDefault()
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
      case "r": if (!post) return false; draft.current = doc.title; setRenaming(id); break
      case "f": if (!post) return false; forkDoc(id); done(`Forked “${titleOf(doc)}” as a private page`); break
      case "a": if (!post) return false; toggleArchive(id); done(marks.archived.has(id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`); break
      case "d": if (!post) return false; setDeleting(id); break
      default: return false
    }
    setMenuOpen(false)
    return true
  }

  const doc = row ? byId(row.id) : undefined
  const post = doc?.kind === "post"
  const here = doc ? (doc.sublabel ? `${doc.label}/${doc.sublabel}` : doc.label) : ""
  const renameTarget = renaming ? byId(renaming) : undefined
  const deleteTarget = deleting ? byId(deleting) : undefined

  return <>
    {row && doc && (
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
            <DropdownMenuItem disabled={!post} onClick={() => run("f", doc.id)}>Fork<DropdownMenuShortcut>F</DropdownMenuShortcut></DropdownMenuItem>
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

    <Dialog open={!!renaming} onOpenChange={o => !o && setRenaming(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>{renameTarget?.visibility === "private" ? "Only you see this page." : "The title changes in your vault; your site shows it after you publish."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (renaming) { renameDoc(renaming, draft.current); setRenaming(null) } }}>
          <Input autoFocus defaultValue={renameTarget?.title} aria-label="Title" onChange={e => { draft.current = e.target.value }}
            onFocus={e => e.currentTarget.select()} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button type="submit">Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{deleteTarget && titleOf(deleteTarget)}”?</DialogTitle>
          <DialogDescription>
            {deleteTarget?.visibility === "private"
              ? "It is removed from your vault. This cannot be undone."
              : "It is removed from your vault. If it is published, taking it down from your repository is its own step, and copies others made stay where they are."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { if (deleting) { const t = deleteTarget && titleOf(deleteTarget); deleteDoc(deleting); notify({ message: `Deleted “${t}”`, tone: "info" }); setDeleting(null); setRow(null) } }}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

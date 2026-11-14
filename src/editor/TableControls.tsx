// Table controls, after the reference recording: a handle on each row's left and each column's top,
// each with its menu; bars below and beside the table to add a row or column; the table's own menu
// (from the block handle) lives in BlockMenu. Positions come from the table's DOM; every change is a
// ProseMirror command or transaction, so undo works and the page stays Markdown.
import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"
import { Fragment, type Node as PMNode } from "@tiptap/pm/model"
import {
  ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, EllipsisIcon, GripVerticalIcon, PlusIcon, Trash2Icon,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { me } from "@/workspace/store"

type Hover = { table: HTMLTableElement; row: number; col: number; rowRect: DOMRect; colRect: DOMRect; tableRect: DOMRect }

/** Where the table that holds a DOM cell starts, and the table node itself. */
function tableAt(editor: Editor, cell: Element) {
  const pos = editor.view.posAtDOM(cell, 0)
  const $pos = editor.state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === "table") return { node, pos: $pos.before(d), cellPos: pos }
  }
  return null
}

/** Puts the caret in a cell, so the built-in row and column commands act on it. */
function focusCell(editor: Editor, table: HTMLTableElement, row: number, col: number) {
  const cell = table.rows[row]?.cells[col]
  if (!cell) return false
  editor.chain().focus().setTextSelection(editor.view.posAtDOM(cell, 0)).run()
  return true
}

function replaceTable(editor: Editor, table: HTMLTableElement, build: (node: PMNode) => PMNode[]) {
  const found = tableAt(editor, table.rows[0].cells[0])
  if (!found) return
  const { node, pos } = found
  const rows = build(node)
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, node.type.create(node.attrs, Fragment.fromArray(rows))))
  editor.commands.focus()
}

const moveRow = (editor: Editor, table: HTMLTableElement, from: number, to: number) =>
  replaceTable(editor, table, node => {
    const rows: PMNode[] = []
    node.forEach(r => { rows.push(r) })
    const [r] = rows.splice(from, 1)
    rows.splice(to, 0, r)
    return rows
  })

const moveColumn = (editor: Editor, table: HTMLTableElement, from: number, to: number) =>
  replaceTable(editor, table, node => {
    const rows: PMNode[] = []
    node.forEach(row => {
      const cells: PMNode[] = []
      row.forEach(c => { cells.push(c) })
      const [c] = cells.splice(from, 1)
      cells.splice(to, 0, c)
      rows.push(row.type.create(row.attrs, Fragment.fromArray(cells)))
    })
    return rows
  })

/** Clears set widths, so columns share the table evenly (or one column fits its contents). */
const clearWidths = (editor: Editor, table: HTMLTableElement, only?: number) =>
  replaceTable(editor, table, node => {
    const rows: PMNode[] = []
    node.forEach(row => {
      const cells: PMNode[] = []
      row.forEach((c, _o, i) => { cells.push(only === undefined || i === only ? c.type.create({ ...c.attrs, colwidth: null }, c.content) : c) })
      rows.push(row.type.create(row.attrs, Fragment.fromArray(cells)))
    })
    return rows
  })

export function LastEdited({ date }: { date: string }) {
  return (
    <>
      <DropdownMenuSeparator />
      <div className="flex flex-col gap-0.5 px-3 py-1.5">
        <span className="text-small text-muted-foreground">Last edited by {me.name}</span>
        <span className="text-small text-muted-foreground">{date}</span>
      </div>
    </>
  )
}

const item = "flex items-center gap-2"
const handle = "flex items-center justify-center rounded-md text-muted-foreground transition-[opacity,background-color] duration-(--ohm-duration-state) hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"

export function TableControls({ editor, container, updated }: { editor: Editor; container: HTMLElement | null; updated: string }) {
  const [hover, setHover] = useState<Hover | null>(null)
  const [menu, setMenu] = useState<"row" | "col" | null>(null)

  const measure = useCallback((table: HTMLTableElement, row: number, col: number) => {
    if (!container) return
    const base = container.getBoundingClientRect()
    const rel = (r: DOMRect) => new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height)
    const tr = table.rows[row], cell = tr?.cells[col]
    if (!tr || !cell) return
    setHover({ table, row, col, rowRect: rel(tr.getBoundingClientRect()), colRect: rel(cell.getBoundingClientRect()), tableRect: rel(table.getBoundingClientRect()) })
  }, [container])

  // Follow the pointer over a table; keep the last position while a menu is open.
  useEffect(() => {
    if (!container) return
    const onMove = (e: PointerEvent) => {
      if (menu) return
      const target = e.target as HTMLElement
      if (target.closest("[data-table-control]")) return
      const cell = target.closest("td, th") as HTMLTableCellElement | null
      const table = cell?.closest("table") as HTMLTableElement | null
      if (!cell || !table || !container.contains(table)) {
        // Leave the controls up while the pointer is in the margin around the table.
        if (hover) {
          const base = container.getBoundingClientRect()
          const x = e.clientX - base.left, y = e.clientY - base.top, r = hover.tableRect
          if (x > r.left - 32 && x < r.right + 24 && y > r.top - 24 && y < r.bottom + 24) return
        }
        return setHover(null)
      }
      measure(table, (cell.parentElement as HTMLTableRowElement).rowIndex, cell.cellIndex)
    }
    container.addEventListener("pointermove", onMove)
    return () => container.removeEventListener("pointermove", onMove)
  }, [container, menu, hover, measure])

  // Re-measure after edits (rows added, moved, deleted).
  useEffect(() => {
    const update = () => {
      if (!hover) return
      if (!hover.table.isConnected) return setHover(null)
      const row = Math.min(hover.row, hover.table.rows.length - 1)
      const col = Math.min(hover.col, (hover.table.rows[row]?.cells.length ?? 1) - 1)
      measure(hover.table, row, col)
    }
    editor.on("update", update)
    return () => { editor.off("update", update) }
  }, [editor, hover, measure])

  if (!hover || !editor.isEditable) return null
  const { table, row, col, rowRect, colRect, tableRect } = hover
  const rows = table.rows.length, cols = table.rows[0]?.cells.length ?? 0
  const run = (fn: () => void) => { fn(); setMenu(null) }
  const at = (r: number, c: number) => focusCell(editor, table, r, c)

  return (
    <div data-table-control className="pointer-events-none absolute inset-0 z-10">
      {/* Row handle */}
      <DropdownMenu open={menu === "row"} onOpenChange={o => setMenu(o ? "row" : null)}>
        <DropdownMenuTrigger render={
          <button type="button" aria-label={`Row ${row + 1}`} style={{ left: tableRect.left - 22, top: rowRect.top + rowRect.height / 2 - 11 }}
            className={`${handle} pointer-events-auto absolute h-[22px] w-4 animate-in fade-in-0`} />
        }>
          <Icon icon={GripVerticalIcon} size="xs" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-52">
          <DropdownMenuItem className={item} onClick={() => run(() => at(row, col) && editor.chain().focus().addRowBefore().run())}><Icon icon={PlusIcon} size="sm" />Insert row above</DropdownMenuItem>
          <DropdownMenuItem className={item} onClick={() => run(() => at(row, col) && editor.chain().focus().addRowAfter().run())}><Icon icon={PlusIcon} size="sm" />Insert row below</DropdownMenuItem>
          <DropdownMenuItem className={item} disabled={row === 0} onClick={() => run(() => moveRow(editor, table, row, row - 1))}><Icon icon={ArrowUpIcon} size="sm" />Move row up</DropdownMenuItem>
          <DropdownMenuItem className={item} disabled={row === rows - 1} onClick={() => run(() => moveRow(editor, table, row, row + 1))}><Icon icon={ArrowDownIcon} size="sm" />Move row down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} variant="destructive" onClick={() => run(() => at(row, col) && editor.chain().focus().deleteRow().run())}><Icon icon={Trash2Icon} size="sm" />Delete row</DropdownMenuItem>
          <LastEdited date={updated} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Column handle */}
      <DropdownMenu open={menu === "col"} onOpenChange={o => setMenu(o ? "col" : null)}>
        <DropdownMenuTrigger render={
          <button type="button" aria-label={`Column ${col + 1}`} style={{ left: colRect.left + colRect.width / 2 - 12, top: tableRect.top - 12 }}
            className={`${handle} pointer-events-auto absolute h-3 w-6 animate-in fade-in-0`} />
        }>
          <Icon icon={EllipsisIcon} size="xs" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="bottom" className="w-60">
          <DropdownMenuItem className={item} onClick={() => run(() => at(row, col) && editor.chain().focus().addColumnBefore().run())}><Icon icon={PlusIcon} size="sm" />Insert column left</DropdownMenuItem>
          <DropdownMenuItem className={item} onClick={() => run(() => at(row, col) && editor.chain().focus().addColumnAfter().run())}><Icon icon={PlusIcon} size="sm" />Insert column right</DropdownMenuItem>
          <DropdownMenuItem className={item} disabled={col === 0} onClick={() => run(() => moveColumn(editor, table, col, col - 1))}><Icon icon={ArrowLeftIcon} size="sm" />Move column left</DropdownMenuItem>
          <DropdownMenuItem className={item} disabled={col === cols - 1} onClick={() => run(() => moveColumn(editor, table, col, col + 1))}><Icon icon={ArrowRightIcon} size="sm" />Move column right</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => run(() => clearWidths(editor, table, col))}>Fit column to contents</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run(() => clearWidths(editor, table))}>Distribute columns evenly</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} variant="destructive" onClick={() => run(() => at(row, col) && editor.chain().focus().deleteColumn().run())}><Icon icon={Trash2Icon} size="sm" />Delete column</DropdownMenuItem>
          <LastEdited date={updated} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Add a row, add a column */}
      <button type="button" aria-label="Add row" style={{ left: tableRect.left, top: tableRect.bottom + 4, width: tableRect.width }}
        onClick={() => { at(rows - 1, 0); editor.chain().focus().addRowAfter().run() }}
        className="pointer-events-auto absolute flex h-4 items-center justify-center rounded-sm bg-muted text-muted-foreground opacity-60 transition-opacity duration-(--ohm-duration-state) hover:opacity-100 animate-in fade-in-0">
        <Icon icon={PlusIcon} size="xs" />
      </button>
      <button type="button" aria-label="Add column" style={{ left: tableRect.right + 4, top: tableRect.top, height: tableRect.height }}
        onClick={() => { at(0, cols - 1); editor.chain().focus().addColumnAfter().run() }}
        className="pointer-events-auto absolute flex w-4 items-center justify-center rounded-sm bg-muted text-muted-foreground opacity-60 transition-opacity duration-(--ohm-duration-state) hover:opacity-100 animate-in fade-in-0">
        <Icon icon={PlusIcon} size="xs" />
      </button>
    </div>
  )
}

// The toolbar that floats over selected text: ask for a change, connect, marks, turn into.
import { useEffect, useRef, useState } from "react"
import { useEditorState, type Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import { CellSelection } from "@tiptap/pm/tables"
import type { LucideIcon } from "lucide-react"
import {
  ArrowUpIcon, BoldIcon, CheckIcon, ChevronDownIcon, CodeIcon, ItalicIcon, LinkIcon, MicIcon,
  ScanTextIcon, StrikethroughIcon, UnderlineIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/cn"
import { titleOf, type Doc } from "@/data/sample"
import { BLOCK_TYPES, currentBlock } from "./commands"
import { ConnectPicker } from "./ConnectPicker"
import { REF } from "./extensions"

/** Whether the selection touches a link or mention already in the text: those are not connected again. */
function overlapsLink(editor: Editor) {
  const { $from, from, to } = editor.state.selection
  const start = $from.start()
  for (const m of $from.parent.textContent.matchAll(REF)) {
    const a = start + m.index!, b = a + m[0].length
    if (from < b && to > a) return true
  }
  return false
}

/**
 * Turns the selected words into a link to another block: `[[slug|the words]]`, or `[[slug]]` when the
 * words are its title. The connection is tied to the passage that justifies it, which makes it
 * evidence anyone can check.
 */
function connectSelection(editor: Editor, target: Doc) {
  const { from, to } = editor.state.selection
  const words = editor.state.doc.textBetween(from, to, " ").replace(/[[\]|\n]/g, "").replace(/\s+/g, " ").trim()
  const link = !words || words === titleOf(target) ? `[[${target.slug}]]` : `[[${target.slug}|${words}]]`
  editor.chain().focus().insertContentAt({ from, to }, link).run()
  // Put the caret one character past the link, so it reads as connected words at once rather than as
  // the raw text you edit; at the end of a line, that character is a space.
  const end = from + link.length
  const next = editor.state.doc.textBetween(end, Math.min(end + 1, editor.state.selection.$from.end()))
  if (!next) editor.chain().insertContentAt(end, " ").run()
  editor.commands.setTextSelection(end + 1)
  notify({ message: `Connected to “${titleOf(target)}”`, tone: "info" })
}

const bar = "flex items-center gap-0.5 rounded-full bg-popover p-1 text-popover-foreground shade-4 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-(--ohm-duration-open) ease-(--ohm-ease-out)"
const sep = <span aria-hidden className="mx-1 h-4 w-px bg-border" />

function Mark({ label, icon, active, onClick, shortcut }: { label: string; icon: LucideIcon; active: boolean; onClick: () => void; shortcut: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button size="icon-sm" variant="ghost" aria-label={label} aria-pressed={active} onMouseDown={e => e.preventDefault()} onClick={onClick}
          className="size-7 rounded-full text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground" />
      }>
        <Icon icon={icon} size="sm" />
      </TooltipTrigger>
      <TooltipContent side="top">{label} <span className="text-muted-foreground">{shortcut}</span></TooltipContent>
    </Tooltip>
  )
}

/** A one-line field inside the floating bar, for asking an agent or writing a comment. */
function InlineField({ placeholder, onSend, onCancel, mic }: { placeholder: string; onSend: (text: string) => void; onCancel: () => void; mic?: boolean }) {
  const [text, setText] = useState("")
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <form className="flex w-80 items-center gap-1 ps-3" onSubmit={e => { e.preventDefault(); if (text.trim()) onSend(text.trim()) }}>
      <input ref={ref} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onCancel() } }}
        className="h-7 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground" />
      {mic && <Button type="button" size="icon-sm" variant="ghost" aria-label="Dictate" className="size-7 rounded-full text-muted-foreground"
        onClick={() => notify({ message: "Dictation is not part of this wireframe", tone: "info" })}><Icon icon={MicIcon} size="sm" /></Button>}
      <Button type="submit" size="icon-sm" aria-label="Send" disabled={!text.trim()} className="size-7 rounded-full"><Icon icon={ArrowUpIcon} size="sm" /></Button>
    </form>
  )
}

export function SelectionToolbar({ editor, docId }: { editor: Editor; docId: string }) {
  const [mode, setMode] = useState<"tools" | "ask" | "connect">("tools")
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"),
      strike: e.isActive("strike"), code: e.isActive("code"), block: currentBlock(e).id,
      empty: e.state.selection.empty,
      cells: e.state.selection instanceof CellSelection,
      // A connection is one passage: the selection has to sit inside one paragraph, heading or item.
      onePassage: e.state.selection.$from.sameParent(e.state.selection.$to) && !overlapsLink(e),
    }),
  })
  useEffect(() => { if (s.empty) setMode("tools") }, [s.empty])
  const block = BLOCK_TYPES.find(b => b.id === s.block)!

  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 10 }}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !e.isActive("image")}>
      <div className={cn(bar, mode === "connect" && "flex-col items-stretch rounded-2xl p-1.5")}
        onMouseDown={e => { if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault() }}>
        {mode === "connect" ? (
          <ConnectPicker fromId={docId} placeholder="Connect these words to…" onCancel={() => { setMode("tools"); editor.commands.focus() }}
            onPick={target => { setMode("tools"); connectSelection(editor, target) }} />
        ) : mode === "ask" ? (
          <InlineField placeholder="Ask for a change…" onCancel={() => setMode("tools")}
            onSend={() => { notify({ message: "Asking an agent arrives once one is connected through WebMCP", tone: "info" }); setMode("tools") }} />

        ) : <>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 rounded-full px-2.5 font-normal" onClick={() => setMode("ask")}>
            <Icon icon={ScanTextIcon} size="sm" /> Ask for change
          </Button>
          {s.onePassage && !s.cells && (
            <Tooltip>
              <TooltipTrigger render={
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 rounded-full px-2.5 font-normal" onClick={() => setMode("connect")} />
              }>
                <Icon icon={LinkIcon} size="sm" /> Connect
              </TooltipTrigger>
              <TooltipContent side="top">Link these words to another block <span className="text-muted-foreground">[[</span></TooltipContent>
            </Tooltip>
          )}
          {sep}
          <Mark label="Bold" shortcut="⌘B" icon={BoldIcon} active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <Mark label="Italic" shortcut="⌘I" icon={ItalicIcon} active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <Mark label="Underline" shortcut="⌘U" icon={UnderlineIcon} active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <Mark label="Strikethrough" shortcut="⌘⇧S" icon={StrikethroughIcon} active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <Mark label="Code" shortcut="⌘E" icon={CodeIcon} active={s.code} onClick={() => editor.chain().focus().toggleCode().run()} />
          {!s.cells && <>
          {sep}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2.5 font-normal" />}>
              {block.label} <Icon icon={ChevronDownIcon} size="xs" className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {BLOCK_TYPES.map(b => (
                <DropdownMenuItem key={b.id} onClick={() => b.run(editor)} className="flex items-center gap-2">
                  <span className="flex-1">{b.label}</span>
                  {b.shortcut && <span className="text-small text-muted-foreground">{b.shortcut}</span>}
                  <Icon icon={CheckIcon} size="sm" className={cn("text-foreground", b.id !== s.block && "invisible")} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          </>}
        </>}
      </div>
    </BubbleMenu>
  )
}

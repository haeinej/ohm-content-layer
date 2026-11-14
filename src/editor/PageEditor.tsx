// The page editor: a block editor in the manner of the reference recordings. The page's path on top
// (drag it out to save it as Markdown, or onto a vault folder to file it), then the title, "/" for
// commands, a floating toolbar on selected text, a handle on each block with its menu, tables with
// row and column handles, and images by dropping or pasting files. Private posts save as you type;
// others are read-only here, because changing what other people see asks first (AGENTS.md rule 11).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import DragHandle from "@tiptap/extension-drag-handle-react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import Image from "@tiptap/extension-image"
import Highlight from "@tiptap/extension-highlight"
import { Markdown } from "@tiptap/markdown"
import type { Node as PMNode } from "@tiptap/pm/model"
import {
  ChevronDownIcon, ClockIcon, CopyIcon, DownloadIcon, FileTextIcon, FolderInputIcon, FolderOpenIcon, GripVerticalIcon, ImageIcon,
  LockIcon, PlusIcon, SmilePlusIcon, TableIcon, Trash2Icon, TypeIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { byId, bySlug, posts, titleOf, type Doc } from "@/data/sample"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { DOC_DRAG, dragOutAsMarkdown, openDropped, saveAsMarkdown } from "@/workspace/drop"
import { autosave, marks, me, moveDoc, open, openFile, saveDraft, setIcon, showGraph, toggleArchive, useWorkspace } from "@/workspace/store"
import { InlineRename, requestDelete } from "@/workspace/PageActions"
import { withAgent } from "@/workspace/tools"
import { insertImage, insertImageFiles, insertTable, insertText } from "./commands"
import { ActiveCell, References, SlashCommand } from "./extensions"
import { IconPicker } from "./IconPicker"
import { PlusMenu, SlashMenu } from "./InsertMenu"
import { SelectionToolbar } from "./SelectionToolbar"
import { LastEdited, TableControls } from "./TableControls"
import { LinkPreview } from "./LinkPreview"
import "./editor.css"

/** Bodies written before the editor start with "# Title"; the title has its own field now. */
const withoutTitle = (body: string, title: string) => body.replace(new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n*`), "")

/** The page as Markdown, with [[links]] kept as written: the serializer escapes their brackets. */
const unescapeLinks = (md: string) => md.replace(/\\\[\\\[([a-z0-9-]+)\\\]\\\]/gi, "[[$1]]")
const toMarkdown = (e: Editor) => unescapeLinks(e.getMarkdown())

const pill = "flex items-center gap-0.5 rounded-full bg-muted p-0.5"
const pillButton = "size-8 rounded-full text-muted-foreground hover:bg-background hover:text-foreground aria-expanded:bg-background aria-expanded:text-foreground"
const lastEdited = (d: Doc) => new Date(`${d.updated}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

function ToolButton({ label, icon, onClick, ...props }: { label: string; icon: typeof TypeIcon; onClick?: () => void } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={label} className={pillButton} onClick={onClick} {...props} />}>
        <Icon icon={icon} size="sm" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function useAutoHeight(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

/** Where a page lives: vault › label › sublabel › title, or cortex › folder › title. */
const pathOf = (d: Doc) => [d.kind === "post" ? "vault" : "cortex", d.label, d.sublabel, titleOf(d)].filter(Boolean) as string[]

/**
 * The page's path, in a pill. Click the page's name to rename it in place. Drag the pill out to save
 * the page as a .md file, or onto a vault folder in the side panel to file it there. The ⌄ beside it
 * opens the page's menu, as a session list has it: Open in, Rename, the file, Move, Archive, Delete.
 */
function PathPill({ doc, markdown, onPickFile, onRenamed }: { doc: Doc; markdown: () => string; onPickFile: () => void; onRenamed: (title: string) => void }) {
  const path = pathOf(doc)
  const post = doc.kind === "post"
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const p of posts) { set.add(p.label); if (p.sublabel) set.add(`${p.label}/${p.sublabel}`) }
    return [...set].sort()
  }, [doc.updated, doc.label, doc.sublabel]) // eslint-disable-line react-hooks/exhaustive-deps
  const here = doc.sublabel ? `${doc.label}/${doc.sublabel}` : doc.label
  const md = () => `# ${titleOf(doc)}\n\n${markdown()}`
  const rename = () => { if (post) { setMenu(false); setRenaming(true) } }
  const key = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === "r" && post) { e.preventDefault(); rename() }
    if (k === "a" && post) { e.preventDefault(); setMenu(false); toggleArchive(doc.id); notify({ message: marks.archived.has(doc.id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`, tone: "info" }) }
    if (k === "d" && post) { e.preventDefault(); setMenu(false); requestDelete(doc.id) }
  }
  return (
    <div draggable={!renaming} aria-label={`${path.join(" / ")}. Drag out to save as Markdown`}
      onDragStart={e => dragOutAsMarkdown(e.dataTransfer, doc.id, doc.title, md())}
      className={cn(pill, "h-9 min-w-0 max-w-[min(480px,58vw)] cursor-grab gap-1.5 ps-3 pe-0.5 text-small text-muted-foreground active:cursor-grabbing")}>
      <Icon icon={FileTextIcon} size="sm" className="flex-none" />
      <span className="flex min-w-0 items-center gap-1">
        {path.slice(0, -1).map((seg, i) => (
          <span key={i} className="flex min-w-0 flex-shrink items-center gap-1">
            <span className="truncate">{seg}</span>
            <span aria-hidden className="text-muted-foreground/60">/</span>
          </span>
        ))}
        {renaming ? (
          <InlineRename id={doc.id} className="h-7 w-48 text-small font-medium"
            onDone={() => { setRenaming(false); onRenamed(byId(doc.id)?.title ?? doc.title) }} />
        ) : (
          <button type="button" disabled={!post} onClick={rename} title={post ? "Rename" : undefined}
            className="max-w-48 flex-shrink-0 cursor-text truncate rounded-md px-1 py-0.5 font-medium text-foreground transition-colors hover:bg-background disabled:cursor-default disabled:hover:bg-transparent">
            {path.at(-1)}
          </button>
        )}
      </span>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger render={
          <button type="button" aria-label="Page menu"
            className="flex size-8 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground aria-expanded:bg-background aria-expanded:text-foreground" />
        }>
          <Icon icon={ChevronDownIcon} size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60" onKeyDown={key}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Open in</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuItem onClick={() => window.open(`${location.pathname}?open=${encodeURIComponent(doc.id)}`, "_blank", "noopener")}>New tab</DropdownMenuItem>
              <DropdownMenuItem onClick={() => showGraph()}>Graph</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!post} onClick={rename}>Rename<DropdownMenuShortcut>R</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onPickFile}>Open file…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => saveAsMarkdown(doc.title, md())}>Save as Markdown</DropdownMenuItem>
          {post && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to section</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                {folders.map(f => (
                  <DropdownMenuCheckboxItem key={f} checked={f === here} onCheckedChange={() => {
                    const [label, sublabel] = f.split("/")
                    moveDoc(doc.id, label, sublabel)
                    notify({ message: `Moved to ${f.replace("/", " › ")}`, tone: "info" })
                    setMenu(false)
                  }}>{f.replace("/", " › ")}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!post} onClick={() => { toggleArchive(doc.id); notify({ message: marks.archived.has(doc.id) ? `Archived “${titleOf(doc)}”` : `Restored “${titleOf(doc)}”`, tone: "info" }) }}>
            {marks.archived.has(doc.id) ? "Restore" : "Archive"}<DropdownMenuShortcut>A</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!post} variant="destructive" onClick={() => requestDelete(doc.id)}>Delete<DropdownMenuShortcut>D</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** The block handle's menu: for a table, its own options; for any block, insert, duplicate, copy, delete. */
function BlockMenu({ editor, block, updated, onClose }: { editor: Editor; block: { node: PMNode; pos: number }; updated: string; onClose: () => void }) {
  const { node, pos } = block
  const isTable = node.type.name === "table"
  const end = pos + node.nodeSize
  const json = node.toJSON()
  const md = () => unescapeLinks(editor.markdown?.serialize({ type: "doc", content: [json] }) ?? node.textContent)
  const headerRow = isTable && (node.firstChild?.firstChild?.type.name === "tableHeader")
  let headerCol = isTable
  if (isTable) node.forEach(r => { if (r.firstChild?.type.name !== "tableHeader") headerCol = false })
  const inTable = (fn: () => void) => { editor.chain().focus().setTextSelection(pos + 3).run(); fn() }
  const done = (fn: () => void) => () => { fn(); onClose() }
  return <>
    <DropdownMenuItem className="flex items-center gap-2" onClick={done(() => editor.chain().focus().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).run())}>
      <Icon icon={PlusIcon} size="sm" />Insert below
    </DropdownMenuItem>
    {!isTable && (
      <DropdownMenuItem className="flex items-center gap-2" onClick={done(() => editor.chain().focus().insertContentAt(end, json).run())}>
        <Icon icon={CopyIcon} size="sm" />Duplicate
      </DropdownMenuItem>
    )}
    <DropdownMenuItem className="flex items-center gap-2" onClick={done(() => { void navigator.clipboard?.writeText(md()); notify({ message: "Copied as Markdown", tone: "info" }) })}>
      <Icon icon={CopyIcon} size="sm" />Copy as Markdown
    </DropdownMenuItem>
    {isTable && <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem checked={headerRow} onCheckedChange={() => inTable(() => editor.chain().focus().toggleHeaderRow().run())}>Header row</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={headerCol} onCheckedChange={() => inTable(() => editor.chain().focus().toggleHeaderColumn().run())}>Header column</DropdownMenuCheckboxItem>
    </>}
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" className="flex items-center gap-2" onClick={done(() => editor.chain().focus().deleteRange({ from: pos, to: end }).run())}>
      <Icon icon={Trash2Icon} size="sm" />{isTable ? "Delete table" : "Delete"}
    </DropdownMenuItem>
    <LastEdited date={updated} />
  </>
}

export function PageEditor({ doc }: { doc: Doc }) {
  const { agentsAllowed, offered } = useWorkspace()
  const editable = doc.kind === "post" && doc.visibility === "private"
  const [title, setTitle] = useState(doc.title)
  const [plusOpen, setPlusOpen] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const [block, setBlock] = useState<{ node: PMNode; pos: number } | null>(null)
  const [blockMenu, setBlockMenu] = useState(false)
  const [dropping, setDropping] = useState<"open" | "image" | null>(null)
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useAutoHeight(titleRef, title)
  const save = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    editable,
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Type / for commands or @ for mentions"),
        includeChildren: false,
      }),
      TaskList, TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
      Image, Highlight, SlashCommand, ActiveCell, Markdown,
      References(ref => {
        if (ref.slug) { const d = bySlug(ref.slug); if (d) open(d.id) }
        if (ref.handle) showGraph(ref.handle)
      }),
    ],
    content: withoutTitle(doc.body, doc.title),
    contentType: "markdown",
    editorProps: {
      attributes: { class: "ohm-prose", "aria-label": "Page" },
      // Images dropped or pasted go into the page where they land; pages and text files open.
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer
        if (!dt) return false
        const files = [...dt.files]
        if (files.some(f => f.type.startsWith("image/"))) {
          if (!view.editable) return false
          event.preventDefault()
          const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
          const $pos = at ? view.state.doc.resolve(at.pos) : null
          insertImageFiles(editorRef.current!, files, $pos && $pos.depth > 0 ? $pos.after(1) : undefined)
          return true
        }
        if (dt.types.includes(DOC_DRAG) || files.length) {
          event.preventDefault()
          void openDropped(dt)
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        return files.length > 0 && insertImageFiles(editorRef.current!, files)
      },
    },
    onUpdate: ({ editor: e }) => {
      if (save.current) clearTimeout(save.current)
      save.current = setTimeout(() => autosave(doc.id, { body: toMarkdown(e) }), 400)
    },
  }, [doc.id])
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  useEffect(() => () => { if (save.current) clearTimeout(save.current) }, [])
  useEffect(() => { if (editable && !doc.title) titleRef.current?.focus() }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // The toolbar's Image and the "/" menu's Image both ask for a file.
  useEffect(() => {
    const pick = () => imageInput.current?.click()
    window.addEventListener("ohm:pick-image", pick)
    return () => window.removeEventListener("ohm:pick-image", pick)
  }, [])

  // The page's one primary action is saving, and it is also a tool while a private page is open.
  const offer = editable && agentsAllowed && offered["workspace.save-draft"]
  useEffect(() => {
    if (!offer || !editor) return
    const ac = new AbortController()
    registerStepTool<{ title?: string; body?: string }, ReturnType<typeof saveDraft>>({
      name: "workspace.save-draft",
      title: "Save draft",
      description: "Saves the page open in the editor as private. It is never published. Fields left out keep what is on the page. The body is Markdown. Returns its id and slug.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string", maxLength: 200 }, body: { type: "string", maxLength: 100000 } },
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, visibility: { const: "private" } } },
      run: withAgent("Saving draft", async input => {
        if (input.title !== undefined) setTitle(input.title)
        if (input.body !== undefined) editor.commands.setContent(input.body, { contentType: "markdown" })
        const out = saveDraft({ title: input.title ?? titleRef.current?.value ?? doc.title, body: toMarkdown(editor) })
        notify({ message: "Saved as private", tone: "info" })
        return out
      }),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [offer, editor, doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null
  const updated = lastEdited(doc)
  const dragKind = (dt: DataTransfer) =>
    [...dt.items].some(i => i.kind === "file" && i.type.startsWith("image/")) ? (editable ? "image" : null)
      : dt.types.includes(DOC_DRAG) || dt.types.includes("Files") ? "open" : null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={e => { const k = dragKind(e.dataTransfer); if (k) setDropping(k) }}
      onDragOver={e => { if (dragKind(e.dataTransfer)) e.preventDefault() }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(null) }}
      onDrop={e => {
        setDropping(null)
        if (e.defaultPrevented) return
        e.preventDefault()
        if (dragKind(e.dataTransfer) === "image") insertImageFiles(editor, [...e.dataTransfer.files])
        else void openDropped(e.dataTransfer)
      }}>
      {/* Toolbar: the page's path, then inserts; history, comments, you and sharing on the right. */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <PathPill doc={doc} markdown={() => toMarkdown(editor)} onPickFile={() => fileInput.current?.click()} onRenamed={setTitle} />
          {editable && (
            <div className={pill}>
              <ToolButton label="Text" icon={TypeIcon} onClick={() => insertText(editor)} />
              <ToolButton label="Image" icon={ImageIcon} onClick={() => insertImage(editor)} />
              <ToolButton label="Table" icon={TableIcon} onClick={() => insertTable(editor)} />
              <Popover open={plusOpen} onOpenChange={setPlusOpen}>
                <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Insert" className={pillButton} />}>
                  <Icon icon={PlusIcon} size="sm" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-1">
                  <PlusMenu editor={editor} onClose={() => setPlusOpen(false)} />
                </PopoverContent>
              </Popover>
            </div>
          )}
          {!editable && (
            <span className="flex items-center gap-1.5 ps-1 text-small whitespace-nowrap text-muted-foreground">
              <Icon icon={LockIcon} size="xs" />
              {doc.kind === "post" ? `For ${doc.visibility === "public" ? "everyone" : "friends"}: changing it asks first` : "From your cortex"}
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <div className={pill}>
            <ToolButton label="History" icon={ClockIcon} onClick={() => notify({ message: `Last edited ${updated}. Earlier versions are not part of this wireframe`, tone: "info" })} />
          </div>
          <Avatar className="size-8"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-14 pt-10 pb-40 max-md:px-6">
          {doc.icon && (
            <button type="button" aria-label="Change icon" disabled={!editable} onClick={() => setIconOpen(true)}
              className="mb-3 -ms-1 rounded-md p-1 text-[44px] leading-none transition-transform duration-(--ohm-duration-press) ease-(--ohm-ease-out) animate-in fade-in-0 zoom-in-90 hover:bg-muted active:scale-95">
              {doc.icon}
            </button>
          )}
          <div className="group/title relative">
            {editable && (
              <Popover open={iconOpen} onOpenChange={setIconOpen}>
                <PopoverTrigger render={
                  <button type="button" aria-label={doc.icon ? "Change icon" : "Add icon"}
                    className={cn("absolute top-1.5 -left-8 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-opacity duration-(--ohm-duration-state) hover:bg-muted focus-visible:opacity-100",
                      doc.icon ? "pointer-events-none opacity-0" : "opacity-0 group-hover/title:opacity-100")} />
                }>
                  <Icon icon={SmilePlusIcon} size="sm" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto">
                  <IconPicker value={doc.icon} onPick={e => { setIcon(doc.id, e); setIconOpen(false) }} />
                </PopoverContent>
              </Popover>
            )}
            <textarea ref={titleRef} rows={1} value={title} readOnly={!editable} placeholder="Untitled page" aria-label="Title"
              onChange={e => { setTitle(e.target.value); autosave(doc.id, { title: e.target.value }) }}
              onKeyDown={e => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === title.length)) {
                  e.preventDefault()
                  // Move at once, so the next keys land in the page, not the title.
                  editor.view.focus()
                  editor.commands.setTextSelection(1)
                }
              }}
              className="block w-full resize-none overflow-hidden bg-transparent text-h2 font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60" />
          </div>

          <div ref={setCanvas} className="relative mt-6">
            {editable && (
              <DragHandle editor={editor} onNodeChange={({ node, pos }) => { if (!blockMenu) setBlock(node ? { node, pos } : null) }}>
                <DropdownMenu open={blockMenu} onOpenChange={setBlockMenu}>
                  <DropdownMenuTrigger render={
                    <button type="button" aria-label="Block menu" onDragStart={() => setBlockMenu(false)}
                      className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 active:cursor-grabbing aria-expanded:bg-muted aria-expanded:opacity-100" />
                  }>
                    <Icon icon={GripVerticalIcon} size="sm" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="left" className="w-56">
                    {block && <BlockMenu editor={editor} block={block} updated={updated} onClose={() => setBlockMenu(false)} />}
                  </DropdownMenuContent>
                </DropdownMenu>
              </DragHandle>
            )}
            <EditorContent editor={editor} />
            {editable && <TableControls editor={editor} container={canvas} updated={updated} />}
            <LinkPreview container={canvas} />
          </div>
        </div>
      </div>

      {/* Dropping: a page or text file opens; an image goes into the page. */}
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl bg-background/70 ring-2 ring-primary/40 backdrop-blur-[2px] animate-in fade-in-0 duration-(--ohm-duration-state)">
          <span className="rounded-full bg-popover px-4 py-2 text-body shade-3">
            {dropping === "image" ? "Drop to add the image here" : "Drop to open"}
          </span>
        </div>
      )}

      <input ref={imageInput} type="file" accept="image/*" multiple hidden
        onChange={e => { insertImageFiles(editor, [...(e.target.files ?? [])]); e.target.value = "" }} />
      <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden
        onChange={async e => { const f = e.target.files?.[0]; if (f) openFile(f.name, await f.text()); e.target.value = "" }} />

      {editable && <SelectionToolbar editor={editor} docId={doc.id} />}
      <SlashMenu />
    </div>
  )
}

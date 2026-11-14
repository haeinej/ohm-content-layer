// The page editor: a block editor in the manner of the recording. An icon and title on top, template
// chips while the page is empty, "/" for commands, a floating toolbar on selected text, a handle to
// drag blocks, and a toolbar of inserts above. Private posts save as you type; others are read-only
// here, because changing what other people see asks first (AGENTS.md rule 11).
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import DragHandle from "@tiptap/extension-drag-handle-react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import Image from "@tiptap/extension-image"
import Highlight from "@tiptap/extension-highlight"
import { Markdown } from "@tiptap/markdown"
import {
  ChevronDownIcon, ClockIcon, EllipsisIcon, GripVerticalIcon, ImageIcon, LockIcon, MessageSquareIcon, PlusIcon,
  SmilePlusIcon, StickyNoteIcon, TableIcon, TypeIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { bySlug, type Doc } from "@/data/sample"
import { cn } from "@/lib/cn"
import { registerStepTool } from "@/webmcp"
import { autosave, me, open, saveDraft, setIcon, showGraph, toggleSide, useWorkspace } from "@/workspace/store"
import { withAgent } from "@/workspace/tools"
import { insertImage, insertTable, insertText } from "./commands"
import { useComments } from "./comments"
import { ImagePlaceholder, References, SlashCommand } from "./extensions"
import { IconPicker } from "./IconPicker"
import { PlusMenu, SlashMenu } from "./InsertMenu"
import { SelectionToolbar } from "./SelectionToolbar"
import { TemplateGallery } from "./TemplateGallery"
import { QUICK_TEMPLATES, type Template } from "./templates"
import "./editor.css"

/** Bodies written before the editor start with "# Title"; the title has its own field now. */
const withoutTitle = (body: string, title: string) => body.replace(new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n*`), "")

/** The page as Markdown, with [[links]] kept as written: the serializer escapes their brackets. */
const toMarkdown = (e: Editor) => e.getMarkdown().replace(/\\\[\\\[([a-z0-9-]+)\\\]\\\]/gi, "[[$1]]")

const pill = "flex items-center gap-0.5 rounded-full bg-muted p-0.5"
const pillButton = "size-8 rounded-full text-muted-foreground hover:bg-background hover:text-foreground aria-expanded:bg-background aria-expanded:text-foreground"

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

export function PageEditor({ doc }: { doc: Doc }) {
  const { agentsAllowed, offered } = useWorkspace()
  const editable = doc.kind === "post" && doc.visibility === "private"
  const [title, setTitle] = useState(doc.title)
  const [isEmpty, setIsEmpty] = useState(!doc.body.trim())
  const [gallery, setGallery] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useAutoHeight(titleRef, title)
  const comments = useComments(doc.id)
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
      TableKit.configure({ table: { resizable: false } }),
      Image, Highlight, ImagePlaceholder, SlashCommand, Markdown,
      References(ref => {
        if (ref.slug) { const d = bySlug(ref.slug); if (d) open(d.id) }
        if (ref.handle) showGraph(ref.handle)
      }),
    ],
    content: withoutTitle(doc.body, doc.title),
    contentType: "markdown",
    editorProps: { attributes: { class: "ohm-prose", "aria-label": "Page" } },
    onUpdate: ({ editor: e }) => {
      setIsEmpty(e.isEmpty)
      if (save.current) clearTimeout(save.current)
      save.current = setTimeout(() => autosave(doc.id, { body: toMarkdown(e) }), 400)
    },
  }, [doc.id])

  useEffect(() => () => { if (save.current) clearTimeout(save.current) }, [])
  useEffect(() => { if (editable && !doc.title) titleRef.current?.focus() }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const useTemplate = (t: Template) => {
    if (!editor) return
    editor.chain().focus().setContent(t.markdown, { contentType: "markdown" }).run()
    if (!title.trim()) { setTitle(t.name); autosave(doc.id, { title: t.name }) }
    if (!doc.icon) setIcon(doc.id, t.emoji)
    setGallery(false)
  }

  if (!editor) return null
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Toolbar: the page's icon, then inserts; history, comments, you and sharing on the right. */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-1.5">
          <Popover open={iconOpen} onOpenChange={setIconOpen}>
            <PopoverTrigger render={<button type="button" aria-label="Page icon" disabled={!editable} className={cn(pill, "h-9 gap-1 ps-2.5 pe-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60")} />}>
              {doc.icon ? <span className="text-[16px] leading-none">{doc.icon}</span> : <Icon icon={StickyNoteIcon} size="sm" />}
              <Icon icon={ChevronDownIcon} size="xs" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto rounded-lg">
              <IconPicker value={doc.icon} onPick={e => { setIcon(doc.id, e); setIconOpen(false) }} />
            </PopoverContent>
          </Popover>
          {editable && (
            <div className={pill}>
              <ToolButton label="Text" icon={TypeIcon} onClick={() => insertText(editor)} />
              <ToolButton label="Image" icon={ImageIcon} onClick={() => insertImage(editor)} />
              <ToolButton label="Table" icon={TableIcon} onClick={() => insertTable(editor)} />
              <Popover open={plusOpen} onOpenChange={setPlusOpen}>
                <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Insert" className={pillButton} />}>
                  <Icon icon={PlusIcon} size="sm" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto rounded-lg p-1">
                  <PlusMenu editor={editor} onClose={() => setPlusOpen(false)} />
                </PopoverContent>
              </Popover>
            </div>
          )}
          {!editable && (
            <span className="flex items-center gap-1.5 ps-1 text-small text-muted-foreground">
              <Icon icon={LockIcon} size="xs" />
              {doc.kind === "post" ? `For ${doc.visibility === "public" ? "everyone" : "friends"}: changing it asks first` : "From your cortex"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className={pill}>
            <ToolButton label="History" icon={ClockIcon} onClick={() => notify({ message: `Saved ${doc.updated}. Earlier versions are not part of this wireframe`, tone: "info" })} />
            <Popover>
              <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Comments, ${comments.length}`} className={cn(pillButton, "relative")} />}>
                <Icon icon={MessageSquareIcon} size="sm" />
                {comments.length > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary dark:bg-foreground" />}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 rounded-lg">
                <p className="text-small text-muted-foreground">Comments</p>
                {comments.length ? (
                  <ul className="flex flex-col gap-3">
                    {comments.map(c => (
                      <li key={c.id} className="flex flex-col gap-1">
                        <span className="border-s-2 border-border ps-2 text-small text-muted-foreground line-clamp-2">{c.quote}</span>
                        <span className="text-body">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-body text-muted-foreground">Select text and choose Comment.</p>}
              </PopoverContent>
            </Popover>
          </div>
          <div className={cn(pill, "pe-1")}>
            <Avatar className="ms-0.5 size-7"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
            <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 font-normal hover:bg-background" onClick={() => toggleSide("visibility")}>Share</Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-14 pt-10 pb-40 max-md:px-6">
          {doc.icon && (
            <button type="button" aria-label="Change icon" disabled={!editable} onClick={() => setIconOpen(true)}
              className="mb-3 -ms-1 rounded-md p-1 text-[44px] leading-none transition-transform duration-(--ohm-duration-press) ease-(--ohm-ease-out) hover:bg-muted active:scale-95 animate-in fade-in-0 zoom-in-90">
              {doc.icon}
            </button>
          )}
          <div className="group/title relative">
            {editable && !doc.icon && (
              <button type="button" aria-label="Add icon" onClick={() => setIconOpen(true)}
                className="absolute top-1.5 -left-8 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-(--ohm-duration-state) group-hover/title:opacity-100 hover:bg-muted focus-visible:opacity-100">
                <Icon icon={SmilePlusIcon} size="sm" />
              </button>
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

          {editable && isEmpty && (
            <div className="mt-4 flex flex-wrap items-center gap-1 animate-in fade-in-0 duration-(--ohm-duration-open)">
              {QUICK_TEMPLATES.map(t => (
                <Button key={t.id} size="sm" variant="ghost" className="h-8 rounded-full px-3 font-normal text-muted-foreground hover:text-foreground" onClick={() => useTemplate(t)}>
                  <Icon icon={t.icon} size="sm" /> {t.name}
                </Button>
              ))}
              <Button size="icon-sm" variant="ghost" aria-label="More templates" className="rounded-full text-muted-foreground" onClick={() => setGallery(true)}>
                <Icon icon={EllipsisIcon} size="sm" />
              </Button>
            </div>
          )}

          <div className="relative mt-6">
            {editable && (
              <DragHandle editor={editor}>
                <div className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 active:cursor-grabbing">
                  <Icon icon={GripVerticalIcon} size="sm" />
                </div>
              </DragHandle>
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {editable && <SelectionToolbar editor={editor as Editor} docId={doc.id} />}
      <SlashMenu />
      <TemplateGallery open={gallery} onOpenChange={setGallery} onPick={useTemplate} />
    </div>
  )
}

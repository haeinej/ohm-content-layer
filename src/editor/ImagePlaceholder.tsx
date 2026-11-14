import { useRef } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { ImagePlusIcon, PaperclipIcon, SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { cn } from "@/lib/cn"

/** An image block before it has an image: generate one, or attach one. */
export function ImagePlaceholderView({ editor, getPos, selected, deleteNode }: NodeViewProps) {
  const file = useRef<HTMLInputElement>(null)
  const place = (src: string, alt: string) => {
    const pos = getPos()
    if (typeof pos !== "number") return
    editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).insertContentAt(pos, { type: "image", attrs: { src, alt } }).run()
  }
  return (
    <NodeViewWrapper data-drag-handle className="my-2">
      <div contentEditable={false}
        className={cn("group/img relative flex h-32 flex-col items-center justify-center gap-3 rounded-lg bg-muted transition-shadow duration-(--ohm-duration-state)",
          selected && "ring-2 ring-ring/40")}
        onKeyDown={e => { if (e.key === "Backspace" || e.key === "Delete") deleteNode() }}>
        <Icon icon={ImagePlusIcon} className="text-muted-foreground" />
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="outline" className="rounded-full" onClick={() => notify({ message: "Generating images arrives once an agent is connected through WebMCP", tone: "info" })}>
            <Icon icon={SparklesIcon} size="xs" /> Generate
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="xs" variant="ghost" className="rounded-full" />}>
              <Icon icon={PaperclipIcon} size="xs" /> Attach
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-40">
              <DropdownMenuItem onClick={() => file.current?.click()}>Upload image</DropdownMenuItem>
              <DropdownMenuItem onClick={() => notify({ message: "Choosing from your vault is not part of this wireframe", tone: "info" })}>Choose from vault</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <input ref={file} type="file" accept="image/*" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) place(URL.createObjectURL(f), f.name) }} />
      </div>
    </NodeViewWrapper>
  )
}

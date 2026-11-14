// The editor's own extensions: the "/" menu, the image placeholder block, and live [[links]] and @mentions.
import { Extension, Node, mergeAttributes, type Editor, type Range } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import Suggestion, { type SuggestionKeyDownProps } from "@tiptap/suggestion"
import { ImagePlaceholderView } from "./ImagePlaceholder"

// ─── "/" menu ──────────────────────────────────────────────────────────────────
// The suggestion plugin finds "/query"; the React menu (SlashMenu) draws it from this small store.

export type SlashState = { open: boolean; query: string; rect: DOMRect | null; range: Range | null; editor: Editor | null }
let slash: SlashState = { open: false, query: "", rect: null, range: null, editor: null }
const slashListeners = new Set<() => void>()
let keyHandler: ((e: KeyboardEvent) => boolean) | null = null
const setSlash = (next: Partial<SlashState>) => { slash = { ...slash, ...next }; slashListeners.forEach(l => l()) }
export const slashStore = {
  get: () => slash,
  subscribe: (l: () => void) => { slashListeners.add(l); return () => slashListeners.delete(l) },
  close: () => setSlash({ open: false }),
  onKey: (fn: ((e: KeyboardEvent) => boolean) | null) => { keyHandler = fn },
}

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        pluginKey: new PluginKey("slashCommand"),
        items: () => [],
        render: () => ({
          onStart: p => setSlash({ open: true, query: p.query, rect: p.clientRect?.() ?? null, range: p.range, editor: p.editor }),
          onUpdate: p => setSlash({ open: true, query: p.query, rect: p.clientRect?.() ?? null, range: p.range, editor: p.editor }),
          onKeyDown: (p: SuggestionKeyDownProps) => {
            if (p.event.key === "Escape") { setSlash({ open: false }); return true }
            return keyHandler?.(p.event) ?? false
          },
          onExit: () => setSlash({ open: false }),
        }),
      }),
    ]
  },
})

// ─── Image placeholder ─────────────────────────────────────────────────────────

export const ImagePlaceholder = Node.create({
  name: "imagePlaceholder",
  group: "block",
  atom: true,
  draggable: true,
  parseHTML: () => [{ tag: "div[data-image-placeholder]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-image-placeholder": "" })],
  addNodeView: () => ReactNodeViewRenderer(ImagePlaceholderView),
  // An empty image is not written to Markdown.
  renderMarkdown: () => "",
})

// ─── [[links]] and @mentions ───────────────────────────────────────────────────
// Drawn as links in the text and followed on click; the text itself stays plain Markdown.

const REF = /\[\[([a-z0-9-]+)\]\]|@([a-z0-9.-]+\.[a-z]+)/gi

export const References = (onFollow: (ref: { slug?: string; handle?: string }) => void) =>
  Extension.create({
    name: "references",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("references"),
          props: {
            decorations(state) {
              const decos: Decoration[] = []
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return
                for (const m of node.text.matchAll(REF)) {
                  const from = pos + m.index!, to = from + m[0].length
                  decos.push(Decoration.inline(from, to, {
                    class: "ohm-ref",
                    "data-slug": m[1] ?? "",
                    "data-handle": m[2] ?? "",
                  }))
                }
              })
              return DecorationSet.create(state.doc, decos)
            },
            handleClick(view, _pos, event) {
              const el = (event.target as HTMLElement).closest<HTMLElement>(".ohm-ref")
              if (!el || !(event.metaKey || event.ctrlKey || !view.editable)) return false
              onFollow({ slug: el.dataset.slug || undefined, handle: el.dataset.handle || undefined })
              return true
            },
          },
        }),
      ]
    },
  })

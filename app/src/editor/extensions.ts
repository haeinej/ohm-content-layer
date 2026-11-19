// The editor's own extensions: the "/" menu, the image placeholder block, and live [[links]] and @mentions.
import { Extension, type Editor, type Range } from "@tiptap/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import Suggestion, { type SuggestionKeyDownProps } from "@tiptap/suggestion"
import { bySlug, titleOf } from "@/data/workspace-data"

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

// ─── [[links]] and @mentions ───────────────────────────────────────────────────
// Drawn as links in the text and followed on click; the text itself stays plain Markdown.

// `[[slug]]` reads as the block's title; `[[slug|the words]]` keeps your words, linked to the block.
export const REF = /\[\[([a-z0-9-]+)(?:\|([^\]\n]+))?\]\]|@([a-z0-9.-]+\.[a-z]+)/gi

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
              const { from: selFrom, to: selTo } = state.selection
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return
                for (const m of node.text.matchAll(REF)) {
                  const from = pos + m.index!, to = from + m[0].length
                  const slug = m[1], words = m[2], handle = m[3]
                  const target = slug ? bySlug(slug) : undefined
                  // While the caret is in it, the link shows as written, so it can be edited.
                  const editing = selTo >= from && selFrom <= to
                  if (slug && !editing) {
                    // [[slug]] reads as the linked block's title: a green chunk. The raw text stays in
                    // the block (and in its Markdown), hidden.
                    decos.push(Decoration.widget(from, () => {
                      const chip = document.createElement("span")
                      chip.className = target ? "ohm-link" : "ohm-link is-missing"
                      chip.dataset.slug = slug
                      chip.textContent = words ?? (target ? titleOf(target) : slug)
                      if (words && target) chip.title = titleOf(target)
                      return chip
                    }, { side: -1, key: `link:${slug}:${words ?? ""}:${from}` }))
                    decos.push(Decoration.inline(from, to, { class: "ohm-link-source" }))
                    continue
                  }
                  decos.push(Decoration.inline(from, to, {
                    class: slug ? "ohm-link is-raw" : "ohm-ref",
                    "data-slug": slug ?? "",
                    "data-handle": handle ?? "",
                  }))
                }
              })
              return DecorationSet.create(state.doc, decos)
            },
            handleClick(view, _pos, event) {
              const el = (event.target as HTMLElement).closest<HTMLElement>(".ohm-link:not(.is-raw), .ohm-ref")
              if (!el) return false
              // A link chip opens on a plain click; raw text and mentions need ⌘ while editing.
              const chip = el.classList.contains("ohm-link")
              if (!chip && !(event.metaKey || event.ctrlKey || !view.editable)) return false
              onFollow({ slug: el.dataset.slug || undefined, handle: el.dataset.handle || undefined })
              return true
            },
          },
        }),
      ]
    },
  })

// ─── The cell the caret is in ───────────────────────────────────────────────────
// Outlined, as the recording shows; a selection of several cells uses the table's own class.

export const ActiveCell = Extension.create({
  name: "activeCell",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("activeCell"),
        props: {
          decorations(state) {
            if (!state.selection.empty) return null
            const $pos = state.selection.$head
            for (let d = $pos.depth; d > 0; d--) {
              const node = $pos.node(d)
              if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
                const from = $pos.before(d)
                return DecorationSet.create(state.doc, [Decoration.node(from, from + node.nodeSize, { class: "is-active-cell" })])
              }
            }
            return null
          },
        },
      }),
    ]
  },
})

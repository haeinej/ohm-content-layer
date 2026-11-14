import { Fragment, type ReactNode } from "react"
import { bySlug, type Doc } from "@/data/sample"
import { open, showGraph } from "./store"

/** [[slug]] opens the post; @handle shows the graph centred on that person. */
function inline(text: string): ReactNode[] {
  return text.split(/(\[\[[a-z0-9-]+\]\]|@[a-z0-9.-]+\.[a-z]+)/gi).map((part, i) => {
    const link = part.match(/^\[\[([a-z0-9-]+)\]\]$/i)
    if (link) {
      const target = bySlug(link[1])
      return target ? (
        <button key={i} type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => open(target.id)}>
          {target.title}
        </button>
      ) : <span key={i} className="text-muted-foreground">{link[1]}</span>
    }
    if (/^@/.test(part)) {
      return (
        <button key={i} type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => showGraph(part.slice(1))}>
          {part}
        </button>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** A post rendered. The wireframe reads a small part of Markdown: headings, paragraphs, lists, images. */
export function DocView({ doc }: { doc: Doc }) {
  const blocks = doc.body.split(/\n{2,}/)
  return (
    <article data-reading="article" className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
      {blocks.map((block, i) => {
        if (block.startsWith("# ")) return <h1 key={i} className="text-h1">{block.slice(2)}</h1>
        if (block.startsWith("## ")) return <h2 key={i} className="text-h2">{block.slice(3)}</h2>
        const img = block.match(/^!\[(.*)\]\((.*)\)$/)
        if (img) {
          return (
            <figure key={i} className="flex aspect-[3/2] items-center justify-center rounded-2xl bg-muted text-small text-muted-foreground">
              {img[1] || "Image"}
            </figure>
          )
        }
        if (block.split("\n").every(l => l.startsWith("- "))) {
          return <ul key={i} className="list-disc ps-5 text-body">{block.split("\n").map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>
        }
        return <p key={i} className="text-body">{inline(block)}</p>
      })}
      {!doc.body.trim() && <p className="text-body text-muted-foreground">Nothing written yet.</p>}
    </article>
  )
}

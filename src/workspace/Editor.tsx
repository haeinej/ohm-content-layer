import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { notify } from "@/components/ui/notice"
import type { Doc } from "@/data/sample"
import { registerStepTool } from "@/webmcp"
import { withAgent } from "./tools"
import { open, saveDraft, useWorkspace } from "./store"

/** The editor. Save draft is the one primary action, and the `workspace.save-draft` tool while it is open. */
export function Editor({ doc }: { doc: Doc }) {
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const latest = useRef({ title, body })
  latest.current = { title, body }
  const editable = doc.visibility === "private"
  const { agentsAllowed, offered } = useWorkspace()
  const offer = agentsAllowed && offered["workspace.save-draft"]

  const save = (input: { title?: string; body?: string }) => {
    const out = saveDraft(input)
    notify({ message: "Saved as private", tone: "info" })
    return out
  }

  useEffect(() => {
    if (!editable || !offer) return
    const ac = new AbortController()
    registerStepTool<{ title?: string; body?: string }, ReturnType<typeof saveDraft>>({
      name: "workspace.save-draft",
      title: "Save draft",
      description: "Saves the post open in the editor as private. It is never published. Fields left out keep what is in the editor. Returns its id and slug.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 200 },
          body: { type: "string", maxLength: 100000 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, slug: { type: "string" }, visibility: { const: "private" } },
      },
      run: withAgent("Saving draft", async input => save({ ...latest.current, ...input })),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [doc.id, editable, offer])

  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10"
      onSubmit={e => { e.preventDefault(); save({ title, body }) }}
    >
      <Input aria-label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" disabled={!editable} />
      <Textarea aria-label="Body" value={body} onChange={e => setBody(e.target.value)} placeholder="Write. [[slug]] links a post, @handle mentions a person."
        className="min-h-[50vh]" disabled={!editable} />
      {!editable && (
        <p className="text-small text-muted-foreground">
          This post is for {doc.visibility === "public" ? "everyone" : "friends"}. Changing it will ask you first; that is its own flow, not in this wireframe.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => open(doc.id)}>Cancel</Button>
        <Button type="submit" disabled={!editable}>Save draft</Button>
      </div>
    </form>
  )
}

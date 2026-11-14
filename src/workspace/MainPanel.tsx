import { NetworkIcon } from "lucide-react"
import { AgentStatus } from "@/components/agent-status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { ScrollArea } from "@/components/ui/scroll-area"
import { byId } from "@/data/sample"
import { icons } from "@/lib/icons"
import { DocView } from "./DocView"
import { Editor } from "./Editor"
import { GraphView } from "./GraphView"
import { createDraft, open, setSearchOpen, showGraph, useWorkspace } from "./store"

const VISIBILITY = { public: "Everyone", friends: "Friends", private: "Private" } as const

/** Where things open: a post rendered, the editor, or the graph. */
export function MainPanel() {
  const { view, agent } = useWorkspace()
  const doc = view.kind === "doc" ? byId(view.id) : undefined

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-small text-muted-foreground">
          {doc ? (
            <>
              <span className="truncate">{[doc.kind === "post" ? "vault" : "cortex", doc.label, doc.sublabel].filter(Boolean).join(" › ")}</span>
              <Badge variant={doc.visibility === "private" ? "outline" : "secondary"}>
                <Icon icon={doc.visibility === "private" ? icons.locked : icons.visible} size="xs" />
                {VISIBILITY[doc.visibility]}
              </Badge>
            </>
          ) : view.kind === "graph" ? <span>Graph</span> : null}
        </div>
        {agent && <AgentStatus state={agent.state} label={agent.label} />}
        {doc && view.kind === "doc" && (
          <div className="flex items-center gap-1">
            {view.mode === "read" && doc.kind === "post" && (
              <Button size="sm" variant="ghost" onClick={() => open(doc.id, "edit")}>
                <Icon icon={icons.edit} size="sm" /> Edit
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => showGraph()}>
              <Icon icon={NetworkIcon} size="sm" /> Graph
            </Button>
          </div>
        )}
      </header>

      {view.kind === "graph" ? (
        <GraphView center={view.center} />
      ) : doc && view.kind === "doc" ? (
        <ScrollArea className="min-h-0 flex-1">
          {view.mode === "edit" ? <Editor key={doc.id} doc={doc} /> : <DocView doc={doc} />}
        </ScrollArea>
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Nothing open</EmptyTitle>
            <EmptyDescription>Open a post from the vault, search, or start one.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="ghost" onClick={() => setSearchOpen(true)}>Search</Button>
            <Button onClick={() => createDraft()}>New post</Button>
          </EmptyContent>
        </Empty>
      )}
    </main>
  )
}

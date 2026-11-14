import { NetworkIcon } from "lucide-react"
import { inbox } from "@/data/sample"
import { AgentStatus } from "@/components/agent-status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Icon } from "@/components/ui/icon"
import { byId } from "@/data/sample"
import { notify } from "@/components/ui/notice"
import { icons } from "@/lib/icons"
import { cn } from "@/lib/cn"
import { DocView } from "./DocView"
import { Editor } from "./Editor"
import { SettingsView } from "./Settings"
import { surface } from "./Surface"
import { closeSettings, createDraft, open, setAudience, setSearchOpen, showGraph, useWorkspace } from "./store"

const VISIBILITY = { public: "Everyone", friends: "Friends", private: "Private" } as const

/** Where things open: a post, the editor, an inbox item, or settings. A card of its own, apart from the rack. */
export function MainPanel() {
  const { view, agent, audience } = useWorkspace()
  const doc = view.kind === "doc" ? byId(view.id) : undefined

  return (
    <main className={cn(surface, "relative flex min-w-0 flex-1 flex-col overflow-hidden shade-2")}>
      {audience !== "personal" && (
        <div role="status" className="flex items-center justify-between gap-2 bg-muted px-5 py-2 text-small">
          <span>Viewing as {audience === "friends" ? "a friend" : "anyone"}. Only what they can see is shown.</span>
          <Button size="xs" variant="ghost" onClick={() => setAudience("personal")}>Back to you</Button>
        </div>
      )}
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-small text-muted-foreground">
            {doc && <>
              <span className="truncate">{[doc.kind === "post" ? "vault" : "cortex", doc.label, doc.sublabel].filter(Boolean).join(" › ")}</span>
              <Badge variant={doc.visibility === "private" ? "outline" : "secondary"}>
                <Icon icon={doc.visibility === "private" ? icons.locked : icons.visible} size="xs" />
                {VISIBILITY[doc.visibility]}
              </Badge>
            </>}
          </div>
          {agent && <AgentStatus state={agent.state} label={agent.label} />}
          {doc && view.kind === "doc" && (
            <div className="flex items-center gap-1">
              {view.mode === "read" && doc.kind === "post" && (
                <Button size="sm" variant="ghost" onClick={() => open(doc.id, "edit")}><Icon icon={icons.edit} size="sm" /> Edit</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => showGraph()}><Icon icon={NetworkIcon} size="sm" /> Graph</Button>
            </div>
          )}
          {view.kind === "settings" && <Button size="sm" variant="ghost" onClick={closeSettings}>Done</Button>}
        </header>
      {view.kind === "settings" ? (
        <SettingsView tab={view.tab} />
      ) : view.kind === "inbox" ? (
        <InboxItemView id={view.id} />
      ) : doc && view.kind === "doc" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view.mode === "edit" ? <Editor key={doc.id} doc={doc} /> : <DocView doc={doc} />}
        </div>
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

/** An inbox item that is not about a post: a friend request, a mention elsewhere. */
function InboxItemView({ id }: { id: string }) {
  const item = inbox.find(i => i.id === id)
  if (!item) return null
  return (
    <article className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-16">
      <p className="text-small text-muted-foreground">@{item.from} · {item.at}</p>
      <p className="text-body">{item.text}</p>
      <div className="flex gap-2">
        {item.kind === "friend" ? <>
          <Button onClick={() => notify({ message: "Accepting a friend asks you first; not part of this wireframe", tone: "info" })}>Accept</Button>
          <Button variant="ghost">Not now</Button>
        </> : <Button variant="secondary" onClick={() => showGraph(item.from)}>See @{item.from} in your graph</Button>}
      </div>
    </article>
  )
}

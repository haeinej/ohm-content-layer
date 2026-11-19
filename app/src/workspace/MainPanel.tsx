import { AgentStatus } from "@/components/agent-status"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { notify } from "@/components/ui/notice"
import { isBlock, byId, inbox, sees, titleOf } from "@/data/sample"
import { PageEditor } from "@/editor/PageEditor"
import { cn } from "@/lib/cn"
import { SettingsView } from "./Settings"
import { surface } from "./Surface"
import { openDropped, opensOnDrop } from "./drop"
import { closeSettings, createDraft, setAudience, setSearchOpen, showGraph, useWorkspace } from "./store"

/** Where things open: a page in the editor, an inbox item, or settings. A card of its own, apart from the rack. */
export function MainPanel() {
  const { view, agent, audience, restored } = useWorkspace()
  const doc = view.kind === "doc" ? byId(view.id) : undefined

  return (
    <main className={cn(surface, "relative flex min-w-0 flex-1 flex-col overflow-hidden shade-2")}>
      {audience !== "private" && (
        <div role="status" className="flex items-center justify-between gap-2 bg-muted px-5 py-2 text-small">
          <span>Viewing as {audience === "friends" ? "a friend" : "anyone"}. Only what they can see is shown.</span>
          <Button size="xs" variant="ghost" onClick={() => setAudience("private")}>Back to you</Button>
        </div>
      )}
      {agent && <AgentStatus state={agent.state} label={agent.label} className="absolute top-16 right-4 z-10 animate-in fade-in-0 slide-in-from-top-1" />}

      {doc && audience !== "private" && !sees(audience, doc) ? (
        // Viewing as someone else never shows what they couldn't see.
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>{audience === "friends" ? "Friends" : "Anyone"} can't see this item</EmptyTitle>
            <EmptyDescription>“{titleOf(doc)}” is for {isBlock(doc) && doc.visibility === "friends" ? "friends" : "you only"}.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="ghost" onClick={() => setAudience("private")}>Back to you</Button>
          </EmptyContent>
        </Empty>
      ) : doc ? (
        // A restore or revert of this page re-reads it; one of another page leaves this editor alone.
        <PageEditor key={`${doc.id}:${restored?.id === doc.id ? restored.n : 0}`} doc={doc} />
      ) : view.kind === "settings" ? (
        <>
          <header className="flex h-14 shrink-0 items-center justify-end px-5">
            <Button size="sm" variant="ghost" onClick={closeSettings}>Done</Button>
          </header>
          <SettingsView tab={view.tab} />
        </>
      ) : view.kind === "inbox" ? (
        <InboxItemView id={view.id} />
      ) : (
        <Empty className="flex-1" onDragOver={e => { if (opensOnDrop(e.dataTransfer)) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); void openDropped(e.dataTransfer) }}>
          <EmptyHeader>
            <EmptyTitle>Nothing open</EmptyTitle>
            <EmptyDescription>Open something from your home, drop a block here, or start a block.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="ghost" onClick={() => setSearchOpen(true)}>Search</Button>
            <Button onClick={() => createDraft()}>New block</Button>
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

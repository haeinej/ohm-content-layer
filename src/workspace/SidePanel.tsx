import { useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AtSignIcon, BrainIcon, ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, GlobeIcon,
  LibraryIcon, ListTreeIcon, LockIcon, LogOutIcon, MessageCircleIcon, NetworkIcon, UserPlusIcon, UsersIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { Icon } from "@/components/ui/icon"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { notify } from "@/components/ui/notice"
import { cortex, inbox, posts, sees, type Audience, type Doc, type InboxItem, type Visibility } from "@/data/sample"
import { cn } from "@/lib/cn"
import { GraphView } from "./GraphView"
import { SETTINGS_TABS } from "./settings-tabs"
import { panelTitle, SidePanelFrame } from "./Surface"
import {
  me, open, openInbox, openSettings, setAudience, setInclude, setRepoMode, setVisibility, useWorkspace,
} from "./store"

/** label › sublabel › item, as folders. Folder ids are prefixed so they never collide with docs. */
function toTree(prime: string, docs: Doc[], order?: string[]): FileTreeNode[] {
  const labels = new Map<string, Map<string | undefined, Doc[]>>()
  for (const d of docs) {
    const subs = labels.get(d.label) ?? new Map()
    subs.set(d.sublabel, [...(subs.get(d.sublabel) ?? []), d])
    labels.set(d.label, subs)
  }
  const names = [...labels.keys()].sort((a, b) => {
    if (a === "other") return 1
    if (b === "other") return -1
    const ia = order?.indexOf(a) ?? -1, ib = order?.indexOf(b) ?? -1
    return ia === -1 || ib === -1 ? a.localeCompare(b) : ia - ib
  })
  return names.map(label => {
    const subs = labels.get(label)!
    const leaf = (d: Doc) => ({ id: d.id, name: d.title })
    return {
      id: `${prime}:${label}`, name: label,
      children: [
        ...[...subs].filter(([s]) => s).map(([s, list]) => ({ id: `${prime}:${label}/${s}`, name: s!, children: list.map(leaf) })),
        ...(subs.get(undefined) ?? []).map(leaf),
      ],
    }
  })
}
const folderIds = (nodes: FileTreeNode[]): string[] =>
  nodes.flatMap(n => (n.children ? [n.id, ...folderIds(n.children)] : []))

const mobile = "max-md:absolute max-md:inset-y-3 max-md:left-[68px] max-md:z-20 max-md:w-[calc(100%-80px)]"
const toggle = "text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"

// ─── Personal repo ────────────────────────────────────────────────────────────

type Prime = "cortex" | "vault"
const PRIME: Record<Prime, { icon: LucideIcon; note: string }> = {
  cortex: { icon: BrainIcon, note: "What your agents know" },
  vault: { icon: LibraryIcon, note: "Everything you write" },
}

/** One of the repo's two prime folders: a check to include it, a chevron to open it. */
function PrimeRow({ prime, count, checked, open: isOpen, onOpen, disabled, note }: {
  prime: Prime; count: number; checked: boolean; open: boolean; onOpen: () => void; disabled?: boolean; note?: string
}) {
  return (
    <div className={cn("flex min-h-10 items-center gap-1.5 rounded-md pe-2 hover:bg-muted", !checked && "text-muted-foreground")}>
      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Close" : "Open"} ${prime}`} onClick={onOpen}
        disabled={!checked} className="flex size-8 items-center justify-center rounded-md text-muted-foreground disabled:opacity-40">
        <Icon icon={isOpen && checked ? ChevronDownIcon : ChevronRightIcon} size="sm" />
      </button>
      <Checkbox aria-label={`Include ${prime}`} checked={checked} disabled={disabled} onCheckedChange={v => setInclude(prime, v === true)} />
      <Icon icon={PRIME[prime].icon} size="sm" className="ms-1 text-muted-foreground" />
      <button type="button" onClick={onOpen} disabled={!checked} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className="text-body font-medium">{prime}</span>
        <span className="truncate text-small text-muted-foreground">{note ?? PRIME[prime].note}</span>
      </button>
      <span className="text-small text-muted-foreground tabular-nums">{count}</span>
    </div>
  )
}

function RepoPanel() {
  const { view, rev, repoMode, include, audience } = useWorkspace()
  const cortexTree = useMemo(() => toTree("cortex", cortex, ["memories", "notes", "skills", "tools"]), [rev])
  const vaultDocs = useMemo(() => posts.filter(p => sees(audience, p)), [rev, audience]) // eslint-disable-line react-hooks/exhaustive-deps
  const vaultTree = useMemo(() => toTree("vault", vaultDocs), [vaultDocs])
  const allFolders = useMemo(() => ["prime:cortex", "prime:vault", ...folderIds(cortexTree), ...folderIds(vaultTree)], [cortexTree, vaultTree])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["prime:cortex", "prime:vault", ...folderIds(vaultTree)]))
  const everything = allFolders.every(id => expanded.has(id))
  const flip = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const cortexOnlyYou = audience !== "personal"

  const primes = (
    <div className="flex flex-col gap-0.5">
      <PrimeRow prime="cortex" count={cortex.length} checked={include.cortex && !cortexOnlyYou} disabled={cortexOnlyYou}
        note={cortexOnlyYou ? "Only you see your cortex" : undefined}
        open={repoMode === "tree" && expanded.has("prime:cortex")} onOpen={() => (repoMode === "tree" ? flip("prime:cortex") : setRepoMode("tree"))} />
      {repoMode === "tree" && include.cortex && !cortexOnlyYou && expanded.has("prime:cortex") && (
        <FileTree aria-label="cortex" className="ms-4" nodes={cortexTree} expanded={expanded} onExpandedChange={setExpanded}
          selected={view.kind === "doc" ? view.id : null} onSelect={id => open(id)} />
      )}
      <PrimeRow prime="vault" count={vaultDocs.length} checked={include.vault}
        open={repoMode === "tree" && expanded.has("prime:vault")} onOpen={() => (repoMode === "tree" ? flip("prime:vault") : setRepoMode("tree"))} />
      {repoMode === "tree" && include.vault && expanded.has("prime:vault") && (
        <FileTree aria-label="vault" className="ms-4" nodes={vaultTree} expanded={expanded} onExpandedChange={setExpanded}
          selected={view.kind === "doc" ? view.id : null} onSelect={id => open(id)} />
      )}
    </div>
  )

  return (
    <SidePanelFrame
      label="Personal repo"
      className={cn("shrink-0 transition-[width] duration-(--ohm-duration-open) ease-(--ohm-ease-out)", repoMode === "graph" ? "w-[min(560px,45vw)]" : "w-[344px]", mobile)}
      scroll={repoMode === "tree"}
      heading={<>
        <h1 className={panelTitle}>Personal repo</h1>
        <p className="truncate text-small text-muted-foreground">@{me.handle} · read-only{audience !== "personal" && ` · as ${audience === "friends" ? "a friend" : "anyone"}`}</p>
      </>}
      actions={<>
        <div role="group" aria-label="Show as" className="flex">
          <Button size="icon-sm" variant="ghost" className={toggle} aria-label="Tree" aria-pressed={repoMode === "tree"} onClick={() => setRepoMode("tree")}>
            <Icon icon={ListTreeIcon} size="sm" />
          </Button>
          <Button size="icon-sm" variant="ghost" className={toggle} aria-label="Graph" aria-pressed={repoMode === "graph"} onClick={() => setRepoMode("graph")}>
            <Icon icon={NetworkIcon} size="sm" />
          </Button>
        </div>
        {repoMode === "tree" && (
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={everything ? "Collapse all" : "Expand all"}
            onClick={() => setExpanded(everything ? new Set() : new Set(allFolders))}>
            <Icon icon={everything ? ChevronsDownUpIcon : ChevronsUpDownIcon} size="sm" />
          </Button>
        )}
      </>}
    >
      {repoMode === "tree" ? primes : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/* The same checks, compact, above the graph they control. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
            {(["cortex", "vault"] as Prime[]).map(p => (
              <label key={p} className={cn("flex min-h-8 items-center gap-2 text-body", p === "cortex" && cortexOnlyYou && "text-muted-foreground")}>
                <Checkbox checked={include[p] && !(p === "cortex" && cortexOnlyYou)} disabled={p === "cortex" && cortexOnlyYou}
                  onCheckedChange={v => setInclude(p, v === true)} />
                {p}
              </label>
            ))}
          </div>
          <div className="-mx-2 flex min-h-0 flex-1 overflow-hidden rounded-md bg-background">
            <GraphView />
          </div>
        </div>
      )}
    </SidePanelFrame>
  )
}

// ─── Visibility ───────────────────────────────────────────────────────────────

const AUDIENCES: { id: Audience; label: string; note: string; icon: LucideIcon }[] = [
  { id: "personal", label: "Only you", note: "Everything: your vault and your cortex", icon: LockIcon },
  { id: "friends", label: "Friends", note: "Posts for friends, and for everyone", icon: UsersIcon },
  { id: "public", label: "Public", note: "Posts for everyone", icon: GlobeIcon },
]
const FOR: Record<Visibility, string> = { private: "Only you", friends: "Friends", public: "Everyone" }
const openness: Record<Visibility, number> = { private: 0, friends: 1, public: 2 }

function VisibilityPanel() {
  const { audience, rev } = useWorkspace()
  const [asking, setAsking] = useState<{ doc: Doc; to: Visibility } | null>(null)
  const count = (a: Audience) => posts.filter(p => sees(a, p)).length + (a === "personal" ? cortex.length : 0)
  void rev
  const change = (doc: Doc, to: Visibility) => {
    if (openness[to] > openness[doc.visibility]) return setAsking({ doc, to })
    setVisibility(doc.id, to)
    notify({ message: `“${doc.title}” is now for ${FOR[to].toLowerCase()}`, tone: "info" })
  }
  return (
    <SidePanelFrame label="Visibility" className={cn("w-[344px] shrink-0", mobile)}
      heading={<>
        <h1 className={panelTitle}>Visibility</h1>
        <p className="text-small text-muted-foreground">See yourself as others do</p>
      </>}>
      <p className="mx-2.5 mb-2 text-small text-muted-foreground">View as</p>
      <div role="radiogroup" aria-label="View as" className="flex flex-col gap-0.5">
        {AUDIENCES.map(a => (
          <button key={a.id} type="button" role="radio" aria-checked={audience === a.id} onClick={() => setAudience(a.id)}
            className="flex min-h-12 items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-muted aria-checked:bg-muted">
            <Icon icon={a.icon} size="sm" className="text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-medium">{a.label}</span>
              <span className="text-small text-muted-foreground">{a.note}</span>
            </span>
            <span className="text-small text-muted-foreground tabular-nums">{count(a.id)}</span>
          </button>
        ))}
      </div>

      <p className="mx-2.5 mt-6 mb-1 text-small text-muted-foreground">Who each post is for</p>
      {(["public", "friends", "private"] as Visibility[]).map(v => {
        const list = posts.filter(p => p.visibility === v)
        return list.length > 0 && (
          <section key={v} className="mb-2">
            <h2 className="px-2.5 pt-2 pb-1 text-h3">{FOR[v]}</h2>
            <ul>
              {list.map(d => (
                <li key={d.id} className="flex min-h-10 items-center gap-2 rounded-md ps-2.5 pe-1 hover:bg-muted">
                  <button type="button" className="min-w-0 flex-1 truncate py-2 text-left text-body" onClick={() => open(d.id)}>{d.title}</button>
                  <NativeSelect size="sm" aria-label={`Who “${d.title}” is for`} value={d.visibility}
                    onChange={e => change(d, e.target.value as Visibility)} className="w-28">
                    {(["private", "friends", "public"] as Visibility[]).map(o => <NativeSelectOption key={o} value={o}>{FOR[o]}</NativeSelectOption>)}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {/* Showing a post to more people asks first. Marking is not publishing. */}
      <Dialog open={Boolean(asking)} onOpenChange={o => !o && setAsking(null)}>
        <DialogContent className="rounded-lg">
          <DialogHeader>
            <DialogTitle>Show “{asking?.doc.title}” to {asking && FOR[asking.to].toLowerCase()}?</DialogTitle>
            <DialogDescription>
              It is marked in your vault as for {asking && FOR[asking.to].toLowerCase()}. It reaches your site and other applications only when you publish.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!asking) return
              setVisibility(asking.doc.id, asking.to)
              notify({ message: `“${asking.doc.title}” is marked for ${FOR[asking.to].toLowerCase()}. Not published yet.`, tone: "info" })
              setAsking(null)
            }}>Mark for {asking && FOR[asking.to].toLowerCase()}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidePanelFrame>
  )
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

const KIND: Record<InboxItem["kind"], { icon: LucideIcon; label: string }> = {
  reply: { icon: MessageCircleIcon, label: "Replied" },
  mention: { icon: AtSignIcon, label: "Mentioned you" },
  friend: { icon: UserPlusIcon, label: "Friend request" },
  note: { icon: BrainIcon, label: "Cortex" },
}

function InboxPanel() {
  const { view, rev } = useWorkspace()
  void rev
  const unread = inbox.filter(i => i.unread).length
  return (
    <SidePanelFrame label="Inbox" className={cn("w-[344px] shrink-0", mobile)}
      heading={<>
        <h1 className={panelTitle}>Inbox</h1>
        <p className="text-small text-muted-foreground">{unread ? `${unread} new` : "All read"}</p>
      </>}>
      <ul className="flex flex-col gap-0.5">
        {inbox.map(i => {
          const current = (view.kind === "inbox" && view.id === i.id) || (view.kind === "doc" && i.ref === view.id)
          return (
            <li key={i.id}>
              <button type="button" onClick={() => openInbox(i.id)} aria-current={current || undefined}
                className="flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left hover:bg-muted aria-[current=true]:bg-muted">
                <Avatar className="mt-0.5 size-8"><AvatarFallback className="bg-muted text-small text-muted-foreground">
                  {i.from === "cortex" ? <Icon icon={BrainIcon} size="sm" /> : i.from.slice(0, 1).toUpperCase()}
                </AvatarFallback></Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-body", i.unread && "font-semibold")}>{i.from === "cortex" ? "Cortex" : `@${i.from}`}</span>
                    <span className="ms-auto flex-none text-small text-muted-foreground">{i.at.slice(5).replace("-", "/")}</span>
                  </span>
                  <span className="flex items-center gap-1 text-small text-muted-foreground">
                    <Icon icon={KIND[i.kind].icon} size="xs" />{KIND[i.kind].label}
                  </span>
                  <span className="line-clamp-2 text-body text-muted-foreground">{i.text}</span>
                </span>
                {i.unread && <span aria-label="New" className="mt-2 size-2 flex-none rounded-full bg-primary dark:bg-foreground" />}
              </button>
            </li>
          )
        })}
      </ul>
    </SidePanelFrame>
  )
}

// ─── Profile ──────────────────────────────────────────────────────────────────

/** Who you are on top, then the settings, as agentic-twitter's account directory. */
function ProfilePanel() {
  const { view } = useWorkspace()
  const tab = view.kind === "settings" ? view.tab : undefined
  const row = "h-auto min-h-10 w-full justify-start gap-2.5 px-2.5 py-2 text-left font-normal whitespace-normal aria-[current=page]:bg-muted [&>svg]:text-muted-foreground aria-[current=page]:[&>svg]:text-foreground"
  return (
    <SidePanelFrame label="You" className={cn("w-[344px] shrink-0", mobile)}
      heading={
        <div className="flex flex-col items-start gap-3 px-2.5 pt-4">
          <Avatar className="size-11"><AvatarFallback className="bg-muted text-muted-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-h3">{me.name}</span>
            <span className="text-body text-muted-foreground">@{me.handle}</span>
          </div>
        </div>
      }>
      <nav aria-label="Your settings" className="flex flex-col gap-0.5">
        <p className="mx-2.5 mt-1 mb-2 text-small text-muted-foreground">Settings</p>
        {SETTINGS_TABS.map(t => (
          <Button key={t.id} variant="ghost" className={row} aria-current={tab === t.id ? "page" : undefined} onClick={() => openSettings(t.id)}>
            <Icon icon={t.icon} size="sm" /><span>{t.label}</span>
          </Button>
        ))}
        <div className="mt-9 flex flex-col">
          <Button variant="ghost" className={row} onClick={() => notify({ message: "Signing out is not part of this wireframe", tone: "info" })}>
            <Icon icon={LogOutIcon} size="sm" /><span>Sign out</span>
          </Button>
        </div>
      </nav>
    </SidePanelFrame>
  )
}

export function SidePanel() {
  const { side } = useWorkspace()
  if (side === "repo") return <RepoPanel />
  if (side === "visibility") return <VisibilityPanel />
  if (side === "inbox") return <InboxPanel />
  if (side === "profile") return <ProfilePanel />
  return null
}

import { useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AtSignIcon, BrainIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, FolderIcon,
  FolderOpenIcon, GlobeIcon, ListTreeIcon, LockIcon, LogOutIcon, MessageCircleIcon, NetworkIcon, UserPlusIcon, UsersIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { cortex, inbox, posts, sees, titleOf, type Audience, type Doc, type InboxItem } from "@/data/sample"
import { cn } from "@/lib/cn"
import { DOC_DRAG } from "./drop"
import { GraphView } from "./GraphView"
import { SETTINGS_TABS } from "./settings-tabs"
import { panelTitle, SidePanelFrame } from "./Surface"
import {
  me, moveDoc, open, openInbox, openSettings, setAudience, setRepoMode, setScope, useWorkspace,
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
    const leaf = (d: Doc) => ({ id: d.id, name: `${d.icon ? `${d.icon} ` : ""}${titleOf(d)}` })
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

const toggle = "text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"

// ─── Personal repository ──────────────────────────────────────────────────────


/**
 * Tree rows as drag sources (a page) and drop targets (a vault folder). FileTree draws the rows; this
 * marks them draggable and handles the events by delegation, so the tree itself stays as ohm-ui has it.
 */
function useTreeDragDrop(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll<HTMLElement>("[data-slot=file-tree-item]").forEach(row => {
      const id = row.dataset.id ?? ""
      row.draggable = !id.includes(":")
    })
  })
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const rowOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-slot=file-tree-item]")
    const folderOf = (row: HTMLElement | null) => (row?.dataset.id?.startsWith("vault:") ? row.dataset.id.slice(6) : null)
    let over: HTMLElement | null = null
    const clear = () => { over?.removeAttribute("data-drop"); over = null }
    const start = (e: DragEvent) => {
      const id = rowOf(e)?.dataset.id
      if (!id || id.includes(":") || !e.dataTransfer) return
      e.dataTransfer.setData(DOC_DRAG, id)
      e.dataTransfer.effectAllowed = "copyMove"
    }
    const dragover = (e: DragEvent) => {
      const row = rowOf(e)
      if (!folderOf(row) || !e.dataTransfer?.types.includes(DOC_DRAG)) return clear()
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (row !== over) { clear(); over = row; row!.setAttribute("data-drop", "") }
    }
    const drop = (e: DragEvent) => {
      const folder = folderOf(rowOf(e))
      const id = e.dataTransfer?.getData(DOC_DRAG)
      clear()
      if (!folder || !id) return
      e.preventDefault()
      const [label, sublabel] = folder.split("/")
      try {
        moveDoc(id, label, sublabel)
        notify({ message: `Filed under ${folder.replace("/", " › ")}`, tone: "info" })
      } catch (err) { notify({ message: (err as Error).message }) }
    }
    root.addEventListener("dragstart", start)
    root.addEventListener("dragover", dragover)
    root.addEventListener("dragleave", clear)
    root.addEventListener("drop", drop)
    return () => {
      root.removeEventListener("dragstart", start)
      root.removeEventListener("dragover", dragover)
      root.removeEventListener("dragleave", clear)
      root.removeEventListener("drop", drop)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

/** One of the repo's two prime folders: a forest folder, bold, that opens in place. */
function PrimeRow({ prime, open: isOpen, onOpen, locked }: { prime: "cortex" | "vault"; open: boolean; onOpen: () => void; locked?: boolean }) {
  return (
    <button type="button" aria-expanded={isOpen} onClick={onOpen} disabled={locked}
      className="flex min-h-9 w-full items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors duration-(--ohm-duration-state) hover:bg-muted disabled:hover:bg-transparent">
      <Icon icon={isOpen ? ChevronDownIcon : ChevronRightIcon} size="sm" className={cn("text-muted-foreground transition-transform", locked && "invisible")} />
      <Icon icon={isOpen ? FolderOpenIcon : FolderIcon} size="sm" strokeWidth={2.5} className="text-primary dark:text-foreground" />
      <span className="text-body font-bold text-primary dark:text-foreground">{prime}</span>
      {locked && <Icon icon={LockIcon} size="xs" className="ms-auto text-muted-foreground" aria-label="Only you see your cortex" />}
    </button>
  )
}

function RepoPanel() {
  const { view, rev, repoMode, scope, audience } = useWorkspace()
  const cortexTree = useMemo(() => toTree("cortex", cortex, ["memories", "notes", "skills", "tools"]), [rev])
  const vaultDocs = useMemo(() => posts.filter(p => sees(audience, p)), [rev, audience]) // eslint-disable-line react-hooks/exhaustive-deps
  const vaultTree = useMemo(() => toTree("vault", vaultDocs), [vaultDocs])
  const showCortex = scope.cortex, showVault = scope.vault
  const treeRef = useRef<HTMLDivElement>(null)
  useTreeDragDrop(treeRef, [repoMode])
  const cortexLocked = audience !== "personal"
  const allFolders = useMemo(() => [
    ...(showCortex ? ["prime:cortex", ...folderIds(cortexTree)] : []),
    ...(showVault ? ["prime:vault", ...folderIds(vaultTree)] : []),
  ], [cortexTree, vaultTree, showCortex, showVault])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["prime:cortex", "prime:vault", ...folderIds(vaultTree)]))
  const everything = allFolders.length > 0 && allFolders.every(id => expanded.has(id))
  const flip = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selected = view.kind === "doc" ? view.id : null

  return (
    <SidePanelFrame
      label={`${me.name}'s repository`}
      scroll={repoMode === "tree"}
      heading={
        /* Whose repository: you, in a pill. Its menu chooses what shows: All, or Cortex and Vault. */
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`${me.name}'s repository: what it shows`}
              className="flex max-w-full items-center gap-2 rounded-full bg-muted py-1 ps-1 pe-2.5 text-left transition-colors duration-(--ohm-duration-state) hover:bg-foreground/8 aria-expanded:bg-foreground/8" />
          }>
            <Avatar className="size-6"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
            <span className="truncate text-body font-medium">{me.name}</span>
            <Icon icon={ChevronDownIcon} size="sm" className="flex-none text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuCheckboxItem checked={scope.cortex && scope.vault} onCheckedChange={() => setScope({ cortex: true, vault: true })}>All</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={scope.cortex} onCheckedChange={v => setScope({ ...scope, cortex: v })}>Cortex</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={scope.vault} onCheckedChange={v => setScope({ ...scope, vault: v })}>Vault</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
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
      {repoMode === "tree" ? (
        <div ref={treeRef} className="flex flex-col gap-0.5 [&_[data-drop]]:bg-primary/10 [&_[data-drop]]:ring-1 [&_[data-drop]]:ring-primary/40">
          {!showCortex && !showVault && (
            <p className="px-2 py-6 text-center text-small text-muted-foreground">Choose Cortex or Vault from the menu above.</p>
          )}
          {showCortex && <>
            <PrimeRow prime="cortex" locked={cortexLocked} open={!cortexLocked && expanded.has("prime:cortex")} onOpen={() => flip("prime:cortex")} />
            {!cortexLocked && expanded.has("prime:cortex") && (
              <FileTree aria-label="cortex" className="ms-4 animate-in fade-in-0 slide-in-from-top-1 duration-(--ohm-duration-open)" nodes={cortexTree}
                expanded={expanded} onExpandedChange={setExpanded} selected={selected} onSelect={id => open(id)} />
            )}
          </>}
          {showVault && <>
            <PrimeRow prime="vault" open={expanded.has("prime:vault")} onOpen={() => flip("prime:vault")} />
            {expanded.has("prime:vault") && (
              <FileTree aria-label="vault" className="ms-4 animate-in fade-in-0 slide-in-from-top-1 duration-(--ohm-duration-open)" nodes={vaultTree}
                expanded={expanded} onExpandedChange={setExpanded} selected={selected} onSelect={id => open(id)} />
            )}
          </>}
        </div>
      ) : (
        <div className="-mx-1 flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-background">
          <GraphView />
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

function VisibilityPanel() {
  const { audience } = useWorkspace()
  return (
    <SidePanelFrame label="Visibility"
      heading={<h1 className={panelTitle}>Visibility</h1>}>
      <p className="mx-2.5 mb-2 text-small text-muted-foreground">View as</p>
      <div role="radiogroup" aria-label="View as" className="flex flex-col gap-0.5">
        {AUDIENCES.map(a => (
          <button key={a.id} type="button" role="radio" aria-checked={audience === a.id} onClick={() => setAudience(a.id)}
            className="flex min-h-12 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-(--ohm-duration-state) hover:bg-muted aria-checked:bg-muted">
            <Icon icon={a.icon} size="sm" className="text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-medium">{a.label}</span>
              <span className="text-small text-muted-foreground">{a.note}</span>
            </span>
            <Icon icon={CheckIcon} size="sm" className={cn(audience !== a.id && "invisible")} />
          </button>
        ))}
      </div>
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
    <SidePanelFrame label="Inbox"
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
                className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-(--ohm-duration-state) hover:bg-muted aria-[current=true]:bg-muted">
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
    <SidePanelFrame label="You"
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

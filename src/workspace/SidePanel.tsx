import { useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AtSignIcon, BrainIcon, EllipsisIcon, EyeIcon, EyeOffIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, GlobeIcon, ListTreeIcon, LockIcon, LogOutIcon, MessageCircleIcon, NetworkIcon, UserPlusIcon, UsersIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { byId, cortex, inbox, people, posts, sees, titleOf, type Audience, type Doc, type InboxItem } from "@/data/sample"
import { cn } from "@/lib/cn"
import { DOC_DRAG } from "./drop"
import { GraphView } from "./GraphView"
import { PrimeIcon } from "./PrimeIcon"
import { RowMenu } from "./RowMenu"
import { FilterMenu } from "./FilterMenu"
import { activeCount, NO_FILTERS } from "./filters"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { VisibilityMarks } from "./VisibilityMarks"
import { SETTINGS_TABS } from "./settings-tabs"
import { panelTitle, SidePanelFrame } from "./Surface"
import {
  createDraft, kept, marks, me, moveDoc, open, openInbox, openSettings, setAudience, setFilters, setRepoMode, setScope, setShowVisibility, useWorkspace,
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

const AUDIENCES: { id: Audience; label: string; note: string; icon: LucideIcon }[] = [
  { id: "personal", label: "You", note: "As you: everything, your vault and your cortex.", icon: LockIcon },
  { id: "friends", label: "Friends", note: "As a friend: posts for friends, and for everyone.", icon: UsersIcon },
  { id: "public", label: "Public", note: "As anyone: posts for everyone.", icon: GlobeIcon },
]

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

/**
 * One of the repo's two prime folders: its own icon (PrimeIcon) and its name, bold forest. The icon is an
 * outline when closed and filled when open, so open and closed read at a glance.
 */
function PrimeRow({ prime, open: isOpen, onOpen, locked, onExpandAll, allOpen, onOnly, onNew }: {
  prime: "cortex" | "vault"; open: boolean; onOpen: () => void; locked?: boolean
  onExpandAll: () => void; allOpen: boolean; onOnly: () => void; onNew?: () => void
}) {
  const [menu, setMenu] = useState(false)
  const run = (k: string) => {
    if (k === "e") onExpandAll()
    else if (k === "o") onOnly()
    else if (k === "n" && onNew) onNew()
    else return false
    setMenu(false)
    return true
  }
  return (
    <div className="group/prime relative" onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && run(e.key.toLowerCase())) e.preventDefault() }}>
      <button type="button" aria-expanded={isOpen} onClick={onOpen} disabled={locked}
        className="ux-row flex w-full items-center gap-1.5 px-1.5 pe-8 text-left">
        <Icon icon={isOpen ? ChevronDownIcon : ChevronRightIcon} size="sm" className={cn("text-muted-foreground", locked && "invisible")} />
        <PrimeIcon kind={prime} filled={isOpen} className="text-primary dark:text-foreground" />
        <span className="text-body font-bold text-primary dark:text-foreground">{prime}</span>
        {locked && <Icon icon={LockIcon} size="xs" className="ms-auto text-muted-foreground" aria-label="Only you see your cortex" />}
      </button>
      {!locked && (
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`More for ${prime}`}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color] duration-(--ohm-duration-press) group-hover/prime:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 aria-expanded:bg-foreground/10 aria-expanded:opacity-100" />
          }>
            <Icon icon={EllipsisIcon} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" sideOffset={6} className="w-56"
            onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && run(e.key.toLowerCase())) e.preventDefault() }}>
            {onNew && <DropdownMenuItem onClick={() => run("n")}>New page<DropdownMenuShortcut>N</DropdownMenuShortcut></DropdownMenuItem>}
            <DropdownMenuItem onClick={() => run("e")}>{allOpen ? "Collapse all" : "Expand all"}<DropdownMenuShortcut>E</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => run("o")}>Show only {prime}<DropdownMenuShortcut>O</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function RepoPanel() {
  const { view, rev, repoMode, scope, audience, showVisibility } = useWorkspace()
  const { filters } = useWorkspace()
  const filtering = activeCount(filters) > 0
  const cortexTree = useMemo(() => toTree("cortex", cortex.filter(kept), ["memories", "notes", "skills", "tools"]), [rev, filters]) // eslint-disable-line react-hooks/exhaustive-deps
  const vaultDocs = useMemo(() => posts.filter(p => sees(audience, p) && !marks.archived.has(p.id) && kept(p)), [rev, audience, filters]) // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = posts.concat(cortex).filter(d => marks.pinned.has(d.id) && (d.kind !== "post" || sees(audience, d)) && kept(d))
  const archived = posts.filter(d => marks.archived.has(d.id) && kept(d))
  const [showArchived, setShowArchived] = useState(false)
  const [rows, setRows] = useState<HTMLDivElement | null>(null)
  const vaultTree = useMemo(() => toTree("vault", vaultDocs), [vaultDocs])
  const showCortex = scope.cortex, showVault = scope.vault
  const treeRef = useRef<HTMLDivElement | null>(null)
  useTreeDragDrop(treeRef, [repoMode])
  const cortexLocked = audience !== "personal"
  const allFolders = useMemo(() => [
    ...(showCortex ? ["prime:cortex", ...folderIds(cortexTree)] : []),
    ...(showVault ? ["prime:vault", ...folderIds(vaultTree)] : []),
  ], [cortexTree, vaultTree, showCortex, showVault])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["prime:cortex", "prime:vault", ...folderIds(vaultTree)]))
  // The tree follows the open page: when something asks to be revealed (a page opened from anywhere,
  // or a folder from the path pill), the way to it opens, it scrolls into view and flashes once.
  const { reveal } = useWorkspace()
  useEffect(() => {
    if (!reveal || repoMode !== "tree") return
    const doc = byId(reveal.target)
    const [prime, path] = doc ? [doc.kind === "post" ? "vault" : "cortex", doc.sublabel ? `${doc.label}/${doc.sublabel}` : doc.label]
      : (reveal.target.split(":") as [string, string])
    const parts = path.split("/")
    const ways = [`prime:${prime}`, ...parts.map((_, i) => `${prime}:${parts.slice(0, i + 1).join("/")}`)]
    setExpanded(s => (ways.every(w => s.has(w)) ? s : new Set([...s, ...ways])))
    const t = setTimeout(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(`[data-slot=file-tree-item][data-id="${CSS.escape(reveal.target)}"]`)
      if (!row) return
      row.scrollIntoView({ block: "nearest", behavior: "smooth" })
      row.setAttribute("data-flash", "")
      setTimeout(() => row.removeAttribute("data-flash"), 900)
    }, 60)
    return () => clearTimeout(t)
  }, [reveal?.n, repoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtering opens every folder, so what matches is in view.
  useEffect(() => { if (filtering) setExpanded(new Set(allFolders)) }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  // A renamed folder stays as open as it was, with its subfolders.
  useEffect(() => {
    const moved = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail
      setExpanded(s => new Set([...s].map(id => (id === `vault:${from}` || id.startsWith(`vault:${from}/`) ? `vault:${to}${id.slice(6 + from.length)}` : id))))
    }
    window.addEventListener("ohm:folder-renamed", moved)
    return () => window.removeEventListener("ohm:folder-renamed", moved)
  }, [])
  const everything = allFolders.length > 0 && allFolders.every(id => expanded.has(id))
  // One prime folder's own expand-all, from its ⋯.
  const primeFolders = (p: "cortex" | "vault") => [`prime:${p}`, ...folderIds(p === "cortex" ? cortexTree : vaultTree)]
  const primeAllOpen = (p: "cortex" | "vault") => primeFolders(p).every(id => expanded.has(id))
  const expandPrime = (p: "cortex" | "vault") => {
    const ids = primeFolders(p), open = !primeAllOpen(p)
    setExpanded(s => { const n = new Set(s); for (const id of ids) open ? n.add(id) : n.delete(id); return n })
  }
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
        {/* The eye: click shows who each page is for; hover chooses who you are looking as. */}
        <Popover>
          <PopoverTrigger openOnHover delay={150} closeDelay={200} render={
            <Button size="icon-sm" variant="ghost" className={cn(toggle, audience !== "personal" && "text-primary dark:text-(--ohm-green-light)")}
              aria-label="Show who each page is for" aria-pressed={showVisibility} onClick={() => setShowVisibility(!showVisibility)} />
          }>
            <Icon icon={showVisibility ? EyeIcon : EyeOffIcon} size="sm" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 gap-0 p-1">
            <p className="px-2.5 pt-1.5 pb-1 text-small text-muted-foreground">View as</p>
            <div role="radiogroup" aria-label="View as" className="flex flex-col">
              {AUDIENCES.map(a => (
                <button key={a.id} type="button" role="radio" aria-checked={audience === a.id} onClick={() => setAudience(a.id)} title={a.note}
                  className="ux-menu-row flex w-full items-center gap-2 text-left">
                  <Icon icon={a.icon} size="sm" className="text-muted-foreground" />
                  <span className="flex-1">{a.label}</span>
                  <Icon icon={CheckIcon} size="sm" className={cn(audience !== a.id && "invisible")} />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <FilterMenu />
        {/* One switch: it shows the view you would go to. */}
        <Button size="icon-sm" variant="ghost" className="text-muted-foreground"
          aria-label={repoMode === "tree" ? "Show as graph" : "Show as list"} title={repoMode === "tree" ? "Graph" : "List"}
          onClick={() => setRepoMode(repoMode === "tree" ? "graph" : "tree")}>
          <Icon icon={repoMode === "tree" ? NetworkIcon : ListTreeIcon} size="sm" />
        </Button>
      </>}
    >
      {repoMode === "tree" ? (
        <div ref={el => { treeRef.current = el; setRows(el) }} data-show-visibility={showVisibility || undefined} className="relative flex flex-col gap-0.5 [&_[data-drop]]:bg-primary/10 [&_[data-drop]]:ring-1 [&_[data-drop]]:ring-primary/40">
          {pinned.length > 0 && <>
            <p className="px-2 pt-1 pb-0.5 text-small text-muted-foreground">Pinned</p>
            {pinned.map(d => (
              <button key={d.id} type="button" data-row-id={d.id} aria-current={selected === d.id || undefined} onClick={() => open(d.id)}
                className="ux-row flex w-full items-center gap-2 px-2.5 pe-8 text-left text-body">
                <span className="truncate">{d.icon ? `${d.icon} ` : ""}{titleOf(d)}</span>
              </button>
            ))}
            <div className="h-2" />
          </>}
          {filtering && vaultDocs.length + cortexTree.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-small text-muted-foreground">
              Nothing matches the filter.
              <Button size="xs" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>Clear filter</Button>
            </div>
          )}
          {!showCortex && !showVault && (
            <p className="px-2 py-6 text-center text-small text-muted-foreground">Choose Cortex or Vault from the menu above.</p>
          )}
          {showCortex && <>
            <PrimeRow prime="cortex" locked={cortexLocked} open={!cortexLocked && expanded.has("prime:cortex")} onOpen={() => flip("prime:cortex")}
              allOpen={primeAllOpen("cortex")} onExpandAll={() => expandPrime("cortex")} onOnly={() => setScope({ cortex: true, vault: false })} />
            {!cortexLocked && expanded.has("prime:cortex") && (
              <FileTree aria-label="cortex" className="ms-4 [--tree-inset:1rem] animate-in fade-in-0 slide-in-from-top-1 duration-(--ohm-duration-open)" nodes={cortexTree}
                expanded={expanded} onExpandedChange={setExpanded} selected={selected} onSelect={id => open(id)} />
            )}
          </>}
          {showVault && <>
            <PrimeRow prime="vault" open={expanded.has("prime:vault")} onOpen={() => flip("prime:vault")}
              allOpen={primeAllOpen("vault")} onExpandAll={() => expandPrime("vault")} onOnly={() => setScope({ cortex: false, vault: true })}
              onNew={() => createDraft()} />
            {expanded.has("prime:vault") && (
              <FileTree aria-label="vault" className="ms-4 [--tree-inset:1rem] animate-in fade-in-0 slide-in-from-top-1 duration-(--ohm-duration-open)" nodes={vaultTree}
                expanded={expanded} onExpandedChange={setExpanded} selected={selected} onSelect={id => open(id)} />
            )}
          </>}
          {archived.length > 0 && <>
            <button type="button" onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}
              className="ux-row mt-2 flex w-full items-center gap-1.5 px-1.5 text-left text-small text-muted-foreground">
              <Icon icon={showArchived ? ChevronDownIcon : ChevronRightIcon} size="sm" />Archived · {archived.length}
            </button>
            {showArchived && archived.map(d => (
              <button key={d.id} type="button" data-row-id={d.id} aria-current={selected === d.id || undefined} onClick={() => open(d.id)}
                className="ux-row ms-4 flex items-center gap-2 px-2.5 pe-8 text-left text-body text-muted-foreground">
                <span className="truncate">{titleOf(d)}</span>
              </button>
            ))}
          </>}
          <RowMenu container={rows} />
          <VisibilityMarks container={rows} />
        </div>
      ) : (
        <div className="-mx-1 flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-background">
          <GraphView />
        </div>
      )}
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
        /* You: picture, then name with handle under it. */
        <div className="flex min-w-0 items-center gap-3 px-1.5 pt-2">
          <Avatar className="size-12 flex-none"><AvatarFallback className="bg-primary text-body text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-(length:--ohm-type-title-size) leading-(--ohm-type-title-leading) font-semibold">{me.name}</span>
            <span className="truncate text-small text-muted-foreground">@{me.handle}</span>
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
  if (side === "inbox") return <InboxPanel />
  if (side === "profile") return <ProfilePanel />
  return null
}

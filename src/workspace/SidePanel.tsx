import { useMemo } from "react"
import { FileTree, FileTreePanel, type FileTreeNode } from "@/components/ui/file-tree"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cortex, posts, type Doc } from "@/data/sample"
import { open, useWorkspace } from "./store"

/** label › sublabel › item, as folders. Ids of folders are prefixed so they never collide with docs. */
function toTree(docs: Doc[], order?: string[]): FileTreeNode[] {
  const labels = new Map<string, Map<string | undefined, Doc[]>>()
  for (const d of docs) {
    const subs = labels.get(d.label) ?? new Map()
    subs.set(d.sublabel, [...(subs.get(d.sublabel) ?? []), d])
    labels.set(d.label, subs)
  }
  const names = [...labels.keys()].sort((a, b) => {
    const ia = order?.indexOf(a) ?? -1, ib = order?.indexOf(b) ?? -1
    if (a === "other") return 1
    if (b === "other") return -1
    return ia === -1 || ib === -1 ? a.localeCompare(b) : ia - ib
  })
  return names.map(label => {
    const subs = labels.get(label)!
    const leaf = (d: Doc) => ({ id: d.id, name: d.title })
    const children: FileTreeNode[] = [
      ...[...subs].filter(([s]) => s).map(([s, list]) => ({ id: `dir:${label}/${s}`, name: s!, children: list.map(leaf) })),
      ...(subs.get(undefined) ?? []).map(leaf),
    ]
    return { id: `dir:${label}`, name: label, children }
  })
}

/** A static, read-only view of the repository: the vault or the cortex. */
export function SidePanel() {
  const { side, view, rev } = useWorkspace()
  const nodes = useMemo(
    () => (side === "cortex" ? toTree(cortex, ["memories", "notes", "skills", "tools"]) : toTree(posts)),
    // rev: a saved draft changes the vault
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [side, rev],
  )
  if (!side) return null
  const expanded = nodes.flatMap(n => [n.id, ...(n.children ?? []).filter(c => c.children).map(c => c.id)])
  return (
    <FileTreePanel
      aria-label={side === "vault" ? "Vault" : "Cortex"}
      className="absolute inset-y-0 left-14 z-20 w-64 shade-4 md:static md:z-auto md:shadow-none"
    >
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-h3 capitalize">{side}</h2>
        <p className="text-small text-muted-foreground">Read-only, from the repository</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <FileTree
          key={side}
          aria-label={side}
          className="px-2 pb-4"
          nodes={nodes}
          defaultExpanded={expanded}
          selected={view.kind === "doc" ? view.id : null}
          onSelect={id => open(id)}
        />
      </ScrollArea>
    </FileTreePanel>
  )
}

import type { LucideIcon } from "lucide-react"
import { NetworkIcon, BrainIcon, LibraryIcon } from "lucide-react"
import { Icon } from "@/components/ui/icon"
import { icons } from "@/lib/icons"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/cn"
import { createDraft, setSearchOpen, showGraph, toggleSide, useWorkspace } from "./store"

function RackButton({ icon, label, shortcut, active, onClick }: {
  icon: LucideIcon; label: string; shortcut?: string; active?: boolean; onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none",
              "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
              "aria-pressed:bg-muted aria-pressed:text-foreground",
            )}
          />
        }
      >
        <Icon icon={icon} />
      </TooltipTrigger>
      <TooltipContent side="right">
        {label} {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** The rack: the narrow column of icons on the left. */
export function Rack({ onTheme }: { onTheme: () => void }) {
  const { side, view, searchOpen } = useWorkspace()
  return (
    <nav aria-label="Workspace" className="flex w-14 shrink-0 flex-col items-center gap-1 bg-sidebar py-3">
      <span aria-hidden className="mb-3 size-2.5 rounded-full bg-primary" />
      <RackButton icon={icons.search} label="Search" shortcut="⌘K" active={searchOpen} onClick={() => setSearchOpen(true)} />
      <RackButton icon={icons.write} label="New post" shortcut="⌘N" onClick={() => createDraft()} />
      <div className="my-2 h-px w-6 bg-sidebar-border" />
      <RackButton icon={BrainIcon} label="Cortex" active={side === "cortex"} onClick={() => toggleSide("cortex")} />
      <RackButton icon={LibraryIcon} label="Vault" active={side === "vault"} onClick={() => toggleSide("vault")} />
      <RackButton icon={NetworkIcon} label="Graph" shortcut="⌘G" active={view.kind === "graph"} onClick={() => showGraph()} />
      <div className="flex-1" />
      <RackButton icon={icons.theme} label="Light or dark" onClick={onTheme} />
    </nav>
  )
}

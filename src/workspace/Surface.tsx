import type { ReactNode } from "react"
import { cn } from "@/lib/cn"

/**
 * The two panels' material, after agentic-twitter's directory and centre: a card lifted off the
 * page by shade in light and by tone in dark, with small corners (the item radius, not the card's).
 */
export const surface = "rounded-md bg-card text-card-foreground"

/** A side panel: heading on top, then its own scroll. */
export function SidePanelFrame({ label, heading, actions, children, className, scroll = true }: {
  label: string; heading: ReactNode; actions?: ReactNode; children: ReactNode; className?: string
  /** False when the content fills the panel and handles its own space, as the graph does. */
  scroll?: boolean
}) {
  return (
    <aside aria-label={label} className={cn(surface, "flex min-h-0 flex-col px-4 pt-3 pb-3 shade-3", className)}>
      <header className="flex min-h-[42px] items-center justify-between gap-2 pb-4">
        <div className="min-w-0 flex-1">{heading}</div>
        {actions && <div className="flex items-center gap-0.5">{actions}</div>}
      </header>
      <div className={cn("-mx-2 flex min-h-0 flex-1 flex-col px-2", scroll ? "overflow-y-auto overscroll-contain pb-2" : "overflow-hidden")}>{children}</div>
    </aside>
  )
}

/** The panel title: ohm's title role, the same as a panel's. */
export const panelTitle = "text-(length:--ohm-type-title-size) leading-(--ohm-type-title-leading) font-semibold tracking-(--ohm-type-title-tracking)"

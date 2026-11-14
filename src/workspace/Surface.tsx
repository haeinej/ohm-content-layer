import { useRef, type ReactNode } from "react"
import { cn } from "@/lib/cn"
import { setSideWidth, SIDE_WIDTH, useWorkspace } from "./store"

/**
 * The two panels' material, after agentic-twitter's directory and centre: a card lifted off the
 * page by shade in light and by tone in dark, with small corners (the item radius, not the card's).
 */
export const surface = "rounded-md bg-card text-card-foreground"

/** The handle on a side panel's right edge: drag to resize, arrows to nudge, double-click to reset. */
function ResizeHandle() {
  const { sideWidth } = useWorkspace()
  const start = useRef<{ x: number; w: number } | null>(null)
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
      aria-valuenow={sideWidth} aria-valuemin={SIDE_WIDTH.min} aria-valuemax={SIDE_WIDTH.max}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, w: sideWidth } }}
      onPointerMove={e => { if (start.current) setSideWidth(start.current.w + e.clientX - start.current.x) }}
      onPointerUp={() => { start.current = null }}
      onDoubleClick={() => setSideWidth(SIDE_WIDTH.initial)}
      onKeyDown={e => {
        if (e.key === "ArrowLeft") { e.preventDefault(); setSideWidth(sideWidth - 16) }
        if (e.key === "ArrowRight") { e.preventDefault(); setSideWidth(sideWidth + 16) }
      }}
      className="group/handle absolute inset-y-3 -right-[9px] z-10 flex w-[6px] cursor-col-resize touch-none justify-center outline-none max-md:hidden">
      <span className="h-full w-[2px] rounded-full bg-transparent transition-colors duration-(--ohm-duration-state) group-hover/handle:bg-border group-focus-visible/handle:bg-primary group-active/handle:bg-primary" />
    </div>
  )
}

/** A side panel: heading on top, then its own scroll; resized from its right edge. */
export function SidePanelFrame({ label, heading, actions, children, className, scroll = true }: {
  label: string; heading: ReactNode; actions?: ReactNode; children: ReactNode; className?: string
  /** False when the content fills the panel and handles its own space, as the graph does. */
  scroll?: boolean
}) {
  const { sideWidth } = useWorkspace()
  return (
    <aside aria-label={label} style={{ "--side-width": `${sideWidth}px` } as React.CSSProperties}
      className={cn(surface, "relative flex min-h-0 w-(--side-width) shrink-0 flex-col px-3 pt-3 pb-3 shade-3",
        "max-md:absolute max-md:inset-y-3 max-md:left-[68px] max-md:z-20 max-md:w-[calc(100%-80px)]", className)}>
      <header className="flex min-h-10 items-center justify-between gap-2 pb-3">
        <div className="min-w-0 flex-1">{heading}</div>
        {actions && <div className="flex items-center gap-0.5">{actions}</div>}
      </header>
      <div className={cn("-mx-2 flex min-h-0 flex-1 flex-col px-2", scroll ? "overflow-y-auto overscroll-contain pb-2" : "overflow-hidden")}>{children}</div>
      <ResizeHandle />
    </aside>
  )
}

/** The panel title: ohm's title role, the same as a panel's. */
export const panelTitle = "text-(length:--ohm-type-title-size) leading-(--ohm-type-title-leading) font-semibold tracking-(--ohm-type-title-tracking)"

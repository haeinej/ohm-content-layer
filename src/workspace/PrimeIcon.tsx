import { cn } from "@/lib/cn"

/**
 * The repository's two prime folders, drawn here so they can be filled. Lucide draws with open strokes,
 * which blot when filled; these are each one closed shape and one inner mark. Outline when closed;
 * filled when open, with the inner mark cut out in the panel's tone. Lucide's grid and stroke (24, 2).
 */
const SHAPES = {
  // Two lobes, one seam.
  cortex: {
    body: "M12 4.6C11 3.3 9.4 3 8 3.6 6.3 4.3 5.5 5.9 5.7 7.4 4.1 8 3 9.5 3 11.2c0 1.2.5 2.3 1.4 3-.5 1.8.1 3.7 1.7 4.7 1 .6 2.1.8 3.1.5.6 1.1 1.7 1.6 2.8 1.6s2.2-.5 2.8-1.6c1 .3 2.1.1 3.1-.5 1.6-1 2.2-2.9 1.7-4.7.9-.7 1.4-1.8 1.4-3 0-1.7-1.1-3.2-2.7-3.8.2-1.5-.6-3.1-2.3-3.8-1.4-.6-3-.3-4 1Z",
    mark: "M12 4.6V20",
  },
  // A rounded box and a dot.
  vault: {
    body: "M7 4h10a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z",
    mark: "M12 12h.01",
  },
} as const

export function PrimeIcon({ kind, filled, className }: { kind: keyof typeof SHAPES; filled: boolean; className?: string }) {
  const { body, mark } = SHAPES[kind]
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-icon shrink-0", className)}
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={body} className="transition-[fill] duration-(--ohm-duration-state) ease-(--ohm-ease-out)" fill={filled ? "currentColor" : "transparent"} />
      <path d={mark} strokeWidth={kind === "vault" ? 3.5 : 2}
        className="transition-[stroke] duration-(--ohm-duration-state) ease-(--ohm-ease-out)"
        style={filled ? { stroke: "var(--ohm-card)" } : undefined} />
    </svg>
  )
}

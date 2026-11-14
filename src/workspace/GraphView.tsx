import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { buildGraph, type GraphNode } from "@/graph/layout"
import { cn } from "@/lib/cn"
import { me, open, showGraph, useWorkspace } from "./store"

const NODE = { 0: 22, 1: 12, 2: 7, 3: 10 } as const

/** The graph, centred on one person. Rings: person, groups, posts, other people. */
export function GraphView({ center }: { center: string }) {
  const { rev } = useWorkspace()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(() => buildGraph(center), [center, rev])
  const [hover, setHover] = useState<string | null>(null)
  const [focusGroup, setFocusGroup] = useState<string | null>(null)
  const byId = new Map(g.nodes.map(n => [n.id, n]))
  const near = useMemo(() => {
    if (!hover) return null
    const s = new Set([hover])
    for (const e of g.edges) {
      if (e.from === hover) s.add(e.to)
      if (e.to === hover) s.add(e.from)
    }
    return s
  }, [hover, g])

  const dim = (n: GraphNode) =>
    (near && !near.has(n.id)) || (focusGroup && "group" in n && n.group !== focusGroup)

  const select = (n: GraphNode) => {
    if (n.type === "doc") open(n.doc.id)
    else if (n.type === "group") setFocusGroup(focusGroup === n.group ? null : n.group)
    else if (n.ring === 3) showGraph(n.person.handle)
  }

  const isMe = g.center.did === me.did
  const title = (n: GraphNode) => n.type === "person" ? `@${n.person.handle}` : n.type === "group" ? n.name : n.doc.title

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-6 pt-4">
        <p className="text-small text-muted-foreground">
          Centred on <span className="text-foreground">@{g.center.handle}</span> · {g.nodes.length - 1} around
          {!isMe && " · posts that mention them"}
        </p>
        {!isMe && <Button size="sm" variant="ghost" onClick={() => showGraph()}>Back to me</Button>}
      </div>
      <svg
        role="img"
        aria-label={`Graph centred on @${g.center.handle}`}
        viewBox={`0 0 ${g.size} ${g.size}`}
        className="min-h-0 w-full flex-1 select-none"
      >
        {[150, 290, 430].map(r => (
          <circle key={r} cx={g.size / 2} cy={g.size / 2} r={r} className="fill-none stroke-border" strokeDasharray="2 6" />
        ))}
        {g.edges.map((e, i) => {
          const a = byId.get(e.from)!, b = byId.get(e.to)!
          const on = near ? near.has(e.from) && near.has(e.to) : true
          if (e.kind === "link") {
            const mx = g.size / 2 + ((a.x + b.x) / 2 - g.size / 2) * 0.55
            const my = g.size / 2 + ((a.y + b.y) / 2 - g.size / 2) * 0.55
            return <path key={i} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
              className={cn("fill-none stroke-muted-foreground transition-opacity", on ? "opacity-50" : "opacity-10")} strokeDasharray="4 4" />
          }
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={cn("transition-opacity", e.kind === "mention" ? "stroke-muted-foreground" : "stroke-border", on ? "opacity-80" : "opacity-10")} />
        })}
        {g.nodes.map(n => {
          const r = NODE[n.ring]
          const vis = n.type === "doc" ? n.doc.visibility : "public"
          const showLabel = n.ring !== 2 || hover === n.id || (focusGroup && n.type === "doc" && n.group === focusGroup)
          const right = n.x >= g.size / 2
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={title(n)}
              className={cn("cursor-pointer outline-none transition-opacity", dim(n) && "opacity-25")}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              onClick={() => select(n)}
              onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(n))}
            >
              <title>{title(n)}</title>
              {n.ring === 0 && <circle cx={n.x} cy={n.y} r={r + 8} className="fill-none stroke-muted-foreground" strokeDasharray="3 4" />}
              <circle
                cx={n.x} cy={n.y} r={r}
                className={cn(
                  "stroke-2",
                  n.ring === 0 ? "fill-primary stroke-primary"
                    : n.type === "group" ? "fill-background stroke-foreground"
                    : n.type === "person" ? "fill-muted stroke-muted-foreground"
                    : vis === "public" ? "fill-foreground stroke-foreground"
                    : vis === "friends" ? "fill-muted-foreground stroke-muted-foreground"
                    : "fill-background stroke-foreground",
                  (hover === n.id) && "stroke-primary",
                )}
              />
              {showLabel && (
                <text
                  x={n.ring === 0 ? n.x : n.x + (right ? r + 8 : -r - 8)}
                  y={n.ring === 0 ? n.y + r + 26 : n.y + 5}
                  textAnchor={n.ring === 0 ? "middle" : right ? "start" : "end"}
                  // Sizes in viewBox units: the drawing scales as a whole.
                  fontSize={n.ring === 0 ? 20 : n.ring === 1 ? 17 : 15}
                  className={cn("fill-foreground", n.ring <= 1 && "font-semibold")}
                >
                  {n.ring === 0 ? `@${n.person.handle}` : title(n)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-4 text-small text-muted-foreground" aria-label="Key">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-foreground" />Public</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-muted-foreground" />Friends</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-foreground" />Private</li>
        <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" />Link</li>
        <li>Select a person to centre on them</li>
      </ul>
    </div>
  )
}

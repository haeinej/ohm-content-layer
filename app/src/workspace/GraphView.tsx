// The graph, as Obsidian's graph view behaves: a live force layout you pan, zoom and drag; nodes
// sized by how connected they are; hovering lights a node and its edges and fades everything else;
// dragging pulls the neighbours along on springs and lets them wobble back; labels come in as you
// zoom.
//
// Only blocks are nodes (graph/model.ts). Channels are a dimension of the blocks, not nodes: each
// channel is a soft area drawn around its blocks, a channel inside it is a dashed area inside that,
// and every block is pulled toward the channels it is in, so a block in two channels settles where
// their areas meet. An edge is a link in the text (grey) or a connection between whole blocks
// (forest), and it is thicker the more two blocks share: each way they are joined, each channel.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force"
import { select } from "d3-selection"
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom"
import { MaximizeIcon, MinusIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { buildGraph, DEFAULT_FILTERS, type GraphChannel, type GraphEdge, type GraphNode } from "@/graph/model"
import { cn } from "@/lib/cn"
import { kept, me, open, scopeFolders, showGraph, useWorkspace } from "./store"

type SimNode = GraphNode & SimulationNodeDatum
type SimLink = SimulationLinkDatum<SimNode> & GraphEdge

/** Where each node was last, so re-centring or filtering moves nodes instead of re-scattering them. */
const last = new Map<string, { x: number; y: number }>()

const radiusOf = (n: GraphNode) => 4 + Math.sqrt(n.degree) * 1.6
/** Thicker the stronger: one for each way two blocks are joined and each channel they share. */
const widthOf = (e: GraphEdge) => Math.min(4, 0.8 + (e.weight - 1) * 0.7)
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** How far a top-level channel sits from the middle, and a channel inside it from its parent. */
const SPREAD = 230
const INNER = 85
/** How much room an area leaves around its blocks: more for a channel, less for one inside it. */
const PAD = [30, 16, 10]

/** The smallest convex polygon around some points (Andrew's monotone chain). */
function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = [], upper: [number, number][] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop(); lower.push(q) }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop(); upper.push(q) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** A channel's area: the hull of a ring of points around each of its blocks, so it is rounded. */
function areaOf(channel: GraphChannel, at: Map<string, SimNode>) {
  const pad = PAD[Math.min(channel.depth, PAD.length - 1)]
  const ring: [number, number][] = []
  for (const id of channel.members) {
    const n = at.get(id)
    if (!n || n.x === undefined) continue
    const r = radiusOf(n) + pad
    for (let i = 0; i < 12; i++) ring.push([n.x + Math.cos((i / 12) * Math.PI * 2) * r, n.y! + Math.sin((i / 12) * Math.PI * 2) * r])
  }
  const outline = hull(ring)
  if (outline.length < 3) return null
  const top = outline.reduce((a, b) => (b[1] < a[1] ? b : a))
  return { d: `M${outline.map(p => p.join(",")).join("L")}Z`, label: top }
}

/** A floating control over the graph: the popover surface, solid in dark. */
const floating = "rounded-2xl bg-popover text-popover-foreground shade-3"

/** Lives in the side panel, in the home. What it draws follows the repository's scope and who you are looking as. */
export function GraphView() {
  const { rev, scope, audience, graphCenter: center, view, filters: repoFilters } = useWorkspace()
  // The open page is ringed in the graph too: one active page, everywhere.
  const activeId = view.kind === "doc" ? view.id : null
  const include = useMemo(() => scopeFolders(scope), [scope])
  const [filters, setFilters] = useState({ links: DEFAULT_FILTERS.links, connections: DEFAULT_FILTERS.connections, areas: true })
  const graph = useMemo(() => buildGraph({ center, vault: include.vault, audience, links: filters.links, connections: filters.connections, keep: kept }), [center, include, audience, filters.links, filters.connections, repoFilters, rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const svgRef = useRef<SVGSVGElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const userMoved = useRef(false)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const [, setFrame] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  useEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Each top-level channel gets its own direction, spread evenly; a channel inside it sits a little
  // way out from it. Every block is pulled toward the middle of the channels it is in.
  const { nodes, links, aim } = useMemo(() => {
    const anchor = new Map<string, { x: number; y: number }>()
    const tops = graph.channels.filter(c => c.depth === 0)
    tops.forEach((c, i) => {
      const a = (i / Math.max(1, tops.length)) * Math.PI * 2 - Math.PI / 2
      anchor.set(c.path, tops.length === 1 ? { x: 0, y: 0 } : { x: Math.cos(a) * SPREAD, y: Math.sin(a) * SPREAD })
    })
    for (const c of graph.channels.filter(c => c.depth > 0)) {
      const siblings = graph.channels.filter(s => s.parent === c.parent)
      const a = (siblings.indexOf(c) / siblings.length) * Math.PI * 2
      const base = anchor.get(c.parent!) ?? { x: 0, y: 0 }
      anchor.set(c.path, { x: base.x + Math.cos(a) * INNER, y: base.y + Math.sin(a) * INNER })
    }
    const aim = new Map<string, { x: number; y: number }>()
    for (const n of graph.nodes) {
      const points = n.channels.map(c => anchor.get(c)).filter(Boolean) as { x: number; y: number }[]
      if (points.length) aim.set(n.id, { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length })
    }
    const nodes: SimNode[] = graph.nodes.map(n => {
      const target = aim.get(n.id) ?? { x: 0, y: 0 }
      return { ...n, ...(last.get(n.id) ?? { x: target.x + (Math.random() - 0.5) * 40, y: target.y + (Math.random() - 0.5) * 40 }) }
    })
    const links: SimLink[] = graph.edges.map(e => ({ ...e }))
    return { nodes, links, aim }
  }, [graph])

  useEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id(d => d.id).distance(90).strength(l => Math.min(0.5, 0.08 * l.weight)))
      .force("charge", forceManyBody<SimNode>().strength(-110).distanceMax(400))
      .force("collide", forceCollide<SimNode>(n => radiusOf(n) + 8).strength(0.8))
      .force("aimX", forceX<SimNode>(n => aim.get(n.id)?.x ?? 0).strength(0.09))
      .force("aimY", forceY<SimNode>(n => aim.get(n.id)?.y ?? 0).strength(0.09))
      // Soft springs, moderate friction and very slow cooling: nodes drift and settle like soft
      // rubber, over seconds, never snapping or stopping short.
      .velocityDecay(0.3)
      .alphaDecay(0.005)
      .alphaMin(0.0008)
    simRef.current = sim
    sim.stop().tick(reducedMotion() ? 500 : 180)
    const remember = () => nodes.forEach(n => last.set(n.id, { x: n.x!, y: n.y! }))
    remember()
    setFrame(f => f + 1)
    if (!reducedMotion()) sim.on("tick", () => { remember(); setFrame(f => f + 1) }).alpha(0.2).restart()
    return () => { sim.stop() }
  }, [nodes, links, aim])

  // Zoom and pan; pointer-downs on nodes drag them instead.
  useEffect(() => {
    const svg = select(svgRef.current!)
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 5])
      .filter(e => e.type === "wheel" || (!(e.target as Element).closest("[data-node]") && !e.button))
      .on("zoom", e => {
        setT(e.transform)
        // Once you pan or zoom yourself, the view stays where you put it.
        if (e.sourceEvent) userMoved.current = true
      })
    zoomRef.current = z
    svg.call(z).on("dblclick.zoom", null)
    return () => { svg.on(".zoom", null) }
  }, [])

  const fit = () => {
    if (!nodes.length || !svgRef.current || !zoomRef.current || !size.w) return
    const xs = nodes.map(n => n.x!), ys = nodes.map(n => n.y!)
    const pad = 80
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
    const k = Math.min(1.6, Math.max(0.25, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))))
    select(svgRef.current).call(zoomRef.current.transform,
      zoomIdentity.translate(size.w / 2 - (k * (minX + maxX)) / 2, size.h / 2 - (k * (minY + maxY)) / 2).scale(k))
  }
  // Keep the whole graph in view as the panel resizes and the layout settles, until you pan or
  // zoom yourself; a change in what is drawn starts that over.
  const shape = `${center}|${include.vault}|${audience}`
  useEffect(() => { userMoved.current = false }, [shape])
  const fitRef = useRef(fit)
  fitRef.current = fit
  useEffect(() => { if (size.w && !userMoved.current) fit() }, [size, shape]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sim = simRef.current
    sim?.on("end.fit", () => { if (!userMoved.current) fitRef.current() })
    return () => { sim?.on("end.fit", null) }
  }, [nodes])

  const zoomBy = (factor: number) => select(svgRef.current!).call(zoomRef.current!.scaleBy, factor)

  // The lit node: the one under the pointer, or the one being dragged.
  const lit = dragging ?? hover
  const near = useMemo(() => {
    if (!lit) return null
    const s = new Set([lit])
    for (const l of links) {
      const a = (l.source as SimNode).id, b = (l.target as SimNode).id
      if (a === lit) s.add(b)
      if (b === lit) s.add(a)
    }
    return s
  }, [lit, links])
  const litChannels = useMemo(() => new Set(lit ? nodes.find(n => n.id === lit)?.channels.flatMap(c => c.split("/").map((_, i, all) => all.slice(0, i + 1).join("/"))) : []), [lit, nodes])

  // Dragging pins the node under the pointer and keeps the layout warm, so neighbours follow on
  // their springs; letting go releases it to wobble back. A press without movement is a click.
  const drag = useRef<{ id: string; moved: boolean; x0: number; y0: number } | null>(null)
  const toGraph = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return t.invert([e.clientX - r.left, e.clientY - r.top])
  }
  const onDown = (e: React.PointerEvent, n: SimNode) => {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { id: n.id, moved: false, x0: e.clientX, y0: e.clientY }
  }
  const onMove = (e: React.PointerEvent, n: SimNode) => {
    const d = drag.current
    if (!d || d.id !== n.id) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return
    if (!d.moved) { d.moved = true; setDragging(n.id) }
    const [x, y] = toGraph(e)
    n.fx = x; n.fy = y
    if (!reducedMotion()) simRef.current?.alphaTarget(0.12).restart()
    else { simRef.current?.tick(1); setFrame(f => f + 1) }
  }
  const onUp = (n: SimNode) => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    n.fx = null; n.fy = null
    simRef.current?.alphaTarget(0)
    if (d && !d.moved) open(n.doc.id)
  }

  const isMe = graph.center.did === me.did
  const k = t.k
  // Block labels fade in between these zoom levels; channel labels always show.
  const detail = Math.max(0, Math.min(1, (k - 0.9) / 0.5))
  const byId = new Map(nodes.map(n => [n.id, n]))
  const areas = filters.areas ? graph.channels.map(c => ({ c, area: areaOf(c, byId) })).filter(a => a.area) : []

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden">
      <svg ref={svgRef} role="img" aria-label={isMe ? "Graph of your blocks" : `Graph of your blocks that mention @${graph.center.handle}`}
        className={cn("absolute inset-0 size-full touch-none select-none", dragging ? "cursor-grabbing" : "cursor-grab")}>
        <g transform={t.toString()}>
          {/* Channels: an area around their blocks, a channel inside it dashed. Outer ones first, so inner ones sit on top. */}
          {areas.map(({ c, area }) => {
            const on = lit ? litChannels.has(c.path) : null
            return (
              <path key={c.path} d={area!.d} vectorEffect="non-scaling-stroke" strokeWidth={1} strokeLinejoin="round"
                strokeDasharray={c.depth > 0 ? "4 4" : undefined}
                className={cn("transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
                  c.depth === 0 ? "fill-foreground/[.04] stroke-foreground/15" : "fill-foreground/[.03] stroke-foreground/20",
                  on === false && "opacity-40")} />
            )
          })}
          {links.map((l, i) => {
            const a = l.source as SimNode, b = l.target as SimNode
            const on = lit ? a.id === lit || b.id === lit : null
            const connected = l.wholeBlock
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke"
                strokeWidth={widthOf(l) + (on ? 0.4 : 0)} strokeLinecap="round"
                className={cn(
                  // A link in the text grey; a connection you made between whole blocks forest; the
                  // lit node's edges forest too.
                  "transition-[opacity,stroke] duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
                  on || connected ? "stroke-primary dark:stroke-foreground" : "stroke-muted-foreground",
                  on === false ? "opacity-[.07]" : on ? "opacity-100" : connected ? "opacity-60" : "opacity-40",
                )}>
                {l.why && <title>{l.why}</title>}
              </line>
            )
          })}
          {nodes.map(n => {
            const r = radiusOf(n)
            const isLit = n.id === lit
            const faded = near && !near.has(n.id)
            return (
              <g key={n.id} data-node data-doc-id={n.doc.id} transform={`translate(${n.x},${n.y})`} role="button" tabIndex={0} aria-label={n.name}
                className={cn("cursor-pointer outline-none transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)", faded && "opacity-20")}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                onPointerDown={e => onDown(e, n)} onPointerMove={e => onMove(e, n)} onPointerUp={() => onUp(n)}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(n.doc.id))}>
                {/* A larger, invisible target: small nodes are easy to hit. */}
                <circle r={Math.max(r + 6, 12)} className="fill-transparent" />
                {(isLit || n.doc.id === activeId) && <circle r={r + 3.5} className="fill-none stroke-primary dark:stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                <circle r={r} className={cn("transition-[fill] duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
                  isLit || n.doc.id === activeId ? "fill-primary dark:fill-foreground" : "fill-muted-foreground")} />
              </g>
            )
          })}
        </g>
        {/* Labels in screen space, so they stay one size at any zoom. */}
        <g className="pointer-events-none">
          {(() => {
            // A top-level channel is always named; one inside it once you zoom in or light a block in
            // it. Where areas overlap, a name that would sit on one already placed is left out.
            const placed: { x: number; y: number; w: number }[] = []
            return areas.map(({ c, area }) => {
              const lightUp = lit && litChannels.has(c.path)
              const show = c.depth === 0 ? 1 : lightUp ? 1 : detail
              if (!show) return null
              const [x, y] = t.apply(area!.label)
              const w = c.name.length * 7 + 8
              if (placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < 16)) return null
              placed.push({ x, y, w })
              const faded = lit && !litChannels.has(c.path)
              return (
                <text key={c.path} x={x} y={y - 6} textAnchor="middle" opacity={faded ? 0.3 : show}
                  className={cn("text-small transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)", c.depth === 0 ? "fill-foreground font-semibold" : "fill-muted-foreground")}>
                  {c.name}
                </text>
              )
            })
          })()}
          {nodes.map(n => {
            const show = near?.has(n.id) ? 1 : detail
            if (!show) return null
            const [x, y] = t.apply([n.x!, n.y!])
            const r = radiusOf(n) * k
            const faded = near && !near.has(n.id)
            return (
              <text key={n.id} x={x} y={y + r + 13} textAnchor="middle" opacity={faded ? 0.15 : show}
                className={cn("text-small transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)", n.id === lit ? "fill-foreground" : "fill-muted-foreground")}>
                {n.name.length > 32 ? `${n.name.slice(0, 31)}…` : n.name}
              </text>
            )
          })}
        </g>
      </svg>

      {/* Chrome floats over the graph; only the controls carry a material. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        <div className={cn(floating, "pointer-events-auto flex items-center gap-2 py-1 ps-3 pe-1 text-small")}>
          <span className="size-2 rounded-full bg-primary dark:bg-foreground" aria-hidden />
          <span className="truncate font-semibold">{isMe ? "Your blocks" : `Mentioning @${graph.center.handle}`}</span>
          <span className="text-muted-foreground max-[420px]:hidden">· {graph.nodes.length}</span>
          {!isMe ? <Button size="xs" variant="ghost" onClick={() => showGraph()}>Back to me</Button> : <span className="w-1" />}
        </div>
        <Popover>
          <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Graph settings" className={cn(floating, "pointer-events-auto")} />}>
            <Icon icon={SlidersHorizontalIcon} size="sm" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 gap-0 p-2">
            <p className="px-1.5 pb-1 text-small text-muted-foreground">Show</p>
            {([
              ["links", "Links in the text"],
              ["connections", "Connections"],
              ["areas", "Channel areas"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-1.5 text-body hover:bg-muted">
                {label}
                <Switch checked={filters[key]} onCheckedChange={v => setFilters(f => ({ ...f, [key]: v }))} />
              </label>
            ))}
            <Button size="sm" variant="secondary" className="mt-1.5 h-8 w-full"
              onClick={() => { last.clear(); userMoved.current = false; setFilters(f => ({ ...f })) }}>
              Lay out again
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
        <ul aria-label="Key" className={cn(floating, "pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1 text-small text-muted-foreground")}>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" />Block</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-md border border-foreground/15 bg-foreground/[.04]" />Channel</li>
          <li className="flex items-center gap-1.5"><span className="h-px w-3 bg-muted-foreground" />Link in the text</li>
          <li className="flex items-center gap-1.5"><span className="h-px w-3 bg-primary dark:bg-foreground" />Connection</li>
          <li className="flex items-center gap-1.5"><span className="h-[3px] w-3 rounded-full bg-muted-foreground" />Stronger</li>
        </ul>
        <div className={cn(floating, "pointer-events-auto flex flex-col p-0.5")} role="group" aria-label="Zoom">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(1.3)}><Icon icon={PlusIcon} size="sm" /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)}><Icon icon={MinusIcon} size="sm" /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Fit to view" onClick={fit}><Icon icon={MaximizeIcon} size="sm" /></Button>
        </div>
      </div>
    </div>
  )
}

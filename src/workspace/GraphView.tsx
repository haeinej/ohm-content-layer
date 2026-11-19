// The graph, as Obsidian's graph view behaves: a live force layout you pan, zoom and drag; nodes
// sized by how connected they are; hovering lights a node and its edges and fades everything else;
// dragging pulls the neighbours along on springs and lets them wobble back; labels come in as you
// zoom. Unlike a global graph it is centred on one person (graph/model.ts): the person is pinned
// at the centre and a soft radial force holds each layer at its distance, loosely enough that
// links between blocks can pull branches together. Evidence edges are grey; the cortex's
// inferences are drawn in its own light green, so a guess never looks like a fact.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force"
import { select } from "d3-selection"
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom"
import { MaximizeIcon, MinusIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { buildGraph, DEFAULT_FILTERS, familyOf, type EdgeKind, type GraphNode, type Layer } from "@/graph/model"
import { cn } from "@/lib/cn"
import { kept, me, open, scopeFolders, showGraph, useWorkspace } from "./store"

type SimNode = GraphNode & SimulationNodeDatum
type SimLink = SimulationLinkDatum<SimNode> & { kind: EdgeKind }

/** How far out each layer settles: you, the cortex, channels, channels inside them, blocks, sources and entities. */
const DISTANCE: Record<Layer, number> = { 0: 0, 1: 110, 2: 220, 3: 300, 4: 385, 5: 490 }
const ringOf = (n: GraphNode) => DISTANCE[n.layer]
const SPRING: Record<EdgeKind, { length: number; strength: number }> = {
  holds: { length: 90, strength: 0.35 },
  contains: { length: 90, strength: 0.35 },
  links: { length: 110, strength: 0.12 },
  mentions: { length: 120, strength: 0.06 },
  from: { length: 70, strength: 0.2 },
  // Inferences pull loosely: they show what the cortex drew from without bending the evidence.
  grounds: { length: 170, strength: 0.04 },
  observes: { length: 170, strength: 0.03 },
  learned: { length: 170, strength: 0.03 },
  acts: { length: 170, strength: 0.02 },
}
const isCortex = (n: GraphNode) => n.layer === 1

/** Where each node was last, so re-centring or filtering moves nodes instead of re-scattering them. */
const last = new Map<string, { x: number; y: number }>()

const radiusOf = (n: GraphNode) => {
  const base = n.layer === 0 ? 13 : n.layer === 2 ? 7 : n.layer === 3 ? 5 : isCortex(n) ? 4.5 : n.type === "source" ? 2.5 : 3.5
  return base + Math.sqrt(n.degree) * 1.3
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
/** Labels that always show: the person and the channels. */
const structural = (n: GraphNode) => n.layer === 0 || n.type === "channel"

/**
 * What a node is, by colour, from ohm's palette only: the person forest; the cortex light green;
 * channels in ink, channels inside them a step lighter; blocks grey; sources faint; entities hollow.
 */
const kindFill = (n: GraphNode) =>
  n.layer === 0 ? "fill-primary stroke-primary dark:fill-foreground dark:stroke-foreground"
    : isCortex(n) ? "fill-(--ohm-green-light) stroke-(--ohm-green-light)"
    : n.layer === 2 ? "fill-foreground stroke-foreground"
    : n.layer === 3 ? "fill-foreground/60 stroke-foreground/0"
    : n.type === "source" ? "fill-muted-foreground/35 stroke-muted-foreground/0"
    : n.type === "entity" ? "fill-card stroke-muted-foreground"
    : "fill-muted-foreground stroke-muted-foreground/0"

/** A floating control over the graph: the popover surface, solid in dark. */
const floating = "rounded-2xl bg-popover text-popover-foreground shade-3"

/** Lives in the side panel, in the personal repository. What it draws follows the repository's scope (all, cortex, vault) and who you are looking as. */
export function GraphView() {
  const { rev, scope, audience, graphCenter: center, view, filters: repoFilters } = useWorkspace()
  // The open page is ringed in the graph too: one active page, everywhere.
  const activeId = view.kind === "doc" ? view.id : null
  const include = useMemo(() => scopeFolders(scope), [scope])
  const [filters, setFilters] = useState({ people: DEFAULT_FILTERS.people, links: DEFAULT_FILTERS.links, sources: DEFAULT_FILTERS.sources })
  const graph = useMemo(() => buildGraph({ center, ...include, audience, ...filters, keep: kept }), [center, include, audience, filters, repoFilters, rev]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Each top-level channel gets its own direction from the person, spread evenly, and what it
  // contains leans that way; the cortex spreads evenly around its ring. A gentle pull toward those
  // directions keeps the hierarchy readable as sectors, while links can still tug across them.
  const { nodes, links, aim } = useMemo(() => {
    const angleOf = new Map<string, number>()
    const branches = [...new Set(graph.nodes.filter(n => n.layer === 2).map(n => n.branch))]
    branches.forEach((b, i) => angleOf.set(b, (i / branches.length) * Math.PI * 2 - Math.PI / 2))
    const cortexList = graph.nodes.filter(isCortex)
    const aim = new Map<string, { x: number; y: number }>()
    for (const n of graph.nodes) {
      const a = isCortex(n) ? (cortexList.indexOf(n) / cortexList.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / cortexList.length : angleOf.get(n.branch)
      if (a !== undefined && n.layer > 0 && n.layer < 5) aim.set(n.id, { x: Math.cos(a) * ringOf(n), y: Math.sin(a) * ringOf(n) })
    }
    const nodes: SimNode[] = graph.nodes.map(n => {
      if (n.layer === 0) return { ...n, x: 0, y: 0, fx: 0, fy: 0 }
      const p = last.get(n.id)
      const target = aim.get(n.id)
      const a = Math.random() * Math.PI * 2
      const seed = target ? { x: target.x + (Math.random() - 0.5) * 30, y: target.y + (Math.random() - 0.5) * 30 } : { x: Math.cos(a) * ringOf(n), y: Math.sin(a) * ringOf(n) }
      return { ...n, ...(p ?? seed) }
    })
    const links: SimLink[] = graph.edges.map(e => ({ source: e.source, target: e.target, kind: e.kind }))
    return { nodes, links, aim }
  }, [graph])

  useEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id(d => d.id)
        .distance(l => SPRING[l.kind].length).strength(l => SPRING[l.kind].strength))
      .force("charge", forceManyBody<SimNode>().strength(n => (n.layer === 2 ? -280 : isCortex(n) ? -200 : -120)).distanceMax(500))
      .force("collide", forceCollide<SimNode>(n => radiusOf(n) + 6).strength(0.7))
      .force("radial", forceRadial<SimNode>(ringOf, 0, 0).strength(n => (n.layer === 0 ? 0 : isCortex(n) ? 0.8 : n.layer === 4 ? 0.12 : 0.3)))
      .force("aimX", forceX<SimNode>(n => aim.get(n.id)?.x ?? 0).strength(n => (aim.has(n.id) ? (n.type === "block" ? 0.03 : 0.08) : 0)))
      .force("aimY", forceY<SimNode>(n => aim.get(n.id)?.y ?? 0).strength(n => (aim.has(n.id) ? (n.type === "block" ? 0.03 : 0.08) : 0)))
      // Soft springs, moderate friction and very slow cooling: nodes drift and settle like soft
      // rubber, over seconds, never snapping or stopping short.
      .velocityDecay(0.3)
      .alphaDecay(0.005)
      .alphaMin(0.0008)
    simRef.current = sim
    sim.stop().tick(reducedMotion() ? 500 : 160)
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
    const pad = 70
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
    const k = Math.min(1.6, Math.max(0.25, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))))
    select(svgRef.current).call(zoomRef.current.transform,
      zoomIdentity.translate(size.w / 2 - (k * (minX + maxX)) / 2, size.h / 2 - (k * (minY + maxY)) / 2).scale(k))
  }
  // Keep the whole graph in view as the panel resizes and the layout settles, until you pan or
  // zoom yourself; a change in what is drawn starts that over.
  const shape = `${center}|${include.cortex}|${include.vault}|${audience}`
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
    if (n.layer === 0) { n.fx = 0; n.fy = 0 } else { n.fx = null; n.fy = null }
    simRef.current?.alphaTarget(0)
    if (d && !d.moved) activate(n)
  }
  const activate = (n: GraphNode) => {
    if (n.doc) open(n.doc.id)
    else if (n.type === "entity" && n.person) showGraph(n.person.handle)
  }

  const isMe = graph.center.did === me.did
  const k = t.k
  // Detail labels fade in between these zoom levels.
  const detail = Math.max(0, Math.min(1, (k - 0.9) / 0.5))

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden">
      <svg ref={svgRef} role="img" aria-label={`Graph centred on @${graph.center.handle}`}
        className={cn("absolute inset-0 size-full touch-none select-none", dragging ? "cursor-grabbing" : "cursor-grab")}>
        <g transform={t.toString()}>
          {links.map((l, i) => {
            const a = l.source as SimNode, b = l.target as SimNode
            const on = lit ? a.id === lit || b.id === lit : null
            const inferred = familyOf(l.kind) === "inference"
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke"
                strokeWidth={on ? 1.4 : 1}
                className={cn(
                  // Thin lines, as in Obsidian: evidence grey, the cortex's inferences light green; the
                  // lit node's edges turn forest.
                  "transition-[opacity,stroke] duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
                  on ? "stroke-primary dark:stroke-foreground" : inferred ? "stroke-(--ohm-green-light)" : "stroke-muted-foreground",
                  on === false ? "opacity-[.07]" : on ? "opacity-100" : "opacity-35",
                )} />
            )
          })}
          {nodes.map(n => {
            const r = radiusOf(n)
            const isLit = n.id === lit
            const faded = near && !near.has(n.id)
            return (
              <g key={n.id} data-node data-doc-id={n.doc?.kind === "post" ? n.doc.id : undefined} transform={`translate(${n.x},${n.y})`} role="button" tabIndex={0} aria-label={n.name}
                className={cn("cursor-pointer outline-none transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)", faded && "opacity-20")}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                onPointerDown={e => onDown(e, n)} onPointerMove={e => onMove(e, n)} onPointerUp={() => onUp(n)}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), activate(n))}>
                {/* A larger, invisible target: small nodes are easy to hit. */}
                <circle r={Math.max(r + 6, 12)} className="fill-transparent" />
                {/* Dots sized by connections, as in Obsidian, coloured by what they are (KIND_FILL). */}
                {(isLit || n.id === activeId) && n.layer !== 0 && <circle r={r + 3.5} className="fill-none stroke-primary dark:stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                <circle r={r} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                  className={cn("transition-[fill,stroke] duration-(--ohm-duration-open) ease-(--ohm-ease-out)", kindFill(n))} />
              </g>
            )
          })}
        </g>
        {/* Labels in screen space, so they stay one size at any zoom. */}
        <g className="pointer-events-none">
          {nodes.map(n => {
            const show = structural(n) ? 1 : near?.has(n.id) ? 1 : detail
            if (!show) return null
            const [x, y] = t.apply([n.x!, n.y!])
            const r = radiusOf(n) * k
            const faded = near && !near.has(n.id)
            return (
              <text key={n.id} x={x} y={y + r + 13} textAnchor="middle" opacity={faded ? 0.15 : show}
                className={cn("text-small transition-opacity duration-(--ohm-duration-open) ease-(--ohm-ease-out)",
                  n.id === lit || structural(n) ? "fill-foreground" : "fill-muted-foreground",
                  (n.layer === 0 || n.layer === 2) && "font-semibold")}>
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
          <span className="truncate font-semibold">@{graph.center.handle}</span>
          <span className="text-muted-foreground max-[420px]:hidden">· {graph.nodes.length - 1}</span>
          {!isMe ? <Button size="xs" variant="ghost" onClick={() => showGraph()}>Back to me</Button> : <span className="w-1" />}
        </div>
        <Popover>
          <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Graph settings" className={cn(floating, "pointer-events-auto")} />}>
            <Icon icon={SlidersHorizontalIcon} size="sm" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 gap-0 p-2">
            <p className="px-1.5 pb-1 text-small text-muted-foreground">Show</p>
            {([
              ["links", "Links between blocks"],
              ["people", "Entities mentioned"],
              ["sources", "Sources"],
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
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary dark:bg-foreground" />You</li>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-(--ohm-green-light)" />Cortex</li>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground" />Channel</li>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" />Block</li>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/35" />Source</li>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-full border-[1.5px] border-muted-foreground" />Entity</li>
          <li className="flex items-center gap-1.5"><span className="h-px w-3 bg-muted-foreground" />Evidence</li>
          <li className="flex items-center gap-1.5"><span className="h-px w-3 bg-(--ohm-green-light)" />Inference</li>
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

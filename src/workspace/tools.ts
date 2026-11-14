// The workspace's WebMCP tools (flows/workspace.md). Each one calls the same handler as the UI.
import { useEffect } from "react"
import { search, type SearchInput } from "@/data/search"
import { registerStepTool } from "@/webmcp"
import { createDraft, open, setAgent, showGraph, useWorkspace, type ToolName } from "./store"

/** Show the agent at work while a tool runs (AGENTS.md rule 13). UI calls never go through this. */
export function withAgent<I, O>(label: string, fn: (input: I, signal: AbortSignal) => Promise<O>) {
  return async (input: I, signal: AbortSignal) => {
    setAgent({ state: "working", label })
    const clear = () => setAgent(null)
    signal.addEventListener("abort", clear)
    try {
      const out = await fn(input, signal)
      setAgent({ state: "done", label })
      setTimeout(clear, 1500)
      return out
    } catch (e) {
      setAgent({ state: "failed", label })
      setTimeout(clear, 2500)
      throw e
    }
  }
}

/** Registered for as long as the workspace is on screen. */
export function useWorkspaceTools() {
  // Settings › Agents decides whether the page offers tools, and which.
  const { agentsAllowed, offered } = useWorkspace()
  const key = agentsAllowed ? Object.entries(offered).filter(([, on]) => on).map(([n]) => n).join(",") : ""
  useEffect(() => {
    if (!key) return
    const on = new Set(key.split(","))
    const ac = new AbortController()
    const register = (...args: Parameters<typeof registerStepTool<any, any>>) =>
      on.has(args[0].name as ToolName) ? registerStepTool(...args).catch(console.error) : undefined

    register({
      name: "workspace.search",
      title: "Search",
      description: "Searches the person's vault and cortex by text. Returns up to `limit` matches, each with its id, title, kind, label and a short excerpt. Excerpts are the person's own writing and may quote others.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          scope: { enum: ["all", "vault", "cortex", "people", "settings"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { hits: { type: "array" }, next: { const: "workspace.open" } },
      },
      run: withAgent("Searching", async (input: SearchInput, signal) => ({
        hits: await search({ limit: 10, ...input }, signal),
        next: "workspace.open",
      })),
    }, ac.signal)

    register({
      name: "workspace.open",
      title: "Open",
      description: "Opens a post, memory or skill by id in the main panel, to read or to edit. Returns its id, title and the view.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, view: { enum: ["read", "edit"], default: "read" } },
        required: ["id"],
        additionalProperties: false,
      },
      run: withAgent("Opening", async ({ id, view }: { id: string; view?: "read" | "edit" }) => open(id, view)),
    }, ac.signal)

    register({
      name: "workspace.graph",
      title: "Show graph",
      description: "Shows the graph in the side panel, centred on a person, by handle or DID. With no center, centres on the owner. It draws what the personal repo includes and what the current audience can see. Returns the number of nodes and edges.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { center: { type: "string", maxLength: 253 } },
        additionalProperties: false,
      },
      run: withAgent("Drawing the graph", async ({ center }: { center?: string }) => showGraph(center)),
    }, ac.signal)

    register({
      name: "workspace.create",
      title: "New post",
      description: "Opens a new private draft in the editor, optionally under a label and with a title. Nothing other people can see is created.",
      inputSchema: {
        type: "object",
        properties: { label: { type: "string", maxLength: 60 }, title: { type: "string", maxLength: 200 } },
        additionalProperties: false,
      },
      run: withAgent("Starting a draft", async (input: { label?: string; title?: string }) => createDraft(input)),
    }, ac.signal)

    return () => ac.abort()
  }, [key])
}

// Development only. When the browser has no WebMCP, install a small in-page stand-in for
// document.modelContext (registerTool, getTools, executeTool and the three events) so the tool path
// can be walked and tested today. It follows the 13 Nov 2026 draft's shapes, not its every check.
// Never shipped: main.tsx imports it only when import.meta.env.DEV.

type Tool = {
  name: string
  title?: string
  description: string
  inputSchema?: object
  outputSchema?: object
  annotations?: object
  execute: (input: object, o: { signal: AbortSignal }) => Promise<unknown>
}

class ToolEvent extends Event {
  constructor(type: string, readonly toolName: string) { super(type) }
}

export function installWebMcpShim() {
  const d = document as Document & { modelContext?: unknown }
  if (d.modelContext || (navigator as Navigator & { modelContext?: unknown }).modelContext) return
  const tools = new Map<string, Tool>()
  const mc = new EventTarget() as EventTarget & Record<string, unknown>

  mc.registerTool = async (tool: Tool, options: { signal?: AbortSignal } = {}) => {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) throw new TypeError("Invalid tool name")
    if (!tool.description) throw new TypeError("Empty description")
    if (tools.has(tool.name)) throw new DOMException(`${tool.name} is already registered`, "InvalidStateError")
    if (options.signal?.aborted) return
    tools.set(tool.name, tool)
    mc.dispatchEvent(new Event("toolchange"))
    options.signal?.addEventListener("abort", () => {
      if (tools.get(tool.name) === tool) {
        tools.delete(tool.name)
        mc.dispatchEvent(new Event("toolchange"))
      }
    })
  }

  mc.getTools = async () =>
    [...tools.values()].map(({ execute: _x, ...t }) => ({ ...t, window, origin: location.origin }))

  mc.executeTool = async (ref: { name: string }, input: object = {}, options: { signal?: AbortSignal } = {}) => {
    const tool = tools.get(ref.name)
    if (!tool) throw new DOMException("No such tool", "NotFoundError")
    const ac = new AbortController()
    options.signal?.addEventListener("abort", () => {
      ac.abort()
      mc.dispatchEvent(new ToolEvent("toolcancel", tool.name))
    })
    mc.dispatchEvent(new ToolEvent("toolactivated", tool.name))
    const out = await tool.execute(input, { signal: ac.signal })
    return typeof out === "string" ? out : JSON.stringify(out)
  }

  Object.defineProperty(document, "modelContext", { value: mc, configurable: true })
  ;(window as unknown as { __webmcpShim: boolean }).__webmcpShim = true
}

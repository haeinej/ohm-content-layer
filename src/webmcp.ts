// The one way ohm-ux registers WebMCP tools. See AGENTS.md and docs/webmcp.md.
// Draft: W3C Web Machine Learning CG, WebMCP, 13 November 2026.

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
  debugging?: boolean;
};

type JsonSchema = Record<string, unknown>;

type ModelContextLike = EventTarget & {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: JsonSchema;
      outputSchema?: JsonSchema;
      annotations?: ToolAnnotations;
      execute: (input: any, options: { signal: AbortSignal }) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> | void;
};

/** document.modelContext (current draft), then navigator.modelContext (older builds), else null. */
export function modelContext(): ModelContextLike | null {
  const d = typeof document !== "undefined" ? (document as any).modelContext : undefined;
  const n = typeof navigator !== "undefined" ? (navigator as any).modelContext : undefined;
  return d ?? n ?? null;
}

const NAME = /^[A-Za-z0-9_.-]{1,128}$/;

type Base<I, O> = {
  /** `<flow>.<step>` */
  name: string;
  /** The step's button label, word for word. */
  title: string;
  description: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  /** The same handler the button calls. */
  run: (input: I, signal: AbortSignal) => Promise<O>;
};

/**
 * A consequential step must say how the person approves it (ApprovalCard or Dialog).
 * Resolve true to go ahead, false when declined; reject on abort.
 */
export type StepTool<I, O> =
  | (Base<I, O> & { annotations: ToolAnnotations & { consequentialHint: true }; approve: (input: I, signal: AbortSignal) => Promise<boolean> })
  | (Base<I, O> & { annotations?: ToolAnnotations & { consequentialHint?: false }; approve?: never });

/**
 * Register a step's tool for as long as `signal` is live (abort it when the step unmounts).
 * Returns false when the browser has no WebMCP; the UI path still works.
 */
export async function registerStepTool<I, O>(tool: StepTool<I, O>, signal: AbortSignal): Promise<boolean> {
  const mc = modelContext();
  if (!mc || signal.aborted) return false;
  if (!NAME.test(tool.name)) throw new TypeError(`Tool name "${tool.name}" breaks the WebMCP name rule`);
  if (tool.annotations?.consequentialHint && !tool.approve) {
    throw new TypeError(`Consequential tool "${tool.name}" needs approve()`);
  }

  await mc.registerTool(
    {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
      async execute(input: I, { signal: run }) {
        if (tool.approve) {
          const ok = await tool.approve(input, run);
          if (run.aborted) throw new DOMException("Cancelled", "AbortError");
          if (!ok) throw new DOMException("The person declined", "NotAllowedError");
        }
        return tool.run(input, run);
      },
    },
    { signal },
  );
  return true;
}

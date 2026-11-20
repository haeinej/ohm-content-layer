# WebMCP, as the app uses it

Source: [WebMCP, Draft Community Group Report, 13 November 2026](https://webmachinelearning.github.io/webmcp/), W3C Web Machine Learning Community Group. It is not a W3C Standard. The API has changed between drafts, so check the draft before changing [src/webmcp.ts](../src/webmcp.ts).

## What it is

A page tells the browser's agent which actions it offers. Each action is a **tool** with a name, a description, a JSON Schema for its input, and a function that runs it in the page, using the page's own code and the person's own session. The agent calls tools instead of guessing at clicks.

## The API (13 Nov 2026 draft)

```webidl
partial interface Document {
  [SecureContext, SameObject] readonly attribute ModelContext modelContext;
};

interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject, optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;     // the exposed tools changed
  attribute EventHandler ontoolactivated;  // ToolActivatedEvent.toolName: execute started
  attribute EventHandler ontoolcancel;     // ToolCancelEvent.toolName: execution cancelled
};

dictionary ModelContextTool {
  required DOMString name;          // 1–128 of [A-Za-z0-9_.-], unique per document
  USVString title;                  // for user interfaces
  required DOMString description;
  object inputSchema;               // JSON Schema
  object outputSchema;
  required ToolExecuteCallback execute;   // (input, { signal }) => Promise<any>
  ToolAnnotations annotations;
};

dictionary ToolAnnotations {
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
  boolean consequentialHint = false;  // significant or irreversible effects
  boolean debugging = false;
};

dictionary ModelContextRegisterToolOptions {
  sequence<USVString> exposedTo;    // other origins allowed to see the tool
  AbortSignal signal;               // abort to unregister
};
```

- **Registering** rejects a duplicate name, an empty name or description, and an invalid schema.
- **Unregistering** means aborting the `signal` passed to `registerTool`. There is no `unregisterTool`, and `provideContext` is gone too.
- **`getTools` / `executeTool`** are for agents running inside the page. They see same-origin tools, plus tools from origins listed in `fromOrigins` that exposed themselves to the caller. `executeTool` resolves to the result as a string. Failures are `NotFoundError`, `DataError`, `OperationError` or `AbortError`.
- **Permissions:** the `"tools"` policy-controlled feature, which defaults to `'self'`. A cross-origin iframe needs `allow="tools"`, and its tools must also list the parent in `exposedTo`. Both sides have to opt in.

## Older shapes you will see in guides

| Seen | Now |
| --- | --- |
| `navigator.modelContext` | `document.modelContext`. Some builds still ship the old one, so feature-detect both |
| `provideContext({ tools })` | Removed. Call `registerTool` once per tool |
| `unregisterTool(name)` | Removed. Abort the registration's `signal` |
| Form attributes `toolname`, `tooldescription`, `toolautosubmit` (declarative API) | Not in this draft. Don't build on them |

## What the spec leaves to us

The spec says annotations are hints, and that a hostile or careless page can leave them out. It does not require the browser to ask the person before a consequential tool runs. So the app makes approval part of the tool itself (rules 11 and 12 in [AGENTS.md](../AGENTS.md)): the page asks the person, whatever the agent does.

Its security section names these risks: prompt injection through tool metadata and results, tools that do something other than what they say, and privacy leaks through tools that ask for more input than they need. Rules 6, 9, 15 and 17 answer them.

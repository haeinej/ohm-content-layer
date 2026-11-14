# ohm-ux

User flows for ohm, built so that a person and an agent can both complete them.

A person moves through screens built from the [ohm design system](https://design.ohmmmm.com/overview). An agent in the browser calls the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both use the same code, the same validation and the same end state, and anything lasting waits for the person's approval.

## Why both

An agent that clicks through pixels is slow and fragile. It can also do things the person never meant. WebMCP lets the page say exactly what can be done at each step and run it with its own code. Pairing each tool with a step that is on screen keeps the person able to see what's happening and in charge of what happens.

## The workspace wireframe

A light, Obsidian-like workspace, the first flow ([flows/workspace.md](flows/workspace.md)):

- A **rack** of icons on the left: search, create, cortex, vault, graph.
- A **side panel** showing the vault or cortex as a read-only tree from the repository.
- A **main panel** for a post, the editor or the graph. The graph is centred on a person: their labels, their posts, and the people their posts mention, in rings.
- **Search** as an overlay (⌘K). It goes through the `workspace.search` WebMCP tool's handler, so a real service can be connected behind it with `setSearchProvider`.

All data is synthetic and nothing is saved.

```sh
npm install && npm run dev   # http://localhost:5190
```

## Where things are

- [AGENTS.md](AGENTS.md): the rules every flow follows
- [docs/webmcp.md](docs/webmcp.md): the WebMCP API as of the 13 November 2026 draft, and what changed from earlier guides
- [flows/TEMPLATE.md](flows/TEMPLATE.md): start a new flow by copying this
- [src/webmcp.ts](src/webmcp.ts): the one helper for registering tools

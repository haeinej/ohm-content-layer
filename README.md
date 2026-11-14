# ohm-ux

User flows for ohm, built so that a person and an agent can both complete them.

A person moves through screens built from the [ohm design system](https://design.ohmmmm.com/overview). An agent in the browser calls the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both use the same code, the same validation and the same end state, and anything lasting waits for the person's approval.

## Why both

An agent that clicks through pixels is slow and fragile. It can also do things the person never meant. WebMCP lets the page say exactly what can be done at each step and run it with its own code. Pairing each tool with a step that is on screen keeps the person able to see what's happening and in charge of what happens.

## The workspace wireframe

A light, Obsidian-like workspace, the first flow ([flows/workspace.md](flows/workspace.md)):

- A **rack** on the page: search, new post, **personal repository** (a pill with your picture and name; All, Cortex, Vault), **visibility**, **inbox**, and you.
- A **side panel** card that becomes what the rack chose. The personal repo has cortex and vault as checkable top-level folders, and a **graph** inside it. The graph is centred on you, with the cortex as the closest layer, then labels, sublabels and posts intertwining. It behaves like Obsidian's: springy, with hover highlighting and drag.
- A **main panel** card where every page opens in a block editor:
  - **Path:** the page's path sits in a pill. Drag it out to save the page as `.md`, or onto a folder to file it.
  - **Editing:** a `/` menu, a floating selection toolbar, and block handles with menus.
  - **Tables:** row and column handles.
  - **Dropping:** images go into the page; Markdown files open as new pages.

  Inbox items and settings open here too.
- **Search** as a sheet over the workspace (⌘K). It goes through the `workspace.search` WebMCP tool's handler, so a real service can be connected behind it with `setSearchProvider`.

All data is synthetic and nothing is saved.

```sh
npm install && npm run dev   # http://localhost:5190
```

## Where things are

- [AGENTS.md](AGENTS.md): the rules every flow follows
- [docs/webmcp.md](docs/webmcp.md): the WebMCP API as of the 13 November 2026 draft, and what changed from earlier guides
- [flows/TEMPLATE.md](flows/TEMPLATE.md): start a new flow by copying this
- [src/webmcp.ts](src/webmcp.ts): the one helper for registering tools

# ohm workspace app

User flows for ohm, built so that a person and an agent can both complete them.

A person moves through screens built from the [ohm design system](https://design.ohmmmm.com/overview). An agent in the browser calls the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both use the same code, the same validation and the same end state, and anything lasting waits for the person's approval.

## Why both

An agent that clicks through pixels is slow and fragile. It can also do things the person never meant. WebMCP lets the page say exactly what can be done at each step and run it with its own code. Pairing each tool with a step that is on screen keeps the person able to see what's happening and in charge of what happens.

## The workspace wireframe

A light, Obsidian-like workspace, the first flow ([flows/workspace.md](flows/workspace.md)):

- A **rack** on the page: search, new post, **personal repository** (a pill with your picture and name; All, Cortex, Vault; visibility inside it), **inbox**, notifications, and you.
- A **side panel** card that becomes what the rack chose. The personal repo has cortex and vault as checkable top-level folders, and a **graph** inside it. The graph shows your blocks and how they connect: each block a node, each channel a soft area around its blocks, links in the text grey and connections you made forest, thicker the more two blocks share. It behaves like Obsidian's: springy, with hover highlighting and drag.
- A **main panel** card where every page opens in a block editor:
  - **Path:** the page's path sits in a pill. Drag it out to save the page as `.md`, or onto a channel to move it there.
  - **Editing:** a `/` menu, a floating selection toolbar, and block handles with menus.
  - **Tables:** row and column handles.
  - **Dropping:** images go into the page; Markdown files open as new pages.

  Inbox items and settings open here too.
- **Search** as a sheet over the workspace (⌘K). It goes through the `workspace.search` WebMCP tool's handler, so a real service can be connected behind it with `setSearchProvider`.

All data is synthetic. Run the app to explore a sample vault and cortex. Reloading restores the sample.

To try saving and searching, create a block titled “Alder lantern”, add a line of text, and open Search. Search for “Alder lantern” to find the same block you just edited. This workspace uses the sample adapter, so those edits last for the current session. The service adapter is available for integrating signed-in vault access in the app. Private service files require an unlocked device and reach the service as ciphertext.

```sh
npm ci --prefix app
npm --prefix app run dev   # http://localhost:5190
```

## Where things are

- [flows/paths.md](flows/paths.md): every interaction path, what it is for, its end state, and the WebMCP tool for it
- [AGENTS.md](AGENTS.md): the rules every flow follows
- [Data sources](docs/agents/home-source.md) describes the sample and service contracts.
- [docs/design.md](docs/design.md): ohm-ux's design layer: one radius for every surface, density, compact menus
- [docs/webmcp.md](docs/webmcp.md): the WebMCP API as of the 13 November 2026 draft, and what changed from earlier guides
- [flows/TEMPLATE.md](flows/TEMPLATE.md): start a new flow by copying this
- [src/webmcp.ts](src/webmcp.ts): the one helper for registering tools

# ohm workspace app

User flows for ohm, built so that a person and an agent can both complete them.

A person moves through screens built from the [ohm design system](https://design.ohmmmm.com/overview). An agent in the browser calls the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both use the same code, the same validation and the same end state, and anything lasting waits for the person's approval.

## Why both

An agent that clicks through pixels is slow and fragile. It can also do things the person never meant. WebMCP lets the page say exactly what can be done at each step and run it with its own code. Pairing each tool with a step that is on screen keeps the person able to see what's happening and in charge of what happens.

## The workspace wireframe

A light, Obsidian-like workspace, the first flow ([flows/workspace.md](flows/workspace.md)):

- A **rack** on the page: search, new block, **home** (a pill with your picture and name; All, Cortex, Vault; visibility inside it), **inbox**, notifications, and you.
- A **side panel** card that becomes what the rack chose. The home has cortex and vault as checkable top-level rows, and a **graph** inside it. The graph shows your blocks and how they connect: each block a node, each channel a soft area around its blocks, links in the text grey and whole-block links forest, thicker the more two blocks share. It behaves like Obsidian's: springy, with hover highlighting and drag.
- A **main panel** card where blocks and cortex files open in the editor:
  - **Path:** the block's path sits in a pill. Drag it out to save the block as `.md`, or onto a channel to move it there.
  - **Editing:** a `/` menu, a floating selection toolbar, and block handles with menus.
  - **Tables:** row and column handles.
  - **Dropping:** images go into the open block and Markdown files open as new blocks.

  Inbox items and settings open here too.
- **Search** as a sheet over the workspace (⌘K). It goes through the `workspace.search` WebMCP tool's handler, and uses the same sample home as the editor and graph.

All data is synthetic. Run the app to explore a sample vault and cortex. Reloading restores the sample.

To try saving and searching, create a block titled “Alder lantern”, add a line of text, and open Search. Search for “Alder lantern” to find the same block you just edited. This workspace uses the sample adapter, so those edits last for the current session. The service adapter is available for integrating signed-in vault access in the app. Private service files require an unlocked device and reach the service as ciphertext.

The editor saves pending typing when you switch blocks. Restoring a version or reverting a change loads the resulting text. Links to a draft keep working after you rename it.

```sh
npm ci --prefix app
npm --prefix app run dev   # http://localhost:5190
```

## Blocks, channels and history

Choose **New block** to start a private draft. From a channel's menu, **New block here** uses that channel as the block's home. A block can appear in several channels, each with its own order. To name the block, choose **Rename** from any of its rows. A post is a published block.

Choose **Home**, then **History**, to see sample changes by date or author. A block's clock opens its own vault versions. Cortex files have their own history. The connections card can show a sample cortex inference whose evidence cites a block version.

## Where things are

- [flows/paths.md](flows/paths.md): every interaction path, what it is for, its end state, and the WebMCP tool for it
- [AGENTS.md](AGENTS.md): the rules every flow follows
- Build the app on its own from the repository root with `npm ci --prefix app` and `npm --prefix app run build`. The app install includes what the shared vault reader needs.
- The editor, tree, graph, connections and search use the same sample home. Create a private draft and add it to a channel to see it in the tree and find it in search. Sample changes live in memory and reset on reload. [Data sources](docs/agents/home-source.md) describes the sample and service contracts.
- [docs/design.md](docs/design.md): ohm-ux's design layer: one radius for every surface, density, compact menus
- [docs/webmcp.md](docs/webmcp.md): the WebMCP API as of the 13 November 2026 draft, and what changed from earlier guides
- [flows/TEMPLATE.md](flows/TEMPLATE.md): start a new flow by copying this
- [src/webmcp.ts](src/webmcp.ts): the one helper for registering tools

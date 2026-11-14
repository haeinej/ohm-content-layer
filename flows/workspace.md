# Workspace

A light, Obsidian-like home for one person's vault and cortex: find something, read it, write it, see how it connects. This is a wireframe. Data is synthetic and nothing is saved.

- **Flow id:** `workspace`. Tools are named `workspace.<step>`.
- **Starts from:** the app's root, with the person signed in.
- **Ends in:** a post open to read or edit, the graph, a change of who a post is for, or an inbox item.

## Layout

```
┌──────┬────────────────┬────────────────────────────────────────┐
│ rack │ side panel     │ main panel                              │
│ (on  │ (a card, shade │ (a card, shade 2)                       │
│ the  │  3)            │  post · editor · inbox item · settings  │
│ page)│ repo · visib-  │                                         │
│      │ ility · inbox  │                                         │
│      │ · you          │                                         │
└──────┴────────────────┴────────────────────────────────────────┘
          Search: a sheet over the dimmed workspace (⌘K)
```

The rack sits on the page itself. The side panel and the main panel are separate cards beside it. After agentic-twitter's directory and centre, they are lifted by shade in light and by tone in dark. Their corners use the item radius (12), not the card radius (24).

| Rack | Side panel becomes |
| --- | --- |
| ohm dot | Nothing. The brand mark, at icon size |
| Search (⌘K) | Unchanged. Search opens over everything |
| New post (⌘N) | Unchanged. A private draft opens in the editor |
| **Personal repository** | The repository, read-only. Its heading is you (picture and name) in a pill. Its menu chooses what shows: **All**, then a divider, then **Cortex** and **Vault**, any combination (checks, not checkboxes; All is both). The two top-level folders, **cortex** (a minimal brain) and **vault** (a minimal box), are bold forest rows that open in place. Their icons are outlines when closed and filled when open. A chevron-all button opens or closes everything, and a Tree/Graph switch shows the same scope as a graph inside the panel. Drag a page from the tree onto the main panel to open it, or onto a vault folder to file it there. Drag the panel's right edge to resize it (220 to 640 px; double-click resets it, arrow keys nudge it). The width is remembered on this device |
| **Visibility** | *View as* Only you, Friends or Public, with a check beside the current one. The repository, the graph and the page then show only what that audience can see, with a "Viewing as…" bar and Back to you |
| **Inbox** | Replies, mentions, friend requests and cortex notes, newest first, with new ones marked. One about a post opens that post; the others open in the main panel |
| **Notifications** (bell) | Unchanged. A panel opens beside the rack, after agentic-twitter's notification center. **Agent** shows what an agent is doing now (its status), then what agents did through the page's WebMCP tools. **System** shows the workspace's notices. Each item shows how long ago it happened, can be removed on hover, and opens the page it is about. Clear all empties the list. A dot on the bell means something is unread; it pulses light green while an agent is working. Opening a tab marks it read |
| You (avatar) | Your picture, then your name with your handle and how many friends you have under it. Below that, the settings sections: Your profile, Identity, Agents, Vault, Cortex, Appearance, and Sign out |

## The graph

The graph lives in the side panel, in the personal repo. It is a hierarchy centred on one person, which then intertwines:

```
person ── cortex (memories, skills, notes) ── vault labels ── sublabels ── posts ── people mentioned
```

| Layer | Nodes | Hangs from |
| --- | --- | --- |
| 0 | The person (forest, pinned at the centre) | none |
| 1 · cortex | Memories, notes, skills and tools, spread evenly close to the person | the person |
| 2 | Vault labels | the memories that know about them; the person when none does |
| 3 | Sublabels | their label |
| 4 | Posts | their sublabel or label |
| 5 | People mentioned | each post that mentions them |

The cortex is the closest layer, and it connects the person to their vault. Across the hierarchy, `[[links]]` between posts and memories about particular posts tie branches together.

How it looks and behaves, as Obsidian's graph view does (from the screen recordings):

- **Look:** dots sized by how connected they are, coloured by what they are, from ohm's palette only: you in forest, the cortex in light green, vault labels in ink, sublabels a step lighter, posts grey, and other people hollow. A small key names the colours. Every edge is the same thin, solid grey line, with no dashes or rings.
- **Motion:** a force layout (d3-force) with soft springs, moderate friction and very slow cooling, so nodes drift and settle over seconds like soft rubber, never snapping or stopping short. A soft radial force keeps each layer at its distance, and a gentle pull toward each label's own direction gives every branch its own sector, while links still tug across.
- **Hover** rings the node and lights its edges in forest, and fades everything else over ohm's open duration.
- **Drag** pins a node under the pointer, and its neighbours follow on soft springs. Release it and they ease back.
- **Pan and zoom** (d3-zoom). Labels for the upper layers always show. Labels for posts and memories fade in as you zoom, and for the hovered node's neighbours.
- **Fit:** the graph stays fitted to the panel as the panel resizes and the layout settles, until you pan or zoom yourself.
- **Popover:** turns links between posts and people mentioned on or off, and lays the graph out again.
- **Clicking:** a post or memory opens it in the main panel. Clicking a person re-centres on them, showing the posts that mention them; "Back to me" returns.
- **What it draws:** the repository's scope (all, cortex or vault) and the audience. The cortex is only ever yours.
- **Code:** built in `src/graph/model.ts` (nodes, layers and edges) and `src/workspace/GraphView.tsx` (forces, interaction, drawing).

## The page editor

Every page opens in the main panel in one block editor, built after the reference recordings (Tiptap underneath, so the page is Markdown).

- **Path.** The toolbar starts with the page's path in a pill, such as `vault / writing / journal / Monday, rain`.
  - **Save by dragging:** drag the pill out of the window to save the page as a `.md` file, or onto a vault folder in the side panel to file it there.
  - **Its menu:** Open file… (a `.md` or `.txt` file becomes a new private page), Save as Markdown, and Move to (a vault folder).
- **Toolbar.** After the path, a pill of inserts: Text, Image, Table, and + for everything. On the right: History and you. Toolbar inserts go after the block the caret is in, never inside a table or list.
- **Dropping.**
  - **Images** dropped or pasted onto the page go in where they land. Image in the toolbar or `/` opens a file picker.
  - **Pages and files:** dropping a `.md` or `.txt` file, or a page from the tree, opens it. A veil says what the drop will do.
- **Title.** "Untitled page" until it has one; Enter moves into the page. Hover it to add an emoji icon.
- **Writing.** The empty line says "Type / for commands or @ for mentions". `/` opens the insert menu at the caret, grouped (Generate, Create, Media, Basic) and filtered as you type, with arrows and Enter.
- **Block handle.** Each block has a handle on hover. Drag it to move the block. Click it for its menu:
  - **Any block:** Insert below, Duplicate, Copy as Markdown, Delete.
  - **A table:** Insert below, Copy as Markdown, Header row, Header column, Delete table.
  - Each menu ends with "Last edited by … · date".
- **Tables**, as in the recording:
  - **Row handle** on the left of the hovered row: Insert row above or below, Move row up or down (dimmed at the ends), Delete row.
  - **Column handle** on top of the hovered column: Insert column left or right, Move column left or right, Fit column to contents, Distribute columns evenly, Delete column.
  - **"+" bars** below and to the right add a row or a column.
  - Columns resize by dragging their edges.
  - **Cells:** the cell with the caret is outlined in forest, and a selection of cells is tinted. Over a cell selection, the floating bar keeps only Ask for change and the marks.
- **Selected text** brings up the floating bar: **Ask for change** (an inline prompt; it arrives once an agent is connected through WebMCP), Bold, Italic, Underline, Strikethrough, Code, and **Text ▾** to turn the block into another kind (with a check on the current one).
- **Links.** `[[slug]]` and `@handle` read as links. Click to follow them on a read-only page, or ⌘-click while editing. They stay plain text in the Markdown, so search and the graph still find them.
- **Saving.** A private page saves as you type, and it stays private. A page other people can see opens read-only, with "changing it asks first". The `workspace.save-draft` tool takes Markdown and writes into the open page.
- **Motion.** Menus, handles and the floating bar fade and scale in on ohm's durations and easing. Reduced motion turns this off.
- **Not in the editor:** templates, the image placeholder with Generate and Attach, comments, and Share. All were removed on request; who a page is for is set in Visibility.
- **Code:** in `src/editor/`.
  - `PageEditor.tsx`: the page, the path pill and the block menu.
  - `TableControls.tsx`: row and column handles and the add bars.
  - The rest of the parts: `SelectionToolbar.tsx`, `InsertMenu.tsx` (the + and / menus), and `IconPicker.tsx`.
  - `commands.ts`: inserts and turn-into.
  - `extensions.ts`: the slash command, links, and the active cell.
  - `editor.css`: styles the text with ohm tokens.
  - `src/workspace/drop.ts`: opening and saving by drag.

## Steps and tools

| # | Step | Primary action | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- |
| 1 | Search | Open result | `workspace.search` | `readOnlyHint`, `untrustedContentHint` | none |
| 2 | Open | Open | `workspace.open` | `readOnlyHint` | none |
| 3 | Graph | Show graph | `workspace.graph` (opens it in the side panel) | `readOnlyHint` | none |
| 4 | Create | New post | `workspace.create` | none (only a local draft) | none |
| 5 | Edit | Save draft | `workspace.save-draft` | none (private, local) | none |

Publishing is not part of this flow. It will be its own flow, with `consequentialHint` and an `ApprovalCard` (see AGENTS.md rules 11 and 12).

`workspace.search` and `workspace.open` stay registered for as long as the workspace is on screen, because search is reachable from every view. `workspace.save-draft` exists only while the editor is open.

### `workspace.search`

- **title:** Search
- **description:** Searches the person's vault and cortex by text. Returns up to `limit` matches, each with its id, title, kind, label and a short excerpt.
- **inputSchema:** `{ "query": string (1–200), "scope"?: "all" | "vault" | "cortex", "limit"?: 1–50 }`
- **Handler:** `src/data/search.ts#search`. The overlay calls the same function. Today it searches the synthetic data in memory. Connecting a real service means replacing only this function.

### `workspace.open`

- **title:** Open
- **description:** Opens a post, memory or skill by id in the main panel, to read or edit. Returns its id, title and the view.
- **inputSchema:** `{ "id": string, "view"?: "read" | "edit" }`

### `workspace.graph`

- **title:** Show graph
- **description:** Shows the graph centred on a person. With no `center`, it centres on the owner. Returns the counts of nodes and edges.
- **inputSchema:** `{ "center"?: string (a DID or handle) }`

### `workspace.create`

- **title:** New post
- **description:** Opens a new private draft in the editor, optionally under a label. Nothing is saved until the draft is saved.
- **inputSchema:** `{ "label"?: string, "title"?: string }`

### `workspace.save-draft`

- **title:** Save draft
- **description:** Saves the open draft as private. It is never published. Returns its id and slug.
- **inputSchema:** `{ "title"?: string, "body"?: string }`

## States

| Situation | What the person sees |
| --- | --- |
| Nothing open | `Empty`: "Open a post from the vault, search, or start one" with New post |
| No search matches | "Nothing matches" in the overlay |
| Agent working | `AgentStatus` in the main panel's header |
| Draft saved | `notify()`: "Saved as private" |

## Where the code is

| Part | File |
| --- | --- |
| State and the shared handlers | `src/workspace/store.ts` |
| Rack | `src/workspace/Rack.tsx`; the bell: `NotificationCenter.tsx`, `notifications.ts` |
| Side panel: repo, visibility, inbox, you | `src/workspace/SidePanel.tsx`, `Surface.tsx` |
| Main panel and settings | `src/workspace/MainPanel.tsx`, `Settings.tsx`, `settings-tabs.ts` |
| The page editor | `src/editor/` |
| Search sheet and the one search path (vault, cortex, people, settings) | `src/workspace/SearchOverlay.tsx`, `src/data/search.ts` (`setSearchProvider`) |
| Tools | `src/workspace/tools.ts`; `workspace.save-draft` in `src/editor/PageEditor.tsx` |
| Synthetic data | `src/data/sample.ts` |

On a phone the side panel lies over the main panel. It starts closed, and closes when something opens.

## Checked

- [x] By hand, in light and dark, on a phone and a desktop (wireframe level; the graph is small on a phone)
- [x] By tools, through the development stand-in: `getTools()` lists `workspace.*` and adds `workspace.save-draft` while a private post is in the editor. `executeTool` searches, opens, creates and saves, reaching the same states as the hand walk
- [x] No tool here writes anything public. A post that isn't private gets no `workspace.save-draft`, and `saveDraft` refuses it with `NotAllowedError`

## Not yet tools

Acting on inbox items, and Ask for change in the editor, are only in the UI so far. When they become tools, anything that changes what other people see is `consequentialHint` and asks first (AGENTS.md rule 11). Settings › Agents already turns each tool on or off.

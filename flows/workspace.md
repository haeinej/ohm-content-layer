# Workspace

Every path through it, with its purpose and end state: [paths.md](paths.md).

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
| **Personal repository** | The repository, read-only. Its heading is you (picture and name) in a pill. Its menu chooses what shows: **All**, then a divider, then **Cortex** and **Vault**, any combination (checks, not checkboxes; All is both). The two top-level folders, **cortex** (a minimal brain) and **vault** (a minimal box), are bold forest rows that open in place. Their icons are outlines when closed and filled when open. The header has the eye (click: who each page is for; hover: View as), a filter (platform, type, who it is for, edited, status), **history** (Dates, You and Agents on a vertical timeline; every change marked with who made it, and reverted from there: [flows/history.md](history.md)), and one switch between list and graph. The vault's folders are **channels**: a block is listed in every channel it is in, its site section first (`photos › tokyo`) and any channel of your own (`slowness`) as well. **Dragging moves things, as in a file manager:** drag a block's row onto a channel to move it there, or above or below another block to move it to that place (each channel keeps its own order, so a block can be first in one and last in another). Hold ⌥ to add it to the other channel and keep it where it was. Drag a channel's row onto another channel to put it inside, or onto the vault row to bring it to the top; a channel that holds channels cannot go inside another yet. Drag a page onto the main panel to open it. A block's **first channel** is the one its published address comes from (`/posts/<channel>/<slug>`), so moving it out of that one changes its address on the next publish, and the notice says so. **The dot** at the right end of a block's row, on hover: click it for the block's connections card, or press it and pull a line to another block's row, a graph node or the open page to connect the two. Drag the panel's right edge to resize it (220 to 640 px; double-click resets it, arrow keys nudge it). The width is remembered on this device. Hover a page for its **⋯** (right-click opens the same menu): **Open in ›** (this window, a new tab, the graph), **Pin** (P: pinned pages show on top), **Mark as unread** (U: a bold title until opened), **Rename** (R: in place on the row, the name selected; Enter or leaving keeps it, Escape puts it back), **Move to ›** (moves this row, as dragging does), **Channels ›** (check the channels it is in; its first channel is always checked), **Remove from <channel>** (on a row in a channel that is not its first), **Archive** (A: out of the tree, into Archived at the bottom, with Restore), **Delete** (D, red, asks first). The letters work while the menu is open or the row has focus. A channel has its own **⋯**: **New page here** (N: filed there if the channel is a site section, otherwise collected into it and filed under `other`), **New channel inside** (C, for a top-level channel), **Rename** (R, in place) and **Delete channel** (D, only when it is empty). The vault row's ⋯ adds **New channel** (C). Channels are records: an empty one stays, and is offered in Move to › and Channels ›. Renaming a channel renames it wherever a block was collected into it, refiles every page whose section it is and keeps it open. Published pages get the new address when you next publish, and the notice says how many. The cortex and vault rows have a ⋯ too: **Expand all / Collapse all** (E), **Show only cortex / vault** (O), and for the vault, **New page** (N). The folders inside the cortex are fixed categories and have no menu. **Visibility lives here:** the eye in the header shows who each page is for. Every page gets a small round icon at its end (a globe for Everyone, tinted forest; people for Friends; a lock for Only you), labelled on hover, that changes it in place; showing a page to more people asks first, and marking is not publishing. Cortex items always read Only you. **View as** (You, Friends or Public) is in the eye's hover menu, and turning visibility off returns to You |
| **Inbox** | Replies, mentions, friend requests and cortex notes, newest first, with new ones marked. One about a post opens that post; the others open in the main panel |
| **Notifications** (bell) | Unchanged. A panel opens beside the rack, after agentic-twitter's notification center. **Agent** shows what an agent is doing now (its status), then what agents did through the page's WebMCP tools. **System** shows the workspace's notices. Each item shows how long ago it happened, can be removed on hover, and opens the page it is about. Clear all empties the list. A dot on the bell means something is unread; it pulses light green while an agent is working. Opening a tab marks it read |
| You (avatar) | Your picture, then your name with your handle under it. Below that, the settings sections: Your profile, Identity, Agents, Vault, Cortex, Appearance, and Sign out |

## The graph

The graph lives in the side panel, in the personal repo. It shows your blocks and how they connect, and nothing else: what agents learn about you stays in the cortex, and is not drawn here.

- **Nodes are blocks, and only blocks.** A dot's size is how connected the block is.
- **Channels are a dimension, not nodes.** Each channel is a soft area drawn around its blocks; a channel inside another is a dashed area inside it. Every block is pulled toward the channels it is in, so a block in two channels settles where their areas meet.
- **Edges are only yours.** A link written in a block's text (`[[slug]]`) is grey. A connection you made between whole blocks is forest, and hovering it shows why you made it. One line per pair of blocks.
- **Thickness is strength:** one for each way two blocks are joined (a link, a connection) and one for each channel they share.

How it looks and behaves, as Obsidian's graph view does:

- **Look:** from ohm's palette only. Blocks grey, the open or lit block forest; channel areas a faint ink wash, with a soft outline (dashed for a channel inside another). Red is never used.
- **Motion:** a force layout (d3-force) with soft springs, moderate friction and very slow cooling, so nodes drift and settle over seconds like soft rubber. Top-level channels each get their own direction; channels inside them sit close by; links still tug across.
- **Hover** rings the block, lights its edges in forest and its channels' names, and fades everything else over ohm's open duration.
- **Drag** pins a block under the pointer, and its neighbours follow on soft springs. Release it and they ease back.
- **Pan and zoom** (d3-zoom). Top-level channel names always show; names of channels inside them and of blocks fade in as you zoom, and for the hovered block. Where areas overlap, a name that would sit on another is left out.
- **Fit:** the graph stays fitted to the panel as the panel resizes and the layout settles, until you pan or zoom yourself.
- **Popover:** turns links in the text, connections and channel areas on or off, and lays the graph out again.
- **Clicking** a block (or focusing it and pressing Enter) opens it in the main panel.
- **Centred on someone else** (from search or an inbox mention): only your blocks that mention them; "Back to me" returns.
- **What it draws:** the vault's blocks the current audience can see, through the repository's filters. With only the cortex in scope, it is empty.
- **Code:** built in `src/graph/model.ts` (blocks, channels, edges and their strength) and `src/workspace/GraphView.tsx` (forces, areas, interaction, drawing).
- **Private blocks** (see ohm-vault's `plans/encryption.md`): their channels and connections are inside the encrypted files, so this graph is built on the device from decrypted blocks, never by the server.

## The page editor

Every page opens in the main panel in one block editor, built after the reference recordings (Tiptap underneath, so the page is Markdown).

- **Path.** The toolbar starts with the page's path in a pill, such as `vault / writing / journal / Monday, rain`.
  - **Rename:** click the page's name to rename it in place, with a forest ring around it and the text selected.
  - **Save by dragging:** drag the pill out of the window to save the page as a `.md` file, or onto a channel in the side panel to move it there.
  - **The ⌄ beside it** opens the page's menu, as a session list has it: Open in › (new tab, graph), Rename (R), Open file…, Save as Markdown, Move to › (from its first channel), Archive (A), Delete (D, asks first).
- **Toolbar.** After the path, a pill of inserts: Text, Image, Table, and + for everything. On the right: the connections button (with its count), History (the page's versions) and you. Toolbar inserts go after the block the caret is in, never inside a table or list.
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
- **Selected text** brings up the floating bar: **Ask for change** (an inline prompt; it arrives once an agent is connected through WebMCP), **Connect** (shown when the selection is inside one paragraph, heading or item: find a block, and the words become a link to it, `[[slug|the words]]`), Bold, Italic, Underline, Strikethrough, Code, and **Text ▾** to turn the block into another kind (with a check on the current one).
- **Links.** A `[[slug]]` reads as a chunk of green text: the linked page's title, with the brackets hidden. While the caret is inside it, it shows as written, so it can be edited, as in Obsidian's live preview.
  - **Hover:** a card shows the linked page (its path, title and opening lines), and the page is shaded green in the side panel's tree.
  - **Click:** opens the page.
  - **Your own words:** `[[slug|the words]]` reads as your words, linked to the page, with its title on hover. Connect in the floating bar writes it.
- **The connections card.** A block's connections open as a card beside it, like an info panel. Two ways in: the connections button (with a count) in the page's toolbar, and a button that shows next to the **⋯** at the right end of a block's row in the side panel when you hover it. The card holds, top to bottom:
  - **The graph around the block**, still and small, in the main graph's colours: its channels in ink, blocks it connects with in grey, cortex items drawn from it in green. Click a node to open it.
  - **In channels:** the part of the tree the block sits in, each of its channels with it (selected) and up to four neighbours, and "more…" to show the rest in the tree.
  - **Connections:** what it connects to (↗) and what connects to it (↙). Each row says where the connection was read: *in the text*, with the linked words, or a connection on the whole block with its line on why. **+ Connect** finds a block and connects the whole page to it; its *Why?* field and its ✕ are on its row.
  - **Open in the graph.**

  On a private page you change connections; on a page others see they are read-only, as the text is. These are evidence: you made them and they are in the content, so they show in the graph as grey `links`. No agent tool makes one; the cortex can only point at them.
  - **Missing pages:** a link to a page that doesn't exist reads muted and struck through.
  - **Mentions:** an `@handle` reads as a link; ⌘-click follows it while editing.
  - **Markdown:** both stay plain text, so search and the graph still find them.
- **Saving.** A private page saves as you type, and it stays private. A page other people can see opens read-only, with "changing it asks first". The `workspace.save-draft` tool takes Markdown and writes into the open page.
- **Motion.** Menus, handles and the floating bar fade and scale in on ohm's durations and easing. Reduced motion turns this off.
- **Not in the editor:** templates, the image placeholder with Generate and Attach, comments, Share, and Fork. All were removed on request; who a page is for is set in Visibility.
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
| Side panel: repo, visibility, inbox, you | `src/workspace/SidePanel.tsx`, `Surface.tsx`; the ⋯ menu: `RowMenu.tsx`; rename in place and delete: `PageActions.tsx` |
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

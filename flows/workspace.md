# Workspace

A light, Obsidian-like home for one person's vault and cortex: find something, read it, write it, see how it connects. This is a wireframe. Data is synthetic and nothing is saved.

- **Flow id:** `workspace`. Tools are named `workspace.<step>`.
- **Starts from:** the app's root, with the person signed in.
- **Ends in:** a post open to read, a post open to edit, or the graph.

## Layout

```
┌──┬──────────────┬──────────────────────────────────────────┐
│R │ Side panel   │ Main panel                                │
│A │ (cortex or   │  post view · editor · graph               │
│C │  vault tree, │                                           │
│K │  read-only)  │                                           │
└──┴──────────────┴──────────────────────────────────────────┘
          Search: an overlay above everything (⌘K)
```

| Region | What it is | ohm-ui |
| --- | --- | --- |
| **Rack** | A narrow column of icons on the left: Search, Create, Cortex, Vault, Graph. One is on a tone when its view is open | `FileTreeTab`-style buttons, `Tooltip`, `Kbd` |
| **Side panel** | A static, read-only view of the repository: the vault's labels › sublabels › posts, or the cortex's memories, notes, skills and tools. Opens when Cortex or Vault is chosen, and closes when chosen again | `FileTreePanel`, `FileTree` |
| **Main panel** | Whatever is open: a post rendered, the editor, or the graph | `Panel`, `Badge`, `Textarea`, `Input`, `Empty` |
| **Search** | An overlay on top of the screen. It searches through the `workspace.search` tool, the same path an agent uses, so a real search service can be connected behind it later | `Command` in a `Dialog` |

Rack buttons and what they do:

| Rack | Does | Main panel | Side panel |
| --- | --- | --- | --- |
| Search | Opens the search overlay (⌘K) | unchanged | unchanged |
| Create | Opens a new private draft in the editor | editor | unchanged |
| Cortex | Shows the cortex tree | unchanged | cortex |
| Vault | Shows the vault tree | unchanged | vault |
| Graph | Shows the graph, centred on the person | graph | unchanged |

## The graph

The graph is centred on a person: by default the owner, whose DID is the root of everything they have. It is laid out in rings, so where a node sits says what it is:

| Ring | Nodes | Edge to |
| --- | --- | --- |
| 0 (centre) | The person (handle, DID) | none |
| 1 | Vault labels (sections), plus one **cortex** node | the person |
| 2 | Posts around their label; memories and skills around the cortex | their label or the cortex |
| 3 | Other people the posts mention (`@handle`) | each post that mentions them |

Links between posts (`[[slug]]` in a body) are drawn as quieter chords across the rings.

- Each label gets a slice of the circle in proportion to how many posts it holds, and its posts fan out inside that slice. The layout is computed from the tree, not simulated, so it is the same every time and needs no graph library.
- **Selecting** a post opens it in the main panel. Selecting a label or the cortex highlights its slice.
- **Re-centring:** selecting another person makes them the centre. Their ring 1 holds the posts that mention them, grouped by label. "Back to me" returns to the owner.
- Private posts are drawn hollow, friends-only posts in a muted tone and public posts filled. Colour doesn't carry meaning here, except forest for the centre.
- Built in `src/graph/layout.ts` (where nodes go) and `src/workspace/GraphView.tsx` (drawing them as SVG).

## Steps and tools

| # | Step | Primary action | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- |
| 1 | Search | Open result | `workspace.search` | `readOnlyHint`, `untrustedContentHint` | none |
| 2 | Open | Open | `workspace.open` | `readOnlyHint` | none |
| 3 | Graph | Show graph | `workspace.graph` | `readOnlyHint` | none |
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
| Rack | `src/workspace/Rack.tsx` |
| Side panel | `src/workspace/SidePanel.tsx` |
| Main panel, post view, editor | `src/workspace/MainPanel.tsx`, `DocView.tsx`, `Editor.tsx` |
| Search overlay and the one search path | `src/workspace/SearchOverlay.tsx`, `src/data/search.ts` (`setSearchProvider`) |
| Tools | `src/workspace/tools.ts`; `workspace.save-draft` in `Editor.tsx` |
| Synthetic data | `src/data/sample.ts` |

On a phone the side panel lies over the main panel. It starts closed, and closes when something opens.

## Checked

- [x] By hand, in light and dark, on a phone and a desktop (wireframe level; the graph is small on a phone)
- [x] By tools, through the development stand-in: `getTools()` lists `workspace.*` and adds `workspace.save-draft` while a private post is in the editor. `executeTool` searches, opens, creates and saves, reaching the same states as the hand walk
- [x] No tool here writes anything public. A post that isn't private gets no `workspace.save-draft`, and `saveDraft` refuses it with `NotAllowedError`

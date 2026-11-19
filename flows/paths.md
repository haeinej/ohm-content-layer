# Every interaction path in the workspace

What a person (or an agent) can do in the ohm workspace wireframe, where each path starts, how it goes, where it ends, and what it is for. This is the end-state record of the wireframe as built. The layout and design are in [workspace.md](workspace.md); the rules are in [../AGENTS.md](../AGENTS.md).

**The workspace in one sentence:** one person's home for what they write (the **vault**) and what their agents know about them (the **cortex**). Here they find things, write pages, see how everything connects around them, decide who sees what, and let an agent help through the same steps.

How to read each path:
- **Entry:** where it starts.
- **Steps:** what the person does.
- **End state:** what is true when it is done.
- **For:** why someone would take it.
- **Agent:** the WebMCP tool that runs the same step, or *UI only*.
- **Asks first:** for anything other people would see, or anything that can't be undone, the page confirms before acting.

Nothing in the wireframe is saved between reloads. Every end state below is true for the session.

---

## A. Finding and opening

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| A1 | **Search** | Rack Search or ⌘K → type → arrows or hover → Enter or click | The chosen page, setting or person is open | Get to anything without knowing where it lives | `workspace.search`, then `workspace.open` |
| A2 | Narrow a search | In search, choose All, Vault, Cortex, People or Settings | Only that kind of match shows | Cut noise when you know what you want | `workspace.search` with `scope` |
| A3 | Search finds a setting | Type a setting's word (e.g. "dark") → choose it | That settings page is open | Reach a setting without browsing | `workspace.search` (`scope: settings`) |
| A4 | Search finds a person | Type a name or handle → choose them | The graph is centred on that person | See everything that touches someone | `workspace.search`, then `workspace.graph` |
| A5 | Ask an agent from search | Type a question → Send with no match chosen | A notice: asking arrives once an agent is connected | Reserved: ask instead of look up | *Not yet* |
| A6 | Open from the tree | Personal repository → expand → click a page | The page is open in the editor; its row is selected; its unread dot clears | Browse by where things live | `workspace.open` |
| A7 | Open from the graph | Graph → click a block or cortex node (or focus it and press Enter) | That page is open in the editor | Browse by how things connect | `workspace.open` |
| A8 | Follow a link | In a page, click a green `[[link]]` | The linked page is open | Move along the links you wrote | `workspace.open` |
| A9 | Preview a link | Hover a green `[[link]]` | A card shows the page's path, title and opening lines; the page is shaded green in the tree | Check where a link goes without leaving | *UI only* |
| A10 | Open by dragging | Drag a page from the tree onto the main panel | That page is open | Open by direct manipulation | *UI only* |
| A11 | Open a file | Drop a `.md` or `.txt` on the main panel, or Path ⌄ → Open file… | A new **private** page with the file's name and text is open | Bring writing in from your disk | *UI only* |
| A13 | **Back and forward** | Toolbar ← →, or ⌘[ and ⌘] | The previous or next page you opened is open again, revealed in the tree | Retrace your steps | *UI only* |
| A12 | Open in a new tab | Row ⋯ or Path ⌄ → Open in › New tab | The page opens in a new tab (`?open=<id>`) | Keep two pages side by side | *UI only* |

## B. The personal repository (side panel)

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| B1 | Show or hide the panel | Rack Personal repo, or ⌘\ (brings back the panel you last had) | The panel shows or hides; the open page never changes | Make room, or come back to your files | *UI only* |
| B1a | **Reveal the open page** | Automatic: open a page from anywhere | Its folders open in the tree; it scrolls into view, is selected and flashes once | Always know where you are | Any tool that opens a page |
| B1b | Reveal a folder from the path | Click a folder in the path pill | The panel shows the repository with that folder open, scrolled to, flashing | Jump from where a page lives to its neighbours | *UI only* |
| B2 | Choose what shows | Your pill (picture and name) → All, or Cortex and/or Vault | The tree and graph show only those | Focus on memory, or on writing | *UI only* |
| B3 | Open and close folders | Click a folder or the cortex/vault row (each side's ⋯ also has Expand all) | Folders open or closed (cortex, vault, labels, sublabels) | Walk the hierarchy | *UI only* |
| B4 | Expand one side | Cortex or vault ⋯ → Expand all / Collapse all (E) | Everything inside that one opens or closes | Survey one side at once | *UI only* |
| B5 | Show only one side | Cortex or vault ⋯ → Show only… (O) | The scope becomes that one | Same as B2, from the row | *UI only* |
| B6 | List or graph | Header: one switch, showing the view it goes to (graph icon in the list, list icon in the graph) | The panel shows the list or the graph of the same scope and filters | Switch between where and how things connect | `workspace.graph` opens the graph |
| B6a | **Filter** | Header funnel → Platform (your site, Bluesky, Instagram, X), Type (text, photo, table, checklist; memory, note, skill, tool), Who it is for, Edited (any time, past week, month, year), Status (unread, pinned); Clear | The list and the graph show only matching pages; folders open so matches are in view; a dot on the funnel while any filter is on; "Nothing matches" with Clear when empty | Find a kind of page across folders | *UI only* |
| B7 | Resize the panel | Drag its right edge (or arrows on the handle; double-click resets) | Width 220–640 px, remembered on this device | More room for names or the graph | *UI only* |
| B8 | **New page** | Rack New post, ⌘N, vault ⋯ → New page (N), or folder ⋯ → New page here (N) | A new **private** page open in the editor, title focused, in that folder if chosen | Start writing | `workspace.create` |
| B9 | Pin | Row ⋯ → Pin (P) | The page shows under Pinned at the top; press again to unpin | Keep what you return to close | *UI only* |
| B10 | Mark as unread | Row ⋯ → Mark as unread (U) | A bold title until opened | Remind yourself to come back | *UI only* |
| B11 | **Rename a page** | Row ⋯ → Rename (R), or click the page's name in the path pill | The name, in place, ringed in forest; Enter or leaving keeps it, Escape puts it back | Fix or improve a title | *UI only* (or `workspace.save-draft` with `title`, private pages) |
| B12 | **Rename a channel** | Channel ⋯ → Rename (R) | The channel is renamed everywhere a block was collected into it, and every page whose section it is is refiled; it stays open. The notice counts published pages whose address follows on the next publish | Keep your sections in your own words | *UI only* |
| B13 | **Move a block** | Drag its row onto a channel, or above or below another block; or Row ⋯ → Move to › (Path ⌄ → Move to › moves it from its first channel) | It leaves the channel that row was in and sits in the other, at that place. Moved out of its first channel, its address changes on the next publish, and the notice says so | Reorganise, as in a file manager | *UI only* |
| B13a | **Add to another channel** | Hold ⌥ while dragging the row onto a channel, or Row ⋯ → Channels › and check it | The block is listed there as well as everywhere it already was | Gather a block into many channels, as on Are.na | *UI only* |
| B13b | Take out of a channel | Row ⋯ → Remove from <channel> (on its row in that channel), or Channels › and uncheck it | It leaves that channel only; its section never changes this way | Undo a collection | *UI only* |
| B13c | **Move a channel** | Drag a channel's row onto another channel, or onto the vault row for the top | It goes inside the other channel, or to the top, with every block in it and its order; a channel that holds channels cannot go inside another yet, and is refused with a notice | Reorganise channels | *UI only* |
| B13d | **New channel** | Vault ⋯ → New channel (C), or a channel's ⋯ → New channel inside (C) | An empty channel, shown in the tree and named in place; it stays when empty | Make a place before there is anything in it | *UI only* |
| B13e | Delete a channel | A channel's ⋯ → Delete channel (D), offered only when it is empty | The channel is gone; a channel with blocks or channels in it is refused, with the reason | Tidy up | *UI only* |
| B14 | Archive | Row ⋯ or Path ⌄ → Archive (A) | The page leaves the tree for Archived · n at the bottom; Restore brings it back. If it is open, it stays open with an "archived" bar and Restore | Clear clutter without deleting | *UI only* |
| B15 | Delete | Row ⋯ or Path ⌄ → Delete (D) → **confirm** | The page is removed from the vault. If it was open, the page you had before it opens (never a blank editor). For a published page, the dialog says taking it down is its own step | Remove what you don't want | *UI only* · **asks first** |
| B16 | Shortcuts on a row | Focus a row → P, U, R, A, D (pages) or N, C, R, D (channels) | As B9–B15, without opening the menu | Work fast from the keyboard | *UI only* |

## C. Visibility (inside the personal repository)

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| C1 | Show who each page is for | Click the eye in the repository header | Each page shows an icon at its end: globe (Everyone), people (Friends), lock (Only you); the label is on hover | See at a glance what is shared | *UI only* |
| C2 | **Make a page less private** | Click a page's icon → Friends or Everyone → **confirm** | The page is *marked* for that audience. It is **not published**: it reaches your site and other apps only when you publish | Decide who a page is for | *UI only* · **asks first** |
| C3 | Make a page more private | Click its icon → Friends or Only you | Marked at once (no confirmation needed) | Pull something back | *UI only* |
| C4 | **View as someone else** | Hover the eye → View as You / Friends / Public | The tree, graph and page show only what that audience can see; the cortex is locked; a bar says "Viewing as…" with Back to you. If the open page is one they can't see, the editor says so instead of showing it | Check what others actually see before you publish | *UI only* |
| C5 | Back to yourself | Back to you, choose You, or hide visibility | Everything is visible again | Return to editing | *UI only* |

## D. The graph

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| D1 | **See your graph** | Repository → graph icon, or ⌘G | You at the centre, the cortex close around you, then channels and blocks, with evidence (links, mentions, sources) in grey and the cortex's inferences in green | See how what you know and what you wrote connect | `workspace.graph` |
| D2 | Explore | Hover a node | It and its edges light up; the rest fades | Read one node's neighbourhood | *UI only* |
| D3 | Rearrange | Drag a node | Its neighbours follow on soft springs and settle back | Untangle a part to look at | *UI only* |
| D4 | Zoom and pan | Wheel or pinch, drag the background, or + / − / fit | The view moves; block and cortex names fade in as you zoom; fit returns to all | Read detail or the whole | *UI only* |
| D5 | **Centre on a person** | Click an entity node (or a search result, or an inbox mention) | The graph is centred on them: blocks that mention them, and you | See everything around someone | `workspace.graph` with `center` |
| D6 | Back to you | Back to me | Centred on you again | Return | `workspace.graph` |
| D7 | Filter the graph | Graph settings → Links between blocks, Entities mentioned, Sources; Lay out again | Those edges or nodes show or hide; the layout restarts | Simplify or refresh | *UI only* |

## E. The page editor (main panel)

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| E1 | **Write** | Open a private page → type | Saved as you type, still private | The main thing | `workspace.save-draft` |
| E2 | Title | Type in "Untitled page" → Enter moves into the page | Titled | Name what you're writing | `workspace.save-draft` (`title`) |
| E3 | Page icon | Hover the title → face icon → search or pick (Clear removes) | An emoji above the title | Recognise a page at a glance | *UI only* |
| E4 | Insert with "/" | Type `/` → filter → Enter | The block is inserted (headings, lists, checklist, quote, code, divider, table, image, assistant instructions) | Add structure without the mouse | *UI only* |
| E5 | Insert from the toolbar | Text, Image, Table, or + (everything) | Added after the current block | Add structure with the mouse | *UI only* |
| E6 | Format selected text | Select text → B, I, U, S, code | The marks are applied | Emphasis | *UI only* |
| E7 | Turn a block into another | Select → Text ▾ → Heading, list, checklist, quote or code | The block changes kind | Restructure | *UI only* |
| E8 | Ask for a change | Select → Ask for change → type → send | A notice: it arrives once an agent is connected | Reserved: have an agent rewrite a passage | *Not yet* |
| E9 | Move a block | Drag the block handle (⋮⋮) | The block moves | Reorder | *UI only* |
| E10 | Block menu | Click the handle → Insert below, Duplicate, Copy as Markdown, Delete | As chosen | Quick block actions | *UI only* |
| E11 | **Tables** | Hover a table: row handle (insert above or below, move up or down, delete), column handle (insert left or right, move, fit, distribute, delete), + bars (add row, column), drag column edges; table handle → Header row/column, Copy as Markdown, Delete table | The table changes | Shape data in a page | *UI only* |
| E12 | **Images** | Drop or paste an image on the page, or Image → pick a file | The image is in the page where it landed | Illustrate | *UI only* |
| E13 | **Links** | Type `[[slug]]`, or `[[slug\|your words]]` | It reads as a green chunk with the linked page's title, or your words (raw while the caret is in it); it joins the graph's links | Connect pages | `workspace.save-draft` (Markdown body) |
| E13a | **Connect words** | Select words in one paragraph → Connect → find a block → Enter | The words become a link to it, `[[slug\|the words]]`; it is listed in the connections card, *in the text* | Tie a connection to the passage that justifies it | *UI only*: connections are yours |
| E13b | **Connect the page** | Connections card → + Connect → find a block → Enter; then Why? (optional) | A connection on the whole block, with its line on why, listed in this card and as ↙ in the other page's card | Connect whole blocks, and say why | *UI only*: connections are yours |
| E13d | **See a block's connections** | Page toolbar → connections button (its count), or hover a block's row in the side panel → click the dot at its right end | A card beside it: the graph around the block, the part of the tree it sits in, and its connections | Read how one block sits among the rest without leaving it | *UI only* |
| E13e | **Connect by pulling a line** | Hover a block's row → press its dot and pull: a line follows the pointer → let go over another block's row, a graph node, or the open page | The two blocks are connected as whole blocks; a notice names both. Escape, or letting go anywhere else, connects nothing. From a block others see, it is refused with a notice | The quickest way to connect two blocks | *UI only*: connections are yours |
| E13c | Disconnect | Connections card → hover a whole-block connection → ✕ | It is gone from both pages and the graph; a link in the text is removed by editing the text | Undo a connection | *UI only* |
| E14 | Mention | Type `@handle` | A link; ⌘-click centres the graph on them; they join the graph | Connect people | `workspace.save-draft` |
| E15 | **Save as Markdown** | Drag the path pill out of the window, or Path ⌄ → Save as Markdown | A `.md` file of the page | Take your writing anywhere | *UI only* |
| E16 | **History** | Page toolbar → clock | The page's versions, as in H9 | Go back in time | `history.versions` |
| E17 | Read a shared page | Open a page for friends or everyone | Read-only, with "changing it asks first" | Protect what others already see | *UI only* |

## F. Inbox and notifications

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| F1 | **Inbox** | Rack Inbox (a dot when there are new items) | The side panel lists replies, mentions, friend requests and cortex notes, newest first | See what came in from others | *UI only* |
| F2 | Open an inbox item | Click it | About a post: that post opens. Otherwise its own view opens (a friend request: Accept / Not now; a mention: see them in the graph). It counts as read | Respond | *UI only* |
| F3 | **Notifications** | Rack bell (a dot when unread; it pulses while an agent works) | A panel: **Agent** (what an agent is doing now, and what agents did through WebMCP) and **System** (the workspace's notices) | Know what happened, especially what an agent did | *UI only* (every tool run is recorded here) |
| F4 | Act on a notification | Click one about a page; × removes one; Clear all | Opens the page / removes / empties | Follow up or tidy | *UI only* |

## G. Profile and settings

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| G1 | Open settings | Rack avatar | The side panel shows you (picture, name, handle) and the settings sections; the main panel shows one | Manage your account and workspace | *UI only* |
| G1a | Leave settings | Done, or the avatar again | The page and panel you came from are back | Return to work where you left it | *UI only* |
| G2 | Your profile | Settings → Your profile | Name, description and picture fields; Review changes notes that publishing your profile asks first | Shape how other apps show you | *UI only* · publishing **asks first** |
| G3 | Identity | Settings → Identity | Your DID (copy), handle, server | Know and share your root identity | *UI only* |
| G4 | **Agents** | Settings → Agents → Let agents use this page; one switch per tool | Tools are offered to an agent, or withdrawn, at once | Control what an agent can do here | Governs every tool |
| G5 | Vault | Settings → Vault | New posts start private (always); your labels | Review how your vault is organised | *UI only* |
| G6 | Cortex | Settings → Cortex | Memories, notes waiting, skills | Review what your agents remember | *UI only* |
| G7 | Appearance | Settings → Appearance → System / Light / Dark; Density Compact / Comfortable / Rounded | Theme and how round and tight things are, on this device | Comfort | *UI only* |
| G8 | Sign out | Settings → Sign out | A notice (not in the wireframe) | Leave | *Not yet* |

## H. History ([flows/history.md](history.md))

You and agents both edit directly; every change is marked with who made it, and you revert what you don't want.

| # | Path | Entry → steps | End state | For | Agent |
| --- | --- | --- | --- | --- | --- |
| H1 | **See history** | Repository header → history button → Dates, You or Agents | One line per entry, a verb and the page ("Edited Monday, rain"), with an icon for you, an agent, a save or a day | Know what happened, and who did it | `history.list` |
| H2 | **A day** | Dates → a day | That day's changes, as the same lines | See a day at a glance | `history.list` with `since` |
| H3 | **An agent's session** | Agents → a session | What it did, the changes it made, and its dead ends | See what an agent did as one task, and what not to retry | `history.list` |
| H4 | Finish a task (agents) | An agent, when it is done | A session: what it did, its changes grouped, its dead ends | Leave the next agent what was learned | `history.session` |
| H5 | **Open a change** | Any line that is a change | Who, when, why, what it touched as a tree, the words it changed | Read a change without opening the page | `history.list` |
| H6 | **Revert this change** | An opened change → Revert this change | Only what it touched goes back; refused if a later change touched the same part | Undo one change, yours or an agent's | `history.revert` |
| H7 | **Restore this version** | An opened change (here or in a page's card) → Restore this version | The page as it was right after that change | Go back to a version | `history.restore` |
| H8 | **Save** | History → Save → a name | A named point on the line; nothing changes | Mark a moment to come back to | `history.save` |
| H9 | **A page's versions** | Page toolbar → clock | The page's own changes and saves | See how a page came to be | `history.versions` |

## I. An agent, through WebMCP

An agent in the browser sees only the tools the page offers right now (Settings › Agents decides which). Each tool calls the same code as the click it stands for. While a tool runs, the page shows the agent at work, and the bell records it.

| Tool | Does | Same as | Annotations | End state |
| --- | --- | --- | --- | --- |
| `workspace.search` | Searches vault, cortex, people and settings | A1–A4 | read-only, untrusted content | Matches returned (nothing changes on screen) |
| `workspace.open` | Opens a page by id | A6 | read-only | The page is open in the editor |
| `workspace.graph` | Shows the graph, centred on someone | D1, D5 | read-only | The graph is in the side panel |
| `workspace.create` | Starts a private page | B8 | — | A new private page is open |
| `workspace.save-draft` | Saves the open private page (title, Markdown body) | E1, E2, E13 | — (private only) | Saved, still private. It refuses a page others can see |
| `history.list` | Reads the repository's history and open dead ends | H1–H6 | read-only, untrusted content | — |
| `history.versions` | Reads the open page's versions | H9, E16 | read-only, untrusted content | — |
| `history.revert` | Undoes one change to a private page; marked as the agent's | H6 | — (private only) | A new change, by the agent |
| `history.restore` | Brings a private page back to a version; marked as the agent's | H7 | — (private only) | A new change, by the agent |
| `history.save` | Names this point in history | H8 | — | A save; nothing changes |
| `history.session` | Records a finished task, its changes and dead ends | H4 | — | A session |

Nothing an agent can do here is public. Making a page visible to others, deleting, and publishing are not tools yet. When they become tools, they will be marked consequential and ask the person first, as the UI does now.

## End states, in short

| After… | It is true that… |
| --- | --- |
| Opening anything | One page is open in the editor; the tree has revealed it and shows it selected; the graph rings it; it is in your back/forward history; its unread dot is gone |
| Writing | The page is saved and still private |
| Renaming or moving | The tree, path pill, editor title, search and graph all agree. For a published page, its address follows when you next publish |
| Marking who a page is for | It is marked, not published. Showing it to more people needed your yes |
| Viewing as Friends or Public | You see exactly what they would; your cortex is hidden; you are one click from Back to you |
| Archiving | Out of the tree, kept, restorable |
| Deleting | Gone from the vault, after your yes; you are on the page you had before. Published copies are handled by a separate take-down step |
| Hiding the panel | The page you were on is still open; ⌘\\ brings the panel back as it was |
| Leaving settings | You are back on the page and panel you came from |
| An agent acting | You saw it working, the bell recorded what it did, and nothing became public |

## Not yet (reserved paths)

These show a notice saying what they will do. Each will become a path above once its service exists:
- **Agent features:** ask an agent (from search and from selected text), and generate or visualise.
- **Version history.**
- **Publishing and taking down.** Its own flow, with an approval card.
- **Accepting friend requests.**
- **Media:** video, audio and file blocks.
- **Signing out.**
- **Persistence:** saving across reloads.

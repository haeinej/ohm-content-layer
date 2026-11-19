# History

You see everything that happened in your repository: what you did and what agents did, each change marked with who made it. You revert what you don't want, restore any earlier version, and save a point to come back to. When an agent finishes a task it says what it did and where it got stuck. History only grows: nothing in it is rewritten.

This is the cortex's journal ([cortex/docs/journal-and-history.md](https://github.com/haeinej/ohmmmm/blob/main/cortex/docs/journal-and-history.md) in ohmmmm) as a person and an agent use it. Keeping an agent's dead ends follows [ANVC](https://github.com/yodering/anvc). The wireframe keeps the journal in memory, in `src/data/journal.ts`.

- **Flow id:** `history`. It prefixes every tool name.
- **Starts from:** the history button in the repository's header (the whole repository), or the clock in a page's toolbar (that page).
- **Ends in:** a change read; a change reverted or a version restored; a save made; an agent's session recorded; or nothing changed.

## How history is kept

- **Every page is a block, cortex pages too.** Memories, notes, skills and tools have versions and history like any block.
- **You and agents both edit directly.** Every change is a line that says what was done, to which page, by whom (you, or an agent by name), when, the versions before and after, and any reason the agent gave. An agent's edits are its versions; you revert the ones you don't want. `withAgent` in `src/workspace/tools.ts` runs every agent tool as that agent, so what it changes is marked as its.
- **Typing makes one change, not one per key.** Edits to the text by the same person or agent within five minutes join one line.
- **Sessions are for agents, written when a task is done.** In one line, the session says what the agent did. It groups the changes the agent made since its last session, and lists its **dead ends**: what it tried and dropped, why, and how to recheck. A later agent reads them before it starts, so it doesn't retry them.
- **A save names a point.** It changes nothing.
- **Daily autosaves are a layer of their own.** Each day with changes has an autosave: every page as it was at the end of that day. The cortex writes it when the day closes; the wireframe reads it from the day's changes.
- **There are no traces.** What an agent reads is not recorded; only what it changes, and what it says it did.
- **Pages others can see are not changed from here.** Changing what others see asks first, which is not part of this wireframe yet; their history is read-only here.
- **Organising is not changing what others see.** Moving a block between channels, adding it to one, and reordering are yours, on any page: they reach your site only when you publish, and moving a page out of its first channel says its address will change then. Its text, its connections, and restoring or reverting it are its content, so for a page others can see they ask first.

## How it looks

A minimal timeline drawn vertically, as VS Code's Timeline is: one thin line down the left, one line of text per entry, and an icon on the line:

| Icon | What it is |
| --- | --- |
| A person, in forest | Something you did |
| A bot, in light green | Something an agent did |
| A flag | A save |
| A calendar | A day's autosave |

**Each line says what was done as a verb, then the page:** Created, Edited, Moved, Filed (changed its channels), Connected, Restored, Reverted, Deleted. For example, "Edited **Monday, rain**". An agent's session reads "Muse: Looked for pages that belong together · 1 dead end".

**The repository's history has three tabs: Dates, You, Agents.**

- **Dates:** one autosave per day, newest first. Open a day for its changes, as the same lines as the other tabs, by you and by agents.
- **You:** your changes and saves, by day.
- **Agents:** agents' sessions, by day. Open one for the changes it made, as the same lines, and its dead ends.

**Open any line for its details**, as a version control tool shows a commit:

| What you open | What it shows | What you can do |
| --- | --- | --- |
| A change | Who made it, when and why, what it touched as a small tree (title, text +words −words, first channel, channels, connections) and the words it changed; *Against now* compares that version with the page today | **Revert this change** (undo only what it touched, as `git revert` does; refused if a later change touched the same part), **Restore this version** (the whole page as it was right after), **Open page** |
| A session | The changes it made, each one opening like any change, and its dead ends | — |
| A save | Who saved it, when, and its note | — |

Reverting and restoring are new changes, so either can itself be reverted.

**A page's versions**, from its toolbar's clock, are the same for one page: its changes, with saves between.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The repository's history | Side panel: Dates / You / Agents and a quiet Save, then the timeline | Save | `history.save` | none: it changes nothing | none |
| 1a | Read it | the same | (reading) | `history.list` | `readOnlyHint`, `untrustedContentHint` | none |
| 1b | Finish a task (agents) | none: an agent's step | (Finish task) | `history.session` | none: it changes no page | none |
| 1c | A change, opened (here or in a page's versions) | Its details | Revert this change | `history.revert` | none: private pages only, and a revert can itself be reverted | none |
| 1d | the same | the same | Restore this version | `history.restore` | none: private pages only, and a restore can itself be reverted | none |
| 2 | A page's versions | `Popover` from the page toolbar's clock | (opening a change, 1c and 1d) | — | — | — |
| 2a | Read them | the same | (reading) | `history.versions` | `readOnlyHint`, `untrustedContentHint` | none |

## Tools

`history.revert` and `history.restore` exist while the repository's history or a page's versions is on screen, since both show those buttons: the first view to open registers them, the last to close withdraws them. `history.session` is the one tool without a button: finishing a task is an agent's step, and a person's work needs no session.

### `history.list`

- **title:** History
- **description:** Lists the repository's history, newest first: changes (what was done, to which page, by whom, why), agents' sessions with the changes they made and their dead ends, and saves. Filter by who, page id or a since date. Returns the lines and the dead ends a new task should not retry.
- **inputSchema:** `{ "who"?: "all" | "human" | "agent", "node"?: string, "since"?: date, "limit"?: 1–100 }`
- **outputSchema:** `{ "lines": [...], "deadEnds": [...], "next": "history.session" }`

### `history.session`

- **title:** Finish task
- **description:** Records that the agent finished a task: one line of what it did, and its dead ends (what it tried and dropped, why, and how to recheck), so a later agent does not retry them. Groups the changes it made since its last session. Changes no page. Returns the session.
- **inputSchema:** `{ "done": string (1–200), "deadEnds"?: [{ "tried", "why", "recheck"? }] (≤10) }`
- **outputSchema:** `{ "session": ..., "changes": n, "deadEnds": n, "next": "history.list" }`
- **Handler:** `src/workspace/store.ts#finishSession`
- **Errors:** `NotAllowedError` when it is not an agent; `DataError` when `done` is empty

### `history.revert`

- **title:** Revert this change
- **description:** Undoes one change to a private page, as git revert does: only the parts that change touched go back, and later changes to other parts stay. Refused if a later change touched the same part. The revert is a new change, marked as the agent's. Returns the page id and the parts reverted.
- **inputSchema:** `{ "change": string }`: a change id from `history.list` or `history.versions`
- **Handler:** `src/workspace/store.ts#revertChange`, the same one the button calls

### `history.save`

- **title:** Save
- **description:** Names the repository as it is now, so it can be found and compared later. It changes no page. Returns the save's name and its place in the history.
- **inputSchema:** `{ "name": string (1–80), "note"?: string (≤300) }`
- **Handler:** `src/workspace/store.ts#saveNow`

### `history.versions`

- **title:** Versions
- **description:** Lists the versions of the page open in the editor, newest first, with who made each.
- **outputSchema:** `{ "current": "v…", "versions": [...], "next": "history.restore" }`

### `history.restore`

- **title:** Restore this version
- **description:** Brings a private page back to one of its earlier versions. History is kept: the restore is a new change, marked as the agent's, with the reason given, which the person can revert.
- **inputSchema:** `{ "page": string, "version": "v" + 8 hex, "reason"?: string }`: the reason is kept on the change
- **Handler:** `src/workspace/store.ts#restoreVersion`, the same one the button calls

## States

| Situation | What the person sees |
| --- | --- |
| Agent working | `AgentStatus` ("Reverting a change", "Finishing a task", …) |
| Done | `notify()`: "Reverted: …", "Restored …", "Saved …" |
| Can't be done | `notify()` with the reason: a later change touched the same part; others can see the page |
| Empty | "Nothing by agents yet", "Nothing by you yet"; "No history yet" for a new page |

## Not yet

- **The whole repository as of a save or a day.** One page's version at a save or a day is readable now; the whole tree as it was is the cortex's `cortex_as_of`, not drawn here yet.
- **What changed since a save**, as one comparison.
- **Changing a page others can see**, which needs the approval step.

## Cross-origin

None.

## Checked

- [x] By hand: Dates, You and Agents; a day opening into its changes; an agent's session opening into its change; reverting Muse's connection, which showed under You as "Reverted Reading list"; restoring your own change
- [x] By tools: `getTools()` lists `history.list`, `history.revert`, `history.session` and `history.save` only while the repository's history shows
- [ ] In dark, and on a phone

# Cortex, history and traces: one path

Written 19 November 2026. A proposal, nothing here is built. It joins three things that are now separate: the cortex, version history, and agent traces. It goes with [the personal brain plan](personal-brain.md).

## What exists today

There are two cortexes. **ohm-cortex (B) is the cortex.** The one in ohm-content-layer (A) was the first MVP and will not be used; it is listed only so nothing in it is mistaken for current.

| | A · ohm-content-layer cortex | B · ohm-cortex (haeinej/ohm-cortex) |
| --- | --- | --- |
| Where it keeps things | D1 tables on the vault service (`cortex_*` in `service/schema.sql`) | A folder of Markdown the person can open |
| Built | Memories with versions and history, context, notes and settlement (server checks two-session evidence), skills with approval, proposed tools | Identity with proposals, `vault.md`, memories, **working memory per agent**, **distill**, notes and settlement, skill and tool proposals, filing advice, `.cortex/history/`, MCP over stdio and HTTP, **hooks for Claude Code and Codex** |
| Turns | Tables and requests reserved, not built | Not taken; replaced by working memory and distill |
| Hooks | Designed in `plans/build-plan.md`, not built here | Built: `session-start`, `prompt` (empty), `stop` (asks to distill once per change), `session-end`. Not yet tried in a real session |
| Status | B's plan says B replaces A's design, and that B does not sync with ohm | 97 tests, CI on Node 20 and 22 |

So hooks exist, in ohm-cortex. A is retired.

### Overlaps and gaps

1. **The same rules are written twice.** Memory format, versions and settlement are in `cortex/core.mjs` and `cortex/store.mjs` (A) and in `src/core.mjs` and `src/folder.mjs` (B). They have already diverged: A checks evidence on the server and has turns; B has working memory, distill and identity.
2. **There are too many ways to write memory.** B alone has nine: `cortex_remember`, `cortex_working`, `cortex_note`, `cortex_distill`, `cortex_settle`, `cortex_describe_section`, `cortex_propose_identity`, `cortex_propose_skill`, `cortex_propose_tool`. The brain plan would add `brain_connect`, `brain_settle`, `brain_stamp` and `brain_trace`.
3. **There are already five half-logs:** `.cortex/notes.jsonl` (notes and settlements), `.cortex/sessions.jsonl` (hook starts, asks and distills), `.cortex/history/` (earlier file versions), A's `cortex_memory_versions` and `cortex_turns`, and the vault's `seq`. Each is part of a trace. None records who changed a block, what an agent read, or what was tried and dropped.
4. **Evidence means sessions, not things.** A memory cites notes, and notes cite sessions. Nothing ties a memory to the blocks it was drawn from, so nothing can say it is out of date.

## The proposal

### 1. One cortex: ohm-cortex

Decided: ohm-cortex is the cortex, folder-first and standalone. The ohm-content-layer cortex (`cortex/`, `mcp/cortex-tools.mjs`, the `cortex_*` tables and `com.ohmmmm.cortex.*` requests, `skills/cortex/`) was the MVP and is retired: nothing new is built on it, and it can be removed once nothing reads it. Rules live in one place, ohm-cortex's `src/core.mjs`.

The brain folder holds the cortex inside it:

```
~/Brain/
  blocks/  channels/  entities/  sources/  connections.jsonl     # content (personal-brain.md)
  cortex/  identity.md  vault.md  memory/  skills/  tools/  agents/  # B's layout, unchanged
  .brain/
    journal.jsonl     # the one log (below)
    history/          # every earlier version of every file, by version hash (B's .cortex/history/)
    index.sqlite      # derived and rebuildable
    working/<agent>.md
```

B's principle still holds: the cortex holds no content. It points at blocks by ID and version, and never copies them.

### 2. One log: the journal

One append-only file replaces `notes.jsonl`, `sessions.jsonl`, turns, and the changes and traces from the brain plan. Each line has `seq`, `at`, `actor` (`{kind: human|agent, name}`), `session` and `type`:

| `type` | Written by | Holds | Was |
| --- | --- | --- | --- |
| `session` | Hooks (start and end), or the editor | Agent, goal, project, outcome, distilled or not | `sessions.jsonl` |
| `change` | Every store write | Node, op, `before` and `after` versions, changed fields, reason | Nothing (only `history/`) |
| `trace` | Hooks and the MCP server | `read` (node@version), `search` (query and results), `fetch` (url → source), `attempt` (tried, error) | Nothing |
| `note` | The agent | One observation, with `evidence` | `notes.jsonl` |
| `proposal` | The agent | Identity fact, skill, tool, connection or channel, with reason and evidence | Four separate proposal paths |
| `decision` | The person, or settlement | Accepted, rejected, confirmed, approved, kept or dropped, and why | Settled lines, identity rejects |
| `stamp` | The person or an agent | A name and a note at this `seq` | Nothing |

- **History is the journal plus `history/`.** "As of a date" means replaying to that day. A stamp is a line. Autosave is not needed because every change is a line. Restore writes a new `change`.
- **It merges cleanly.** Lines are append-only with IDs, so two machines join by union (B already marks `sessions.jsonl` `merge=union`). That makes sync to ohm, or to Git, a copy, not a merge.
- **Privacy.** Traces hold what was read and asked. The journal stays private by default, and each type can be marked local-only, as ANVC does per field.

### 3. Capture: hooks first, the MCP server second

| Moment | Hook | Now | Adds |
| --- | --- | --- | --- |
| Session start | `SessionStart` | Playbook, identity, always memories, working memory | Opens a `session` line. Adds **stale inferences**, **recent rejections** and **attempts that failed** near this project |
| Before a prompt | `UserPromptSubmit` | Empty | Later: memories fitted to the prompt |
| After a tool call | `PostToolUse` (new) | n/a | A `trace` for brain and vault tool calls: what was read, searched or captured, with versions. Never the full output |
| End of a turn | `Stop` | Asks to distill once per change | Unchanged |
| Session end | `SessionEnd` | Records the end | Closes the `session` line |

The MCP server writes the same traces for its own tools, so an agent without hooks, such as Muse or a web client, is still traced. The rule: **ohm records reads and changes itself; the agent supplies only judgement** (reasons, goals, summaries, notes).

### 4. One way to write memory: three levels

This follows your point: evidence is concrete, the model infers between, and the cortex is the inference.

| Level | What | Written by | Rule |
| --- | --- | --- | --- |
| **Evidence** | Content edges (contains, links, mentions, from) and the journal (changes, traces) | Nobody writes it on purpose: it comes from content and capture | Checkable and rebuildable |
| **Working** | Each agent's scratch for this session and the threads left open | The agent, freely (B's `cortex_working`) | Never shown as knowledge |
| **Inference** | Memories, skills, identity facts, and any claim relating blocks | The agent through notes and settlement; the person directly | Must cite evidence |

Evidence on every note and memory becomes a list of pointers: `{ node, version }`, `{ trace }` or `{ session }`.

- **Stated** (the person said it): cites the trace of the prompt where they said it. Becomes memory at once.
- **Inferred about the person:** two or more sessions, as now.
- **Inferred about knowledge**, such as "slowness ties the essays to the photos": two or more distinct blocks, each pinned to a version.
- **A skill:** three sessions where the same method was used, cited by session.
- **An identity fact:** the quote, through its trace.

**Freshness:** when a `change` lands on a node a memory pins, that memory is stale. `cortex_start` lists stale memories so the agent re-reads the evidence and either confirms (a new version citing new versions) or rewrites.

**Dead ends:** a `decision` that rejected something, or an `attempt` that failed, is surfaced at session start and when an agent touches the same node. A rejected pair is never proposed again unless the evidence changed since.

### 5. Fewer tools

| Keep | Change | Remove or fold in |
| --- | --- | --- |
| `cortex_start` (adds stale, rejections, attempts) | `cortex_note` takes `evidence` | `cortex_propose_identity`, `cortex_propose_skill`, `cortex_propose_tool`, `brain_connect` → one **`cortex_propose`** with `kind` |
| `cortex_working`, `cortex_distill` | `cortex_settle` checks evidence rules per kind | `brain_trace` (capture is automatic) |
| `cortex_recall`, `cortex_remember` (stated only), `cortex_forget` | `cortex_describe_section` becomes describing a channel | `brain_settle` (decisions on proposals go through `cortex_settle`) |
| `cortex_file_advice`, `cortex_skill` | | The MVP's turn requests |
| New: `cortex_history` (node, since, actor), `cortex_as_of` (stamp or date), `cortex_stamp` | | |

That is about twelve tools instead of eighteen, with one write path for every inference.

### 6. How each cortex layer joins the graph

| Node | Points at | Edge (inference) | Its evidence |
| --- | --- | --- | --- |
| Memory about knowledge | Blocks, channels, entities | `grounds` | Two or more pinned nodes |
| Memory about the person | Sessions, blocks they wrote | `grounds` | Two or more sessions, or a stated quote |
| Note | What it observed | `observes` | One session or trace |
| Skill | Channels and blocks it was used on | `learned` | Three or more sessions |
| Tool | What it reads and writes | `acts` | Its declaration (person-approved) |
| Identity fact | You | `about` | A quote |
| Session | What it changed and read | Shown from the journal, not stored as edges | The journal |

This is what the ohm-ux graph now draws: grey evidence edges, green cortex edges.

## Order

1. **Remove the MVP cortex** from ohm-content-layer, once the vault editor no longer reads it.
2. **Journal in B:** write `session`, `note` and `decision` lines; read the old `notes.jsonl` and `sessions.jsonl` for compatibility.
3. **`change` lines** from every store write, with actor; history views (`cortex_history`, `cortex_as_of`, `cortex_stamp`).
4. **Evidence on notes and memories**, settlement rules per kind, staleness.
5. **`PostToolUse` traces** and MCP-side traces; dead ends at session start.
6. **One `cortex_propose`**; remove the separate proposal tools.
7. **Brain folder layout**: the cortex inside `~/Brain`; the vault contract reads blocks and channels.
8. **ohm-ux graph and timeline** read the journal.
9. **Sync to ohm**, optional: copy the journal and files.

## To decide

- **One folder** (`~/Brain` with `cortex/` inside) or two (B's `~/cortex` beside the brain)? Proposed: one.
- **What `PostToolUse` keeps** from a tool call: proposed node IDs, versions and queries, never outputs.
- **Where traces may go:** proposed local-only by default, synced to ohm only if you turn it on.

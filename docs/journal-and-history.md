# Cortex and history: one path

Written 19 November 2026 as a proposal, and changed the same day as the owner decided its details. It joins what were separate: the cortex, version history, and what agents did. It goes with the personal brain plan for ohm-content-layer, which is not published yet. Steps 2 and 3 of the order below are built in ohm-cortex, with evidence from step 4, every edit going through the person, and sessions with dead ends; see "Built" at the end. [The guide](guide.md) explains the result for people and agents.

One thing here differs from an earlier decision in [plan.md](plan.md), and is now decided:

- **plan.md said memory needs no review.** Now every edit goes through the person: an agent proposes, and nothing in the folder changes until the person accepts. Working memory is the one exception, kept open in plan.md.

Two earlier decisions still hold:

- **When something becomes a memory is judgement in the playbook, not a count in code.** The evidence counts below are playbook guidance; code checks only that cited evidence is well formed and exists.
- **Cortex is not synced with ohm.** Sync below stays optional and off unless chosen.

## What existed

There were two cortexes. **ohm-cortex (B) is the cortex.** The one in ohm-content-layer (A) was the first MVP and will not be used; it is listed only so nothing in it is mistaken for current.

| | A · ohm-content-layer cortex | B · ohm-cortex (this repository) |
| --- | --- | --- |
| Where it keeps things | D1 tables on the vault service (`cortex_*` in `service/schema.sql`) | A folder of Markdown the person can open |
| Built | Memories with versions and history, context, notes and settlement (server checks two-session evidence), skills with approval, proposed tools | Identity with proposals, `vault.md`, memories, **working memory per agent**, **distill**, notes and settlement, skill and tool proposals, filing advice, `.cortex/history/`, MCP over stdio and HTTP, **hooks for Claude Code and Codex** |
| Turns | Tables and requests reserved, not built | Not taken; replaced by working memory and distill |
| Hooks | Designed in `plans/build-plan.md`, not built here | Built: `session-start`, `prompt` (empty), `stop` (asks to distill once per change), `session-end`. Not yet tried in a real session |
| Status | B's plan says B replaces A's design, and that B does not sync with ohm | 97 tests, CI on Node 20 and 22 |

### Overlaps and gaps it found

1. **The same rules were written twice,** in A and B, and had diverged.
2. **There were too many ways to write memory.** B alone had nine, each writing the folder on its own.
3. **There were five half-logs:** `.cortex/notes.jsonl`, `.cortex/sessions.jsonl`, `.cortex/history/`, A's version and turn tables, and the vault's `seq`. None recorded who changed what, or what was tried and dropped.
4. **Evidence meant sessions, not things.** Nothing tied a memory to the blocks it was drawn from.

## The design

### 1. One cortex: ohm-cortex

Decided: ohm-cortex is the cortex, folder-first and standalone. The ohm-content-layer cortex was the MVP and is retired. Rules live in one place, ohm-cortex's `src/core.mjs`.

The brain folder would hold the cortex inside it (step 7, not built; B keeps `.cortex/` for now):

```
~/Brain/
  blocks/  channels/  entities/  sources/  connections.jsonl     # content (the personal brain plan)
  cortex/  identity.md  vault.md  memory/  skills/  tools/  agents/  # B's layout, unchanged
  .brain/
    journal.jsonl     # the one log (below)
    history/          # every earlier version of every file, by version hash (B's .cortex/history/)
    index.sqlite      # derived and rebuildable
    working/<agent>.md
```

B's principle still holds: the cortex holds no content. It points at blocks by ID and version, and never copies them.

### 2. Cortex files are nodes

Every file of the cortex is a node in the journal, like a block: changes to it are recorded, and it has history, as-of, save, restore and revert. One naming:

| Node | File |
| --- | --- |
| `identity` | `identity.md` |
| `playbook` | `agents/AGENTS.md` (only the person changes it) |
| `memory/<name>` | `memory/<name>.md` |
| `working/<agent>` | `.cortex/working/<agent>.md` |
| `skill/<name>` | `skills/<name>/`, SKILL.md and the files beside it |
| `tool/<name>` | `tools/<name>.md` |
| `channel/<path>` | What `vault.md` says a channel means and how blocks there are filed |

`memory/MEMORY.md` and the headings and counts in `vault.md` follow other things and are rebuilt, so they are not nodes.

### 3. One log: the journal

One append-only file replaces `notes.jsonl`, `sessions.jsonl` and turns. Each line has `seq`, a unique `id`, `at`, `actor` (`{kind: human|agent, name}`), `session` when there is one, and `type`:

| `type` | Written by | Holds | Was |
| --- | --- | --- | --- |
| `proposal` | An agent | One edit, whole: node, op, the version it applies to, the content after, reason, evidence | Four separate proposal paths, and agents writing directly |
| `decision` | The person, or settlement | A proposal accepted or rejected, by whom and why; or what became of a note | Settled lines, identity rejects |
| `change` | The person's edit, or an accepted proposal | Node, op, `before` and `after` versions, reason; for an agent's, the proposal and decision | Nothing (only `history/`) |
| `note` | An agent, or a host | One observation, with `evidence`. It changes no file, so it needs no acceptance | `notes.jsonl` |
| `session` | An agent, when a task is done or given up | One line of what was done, the proposals and changes it made, and dead ends | `sessions.jsonl`, now only the hooks' checkpoints |
| `save` | The person or an agent | A name and a note at this `seq`. It changes nothing | Nothing |

- **History is the journal plus `history/`.** "As of a date" means replaying to that day. A save is a line. Restore and revert write a new change; nothing is rewritten.
- **It merges cleanly.** Lines are append-only with IDs, so two machines join by union. That makes sync to ohm, or to Git, a copy, not a merge.
- **Privacy.** The journal stays private, like the rest of the cortex.

### 4. Every edit goes through the person

An agent never writes the folder. Each edit it makes is a `proposal` line holding the whole change. The person reads it and accepts or rejects it; that is a `decision` line. Only an accepted proposal makes a `change` line, and its actor is the agent that proposed it. A proposal whose `before` is no longer the node's version is stale: it cannot be accepted until the agent proposes it again. The person's own edits, from the command line, are changes at once.

Working memory is the exception. Each agent rewrites its own all session, and the stop hook asks for a distill when it changed; if each rewrite waited for the person, the hooks could not follow it. It is still a change line, and an agent never writes another's.

### 5. Capture: hooks, and the agent's own record

| Moment | Hook | Does |
| --- | --- | --- |
| Session start | `SessionStart` | Playbook, identity, always memories, working memory, and the open dead ends near this folder |
| Before a prompt | `UserPromptSubmit` | Nothing yet. Later: memories fitted to the prompt |
| End of a turn | `Stop` | Asks to distill once per change of working memory |
| Session end | `SessionEnd` | Records nothing |

The hooks keep their checkpoints (start, ask, distill) in `.cortex/hooks.jsonl`, this machine's bookkeeping, not history. Nothing is captured on the agent's behalf. When it finishes a task, or gives it up, the agent writes a `session` line with `cortex_session`, like a commit message: what was done, the IDs of the proposals and changes it made, and dead ends, each with what was tried, why it was dropped, and a command that would show whether it still holds. A later session can mark a dead end resolved. Open dead ends are listed by `cortex_start`, and the session-start hook shows those near the folder it starts in. This is how [ANVC](https://github.com/yodering/anvc) keeps what was tried.

### 6. One way to write memory: three levels

| Level | What | Written by | Rule |
| --- | --- | --- | --- |
| **Evidence** | Content edges (contains, links, mentions, from) and the journal (changes, sessions) | The person, through content; nobody writes it for them | Checkable and rebuildable |
| **Working** | Each agent's scratch for this session and the threads left open | The agent, at once (`cortex_working`) | Never shown as knowledge |
| **Inference** | Memories, skills, identity facts, and any claim relating blocks | The agent proposes through notes and settlement; the person accepts | Must cite evidence |

Evidence on every note and memory is a list of pointers: `{ node, version }` or `{ session }`.

- **Stated** (the person said it): the session where they said it. Becomes a memory at once, once accepted.
- **Inferred about the person:** two or more sessions.
- **Inferred about knowledge**, such as "slowness ties the essays to the photos": two or more distinct blocks, each pinned to a version.
- **A skill:** three sessions where the same method was used, cited by session.
- **An identity fact:** the person's words, or the block and passage that state it.

**Freshness (not built):** when a `change` lands on a node a memory pins, that memory is stale. `cortex_start` would list stale memories so the agent re-reads the evidence and proposes a confirmation or a rewrite.

**Dead ends:** what a session recorded as tried and dropped, and a rejected proposal, are what an agent should not try again unless something changed.

### 7. Tools

| Keep | Change | New |
| --- | --- | --- |
| `cortex_start` (adds what waits for the person, and dead ends) | `cortex_remember`, `cortex_forget`, `cortex_settle`, `cortex_describe_channel` (was `cortex_describe_section`), `cortex_propose_skill`, `cortex_propose_tool` now propose | `cortex_history`, `cortex_as_of`, `cortex_save` |
| `cortex_working`, `cortex_distill` | `cortex_note` and memories take `evidence` | `cortex_restore`, `cortex_revert` (proposals from an agent) |
| `cortex_recall`, `cortex_skill`, `cortex_file_advice`, `cortex_propose_identity` | | `cortex_session` |

Accepting and rejecting are the person's, from the command line: `cortex proposals`, `cortex accept`, `cortex reject`. No MCP tool does it, because no MCP client is known to be the person. One `cortex_propose` with `kind` (step 6) is still to do.

### 8. How each cortex layer joins the graph

| Node | Points at | Edge (inference) | Its evidence |
| --- | --- | --- | --- |
| Memory about knowledge | Blocks, channels, entities | `grounds` | Two or more pinned nodes |
| Memory about the person | Sessions, blocks they wrote | `grounds` | Two or more sessions, or a stated quote |
| Note | What it observed | `observes` | One session, or a node at a version |
| Skill | Channels and blocks it was used on | `learned` | Three or more sessions |
| Tool | What it reads and writes | `acts` | Its declaration (person-approved) |
| Identity fact | You | `about` | A quote |
| Session | What it proposed and changed | Shown from the journal, not stored as edges | The journal |

This is what the ohm-ux graph draws: grey evidence edges, green cortex edges.

## Order

1. **Remove the MVP cortex** from ohm-content-layer, once the vault editor no longer reads it.
2. **Journal in B:** `note` and `decision` lines; read the old `notes.jsonl` and `sessions.jsonl` for compatibility. *Built.*
3. **`change` lines** from every write, with actor; history views (`cortex_history`, `cortex_as_of`, `cortex_save`). *Built, with `cortex_restore` and `cortex_revert`, cortex files as nodes, proposals and decisions.*
4. **Evidence on notes and memories**, settlement rules per kind, staleness. *Evidence built; settlement rules per kind and staleness not.*
5. **Sessions and dead ends** from agents, shown at session start. *Built.*
6. **One `cortex_propose`**; remove the separate proposal tools.
7. **Brain folder layout**: the cortex inside `~/Brain`; the vault contract reads blocks and channels.
8. **ohm-ux graph and timeline** read the journal.
9. **Sync to ohm**, optional: copy the journal and files.

## To decide

- **One folder** (`~/Brain` with `cortex/` inside) or two (B's `~/cortex` beside the brain)? Proposed: one.
- **Whether working memory stays the one direct write.** See plan.md's open decisions.

## Built

On 19 November 2026, in ohm-cortex, on the branch `journal-and-vocabulary`. [plan.md](plan.md) has the details and the decisions made while building.

- **The journal** is `.cortex/journal.jsonl` with `proposal`, `decision`, `change`, `note`, `session` and `save` lines. Lines written as `stamp` before the rename read as saves. Identity proposals still live in `.cortex/identity.jsonl` too, and are mirrored as proposal lines; they are per field, so they are never stale.
- **Proposals:** every agent edit except its own working memory. The person accepts or rejects with `cortex accept` or `cortex reject` (`confirm` and `approve` still work); the change names the proposal and decision.
- **History views:** `cortex_history`, `cortex_as_of`, `cortex_save`, `cortex_restore` and `cortex_revert`, and the commands `history`, `as-of`, `save`, `restore` and `revert`.
- **Sessions:** `cortex_session`; dead ends in `cortex_start` and at session start near the folder.
- **Evidence** on notes, distilled notes and memories, checked for shape and existence; the counts in §6 are playbook guidance.
- **Words:** blocks and channels, and `cortex_describe_channel`.

Not built, for later: staleness and settlement rules per kind from step 4; one `cortex_propose` (step 6); the `~/Brain` layout (step 7); the ohm-ux timeline reading the journal (step 8); sync (step 9).

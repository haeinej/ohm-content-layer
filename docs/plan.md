# Rebuilding cortex

A plan for the cortex as separate software, decided in conversation on 14 November 2026. It replaces the cortex design in ohm-content-layer's `plans/build-plan.md` where the two disagree.

## What cortex is

A person has two things, kept apart.

- **The vault** is what they made: their posts, notes and sources. It is the source of truth. Only the person decides what goes into it.
- **The cortex** is how an agent reads and edits that vault for them: who they are, how they like to work, where things are, and how they want things filed. It changes as the agent learns. It holds no content of its own.

If the vault is lost, their work is gone. If the cortex is lost, the agent has to learn them again, and nothing they made is gone.

## Principles

1. **The vault is canonical.** Cortex never holds a fact that belongs in the vault. A memory may point at a post by its ID. It never copies what the post says.
2. **The person controls content.** Something enters the vault only when the person hands it over. The agent files it as given, proposes where it goes, and indexes it. It never writes a post or a fact on its own initiative, and it edits a post only when asked.
3. **The folder is the cortex.** A cortex is a folder of Markdown files the person can open, read and edit. Hand edits are what the agent gets next. There is no hidden second copy. A host such as ohm is a place it syncs to, not the original.
4. **Identity is the root, and it is strict.** Everything in a cortex is about one identity. Identity facts are few, typed, rarely change, and are never guessed.
5. **Memory needs no review; identity, skills and tools do.** The agent writes what it learns about how the person works without asking. It cannot set an identity fact, approve its own skill, or give itself a tool.
6. **What the person said outranks what the agent worked out.** Every memory says which it is.
7. **Nothing is lost.** Every replaced or removed file is kept and can be restored.
8. **Private.** A cortex is for one person. Nothing in it is published, used for matching, or sent to another service. Secrets have one place and never leave the machine.
9. **Standalone.** Cortex runs without ohm, a particular vault, or a particular agent. It depends on a small vault contract, and any vault can provide it.

## The folder

```
cortex/
├── agents/
│   ├── AGENTS.md         the rulebook: how an agent keeps this cortex and files into the vault
│   └── secrets/          the person's keys and tokens. Never read into anything, never committed
├── identity.md           who this is: strict fields, confirmed by the person
├── vault.md              how to read the vault: each section, what it means, what goes where
├── memory/               how they work, and where things are. One thing per file
│   └── MEMORY.md         generated index, one line per memory
├── skills/               how they like a kind of source filed or a task done. <name>/SKILL.md
├── tools/                what the agent may use. One file per tool, on or off
├── .cortex/              machinery the person does not need to look at
│   ├── working/          working memory, one file per agent: this session, and what was left open
│   ├── notes.jsonl       observations waiting to be settled, and vault events
│   ├── proposed/         identity facts, skills and tools waiting for the person
│   └── history/          every earlier version of every file
├── .gitignore            policy: secrets and temporary files never leave the machine
└── .gitattributes        policy: same line endings everywhere; generated and append-only files merge cleanly
```

For someone non-technical it is: who I am, how my vault is laid out, what my agent has learned, what it knows how to do, and what it may use.

## Who may change what

| Part | The agent may | Only the person may | Read |
| --- | --- | --- | --- |
| `agents/AGENTS.md` | Nothing | Add their own rules at the end | Every session |
| `agents/secrets/` | Nothing, and never read a value into anything | Put a secret there | When a tool needs it, by file name |
| `identity.md` | Propose a field, with evidence | Confirm, correct or clear a field | Every session, in full |
| `vault.md` | Keep the structure, counts and pointers in step with the vault; write and rewrite a section's meaning | Edit anything in it; what they write outranks the agent's | Every session |
| `memory/` | Write, rewrite and remove freely | Edit or remove anything | Index every session; a memory when it fits |
| `.cortex/working/<agent>.md` | Write its own freely; read the others' | Edit or clear any of them | Every session |
| `skills/` | Propose | Approve | Descriptions every session; a skill when it fits |
| `tools/` | Ask for one to be built | Add one, switch one on or off | The list every session |
| `.gitignore`, `.gitattributes` | Nothing | Change the policy | Never by the agent |

## Identity

Identity is the small set of facts about a person or organisation that rarely change. It is structured, typed and held to harder rules than memory.

### Fields

| Field | Type | Example | Notes |
| --- | --- | --- | --- |
| `kind` | `person` or `organization` | `person` | Required before most other fields mean anything |
| `account` | DID or handle | `did:plc:…` | Authoritative when it comes from the signed-in account |
| `name` | Text | `Alex Kim` | Legal or full name, as they give it |
| `preferredName` | Text | `Alex` | What to call them |
| `pronouns` | Text | `they/them` | Only ever stated. Never inferred from a name or writing |
| `emails` | List of addresses, each with a label | `work: alex@example.com` | Validated as addresses |
| `websites` | List of URLs | `https://example.com` | |
| `city` | Text | `Seoul` | Where they are based |
| `timezone` | IANA zone | `Asia/Seoul` | |
| `languages` | List, first is preferred | `ko, en` | |
| `birthdate` | ISO date, or month and day only | `1994-05-02` | Most sensitive field. Never proposed from the vault unless the source states it outright |
| `occupation` | Text | `Product designer` | What they do |
| `organization` | Text | `Example Studio` | Where they do it |
| `position` | Text | `Founder` | Their role there |

An organisation uses the same file with the fields that apply (`name`, `emails`, `websites`, `city`, `timezone`) plus `about`. Fields are fixed: an agent cannot add a new one. A person can add their own below the fixed ones, and the agent treats those as read-only.

### How it is written

`identity.md` holds only confirmed values, as properties at the top, followed by a short `about` in the person's own voice:

```
---
kind: person
preferredName: Alex
pronouns: they/them
city: Seoul
timezone: Asia/Seoul
languages: [ko, en]
occupation: Product designer
---
Designs tools for independent writers. Writes plainly, in short sentences.
```

Behind each value, `.cortex/identity.jsonl` records where it came from: the person stated it, it came from the account, or it was confirmed from a vault post (with the post ID and the passage). It also records when it was confirmed and what it replaced.

### Policies

1. **No field is set without the person.** The agent proposes; the person confirms. The one exception is `account`, which comes from the signed-in account itself.
2. **A proposal needs evidence from the vault or the person's own words.** It names the post ID and quotes the passage that states the fact. A fact the agent worked out (a city from a photo caption's date, a job from writing style) is not evidence.
3. **Never guess.** Pronouns are never inferred from a name. Kind is never inferred from writing style. A field with no evidence stays empty, and empty is a valid answer.
4. **Values are checked.** Emails must be addresses, timezones real zones, dates real dates. A value that fails is refused.
5. **A confirmed field is not overwritten by a proposal.** If the vault later says something different, the new value is proposed beside the old one, and the confirmed one stands until the person chooses.
6. **Sensitive fields stay in.** Email addresses, birthdate and city are never sent to another service, put in a URL, or included in anything published. **Birthdate is hidden from agents altogether:** no tool or resource returns it, and an agent is told only that one is on file. A task that needs it asks the person. The rest are shown to the agent so it can help, not so it can share.
7. **Every change is kept.** An earlier value can be read back and restored.
8. **Proposals do not nag.** A value the person turned down is not proposed again for that field, whatever the evidence. The person can still set it themselves. Two proposals of the same value are one.
9. **An agent never writes as the person.** The names `member` and `account` are reserved; an agent that connects under one is recorded as `agent:<name>`.

## How the vault is read: `vault.md`

`vault.md` is the agent's index of the vault, so a new session knows where things are without reading everything.

- **Structure and counts** come from the vault: each section and subsection, how many posts, what is recent. Cortex keeps these in step with vault events, without asking, because they are derived, not content.
- **Meanings** say what each section is for and what goes in it. The agent writes and rewrites them without asking, from what it sees in the vault and what the person says. The person can edit any of it, and what they write outranks what the agent wrote.
- **Filing conventions** per section: how titles are written, what properties a post there carries, what it usually links to.

Pointers to specific posts live in `reference` memories, by post ID.

## Memory

### Long-term memory: `memory/`

One thing learned per file, with a one-line description. Kinds:

| Kind | Holds | Example |
| --- | --- | --- |
| `preference` | How they want work done | Wants a short first draft before polished prose |
| `reference` | Where something is in the vault, by post ID | The pricing decisions are in post `3m…` |
| `person` | Soft facts about them that are not identity fields and are not vault content | Is learning to write in English |

The `project` kind is dropped: facts about a project are vault content.

Rules carried over from the current implementation:
- A memory is `stated` (the person said it) or inferred.
- A rewrite names the version it replaces.
- Every rewrite keeps what it replaced.
- `always` puts a memory in full into every session.
- `seen` counts how often a memory was confirmed.

### Working memory: `.cortex/working/`

What an agent is noticing in this session, and what was left open last time. Each agent keeps its own file, named for it (`claude-code.md`, `codex.md`), so two agents working at once never write over each other.

| | Long-term memory | Working memory |
| --- | --- | --- |
| Holds | How they work, across sessions | How they are working today, and open threads |
| Example | Wants a short first draft first | Answering in Korean today, one-line replies. Filing three meeting notes, two done |
| Written | When stated, or seen in more than one session | Freely, all session, by the agent it belongs to |
| Life | Until corrected | Refreshed every session |

The cycle:

1. **Session start: before, then refresh.** The agent reads its own working memory and every other agent's beside long-term memory and the vault index, then rewrites its own for today. It keeps open threads, takes up any another agent left, and drops what was only about that day.
2. **During the session.** The agent updates its own working memory as it works. A correction goes there at once. Anything the person states outright also goes straight to long-term memory.
3. **Session end: distill and merge.** The agent reads every agent's working memory together. What more than one of them saw, or one saw across sessions, becomes a note, and a memory at the next settle. What is left stays in its own file as "last time".

When something has been seen enough to become a memory is judgement, written in the playbook, not a count kept in code. Style is learned in three steps: noticed today, seen again, remembered.

## Filing into the vault

The agent helps put the person's sources into the vault and keeps the index. It does not author.

1. The person hands something over: pastes it, uploads it, says "save this", or connects a folder.
2. The agent reads `vault.md` and any skill for that kind of source.
3. It proposes a place under the person's own section names, a title in their style, and links to related posts. It asks once.
4. On their yes, it saves through the vault's API, leaving their words as given.
5. The vault reports the new post. Cortex updates `vault.md` and any pointers.
6. Anything the agent learned about how they file (they shortened its title again) goes into working memory.

Publishing is a separate step owned by the vault, and needs its own approval.

## In, cortex, out

What each part can do, in plain words. Tool names are given where they exist.

### In

**From the person**
- **Tell it something about themselves.** Saved at once, marked as theirs. `cortex_remember`
- **Correct it.** The memory is rewritten; the old version kept. `cortex_remember`
- **Have it forget.** They see exactly what goes, then it goes. `cortex_forget`
- **Confirm who they are.** Accept, correct or clear an identity field. *New*
- **Approve a skill.** A procedure the agent proposed becomes usable. `cortex approve`
- **Switch a tool on or off.** By editing its file. *A command is new*
- **Edit anything by hand.** The agent gets it next session.

**From the agent**
- **Note what it noticed.** One line, changes nothing yet. `cortex_note`
- **Update working memory.** What is happening this session. *New*
- **Propose an identity fact,** with the post and passage that state it. *New*
- **Propose a skill,** or ask for a tool. `cortex_propose_skill`, `cortex_propose_tool`

**From the vault**
- **Report a change.** A post saved, moved or removed; a section added or renamed. `cortex event` today; *structured events are new*
- **Report its shape.** Sections and counts. *New*

**From the agent's harness, through hooks**
- **A session started, a session ended.** Triggers refresh and distill without the model having to remember. *New*

### Cortex

- **Settle** observations into memories, keeping what was stated above what was inferred. *Built*
- **Refresh and distill working memory.** *New*
- **Keep `vault.md` in step** with the vault's structure. *New*
- **Check its pointers** to posts that moved or were removed. *New*
- **Keep history** of every file. *Built for memory and identity*

### Out

**To the agent**
- **Brief me.** Identity, how to read the vault, how they work, working memory from last time, approved skills, tools switched on, and anything waiting. `cortex_start`; *working memory and vault map are new*
- **What do I know about this?** The memories that fit. `cortex_recall`
- **How should I file this?** The likely section, their conventions for it, the skill for this kind of source, and related posts. The agent proposes this to the person. *New, read from `vault.md` and skills*
- **How do they like this done?** One skill in full. `cortex_skill`

**To the person**
- **Show me what you know about me.** Every file, who wrote it, where it came from, earlier versions.
- **Is anything off?** Observations waiting, identity proposals, skills waiting, broken pointers, sections with no meaning. `cortex status`, *new*

**To the vault**
- **Nothing directly.** Filing goes through the vault's API on the person's say-so.

## How an agent reaches cortex

Cortex does not run an agent. It is read by one: ChatGPT, Claude, a coding agent, or anything else that speaks MCP. Those clients do not open the folder, so everything an agent must know is served to it over MCP.

- **The instructions send an agent to `cortex_start`.** When a client connects, the server answers with one self-contained paragraph, under 512 characters, because clients read the start of it first: what this server is, call `cortex_start` first and follow the playbook it returns, never guess identity, and keep it private. Codex and Claude Code read these instructions; ChatGPT's handling is not documented.
- **The playbook comes back from `cortex_start`.** Tools are the one MCP feature every client supports, so the cortex's own `agents/AGENTS.md`, the person's added rules included, is returned by that call and read from disk each time.
- **A prompt for the person.** `start` appears where a client shows prompts, such as a slash command in Claude Code, for when the person wants to begin from their cortex explicitly.
- **Hooks are the only way that does not depend on the model.** In Claude Code and Codex the adapter (step 7) puts the playbook in front of the model at session start, whether or not it calls a tool. Nothing in MCP itself does that. Rules guide the agent; what it cannot do is enforced by the tools.
- **The files are resources.** The playbook, identity, `vault.md`, the memory index and each memory, approved skills, and the tool list can be read as `cortex://` resources. Secrets, birthdate, proposals and history are never served.
- **The tools change things.** Everything that writes goes through a tool, so the limits are enforced in code.
- **Two ways to connect.** Over standard input and output, for agents on the person's machine (`cortex mcp`). Over HTTP, for clients that connect to a remote server, such as ChatGPT and Claude in the browser. The HTTP transport is not built yet, and needs a way to sign in.

## What cortex needs from a vault

A small contract, so any vault can sit beside a cortex: ohm's service, an Obsidian folder, or another host.

| Operation | What it answers |
| --- | --- |
| Shape | The sections and subsections, with counts and recent posts |
| Read | One post by its ID |
| Exists | For a list of post IDs, whether each still exists, and where it is now, in one call |
| Changes since | What was saved, moved or removed since a point |
| Profile | Identity facts the vault itself holds, such as its account and published profile, each with where it came from |

Cortex reads through this contract and never writes. Saving goes through the vault's own API, called by the agent.

Built in `src/vault.mjs`, with a folder vault that answers it: a folder of Markdown files, `<label>/<post>.md` or `<label>/<sublabel>/<post>.md`, each post known by its `id` property (or its path, when it has none). `changes` takes a cursor the vault gave earlier and cortex keeps in `.cortex/vault-cursor.json` without looking inside. `profile` answers nothing yet for a folder. The person connects one with `cortex vault connect <folder>`, which writes `.cortex/vault.json`; other kinds, such as ohm's, are passed in by their host.

Each time the cortex is opened (`cortex_start`, or `cortex vault sync`), cortex:
- rewrites the counts in `vault.md`, keeping every word written about a section, the person's own lines and any intro above the first section;
- notes what an agent has to act on: a section `vault.md` does not describe yet, a section that left the vault, and a post a memory points at that moved or was removed;
- reports memories pointing at posts that are no longer there.

A post saved in a known section needs nothing and is not noted. With a vault connected, identity evidence from the vault must name a post that exists and quote a passage it contains.

## Rules enforced in code

1. Nothing in `agents/` or the git policy files is written by any cortex tool.
2. No tool writes inside `agents/secrets/`, and no tool returns a value from it.
3. An identity field changes only through the person's confirmation; proposals need a post ID and a passage.
4. Identity values are validated by type.
5. `memory/MEMORY.md` is generated, never written by hand or by a tool.
6. A save names the version it replaces; a stale version is refused.
7. Every replaced or removed file is kept in `.cortex/history/`.
8. A skill an agent wrote is not used until approved; an agent cannot add a tool or switch one on.
9. Every save records who made it: the person, or which agent.
10. No cortex operation writes to the vault.

## What exists now, and what changes

Built in the `ohm-cortex` repository and tested (49 tests). Steps 1 and 2 are built:

| Built | Keeps | Changes |
| --- | --- | --- |
| `cortex status [dir] [--json]`: proposals, observations, broken pointers, undescribed or gone sections, problems and working memory over 30 days old; each item says how to clear it | All | Done (step 5). Uses a read-only folder inspection, without syncing or generating files |
| The folder store (`src/folder.mjs`) | Memories, history, notes, skill proposals, tool proposals, identity, the vault | |
| The vault contract (`src/vault.mjs`), a folder vault, and `vault.md` (`src/vaultmap.mjs`): counts kept in step, meanings and conventions written by the agent with `cortex_describe_section`, the person's words outranking them, notes for what moved or left, broken pointers reported, `posts` on memories, `cortex vault connect` and `cortex vault sync` | All | Done (step 2). Only the folder kind is built; ohm's comes with sync |
| Strict identity (`src/identity.mjs`): fixed typed fields, proposals with evidence in `.cortex/identity.jsonl`, `cortex confirm`, `reject`, `clear` and `identity`, `init --account` | History of changes | Done (step 1). With a vault connected, vault evidence is checked against the post |
| Memory kinds `person`, `preference`, `project`, `reference` | Rules for names, descriptions, versions | Drop `project` |
| Ten MCP tools, with `cortex_propose_identity` in place of `cortex_identity`; short instructions that send an agent to `cortex_start`, which returns the playbook; a `start` prompt; the files as `cortex://` resources; birthdate hidden from agents | All | Add working memory and filing advice; serve over HTTP |
| Working memory: one file per agent in `.cortex/working/`, `cortex_working` to rewrite your own, `cortex_distill` to record what was seen again and leave what is open, given in `cortex_start` and as `cortex://working/<agent>` resources; when something becomes a memory is in the playbook | All | Done (step 3). The working memory a distill replaces, or a clear removes, is kept; rewrites during a session are not |
| Commands `init`, `mcp`, `identity`, `confirm`, `reject`, `clear`, `approve`, `event` | All | `event` takes structured vault events; add `status` |
| The rulebook in `agents/AGENTS.md`, with the identity policy | Secrets, git and identity sections | Rewrite around filing and working memory |
| Git policy files, with `.cortex/identity.jsonl` as append-only | Both | |

## Build order

1. **Identity.** *Done.* Fixed fields, validation, `.cortex/identity.jsonl`, proposals with evidence, `cortex confirm`. Done when a proposal without a post and passage is refused, a confirmed field is not overwritten by a proposal, and pronouns cannot be proposed from anything but the person's own words.
2. **Vault contract and `vault.md`.** *Done.* The contract as an interface, a folder vault that implements it for tests, structured events, and `vault.md` kept in step. Done when removing a post in the test vault flags the memory that pointed at it.
3. **Working memory.** *Done.* One file per agent, a tool to update its own, refresh at start and distill and merge at end, with the rules for when something becomes a memory in the playbook. Callable without hooks. Done when something noticed in two sessions becomes a memory in the third, with nobody asked.
4. **Filing rules and advice.** The rulebook rewritten, a filing skill template, and a "how should I file this" answer built from `vault.md` and skills. Done when the answer for a source names a section, its conventions and related posts, and nothing is written to the vault.
5. **`cortex status`.** *Done.* Everything waiting or broken, in one answer. Every item it lists has a way to clear it.
6. **Remote MCP over HTTP,** with sign-in, so ChatGPT and browser clients can reach a cortex. Done when a client connected over HTTP reads the playbook as its instructions and calls `cortex_start`.
7. **The hooks adapter.** `cortex hook <moment>` for Claude Code, then Codex, answering from the folder with no network wait. Done when, with neither model calling a tool, a session starts with working memory refreshed and ends with it distilled.
8. **Sync with a host.** The folder kept in step with ohm's service, folder first. Done when a cortex removed from the host is restored from the folder unchanged, and the other way round.

Steps 4 to 7 are split into briefs for parallel agents in [handoff/](handoff/README.md).

Steps 1 to 5 need only the cortex folder and a test vault. Step 6 needs a place to host the server and a sign-in. Step 7 needs Claude Code and Codex signed in to verify. Step 8 needs ohm.

Already done outside this order: short MCP instructions that send an agent to `cortex_start`, the playbook returned from it, a `start` prompt, and the cortex's files as resources, over standard input and output.

## Outside cortex

- **In ohm:** implement the vault contract over the vault service. Send vault events to a member's cortex. Hold a synced copy and show it in the editor.
- **An agent's own key,** issued by the host and limited to reading the vault and keeping the cortex, so no PDS password sits in a hook's settings.
- **The person's confirmation surface:** a command today, the ohm editor later, for identity proposals, skills and tools.
- **Removing the old cortex code** from ohm-content-layer once ohm syncs with this one.

## Decided

On 14 November 2026:

- **Working memory is one file per agent,** merged when it is distilled.
- **The agent writes `vault.md` meanings without the person.** The person can edit them, and their words outrank the agent's.
- **Birthdate is hidden from agents.** An agent knows one is on file, and asks the person when a task needs it.
- **When something becomes a memory is in the playbook,** as judgement, not a session count in code.
- **The playbook reaches agents over MCP,** because cortex does not run the agent and clients do not read its files: short instructions send the agent to `cortex_start`, which returns it. Hooks make it certain where a client has them.

## Open decisions

- **Whether a cortex can serve more than one identity,** such as a person and their company. The plan assumes one cortex per identity.
- **How a remote client signs in** to a cortex served over HTTP.

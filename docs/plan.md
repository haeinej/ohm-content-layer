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
│   ├── working.md        working memory: this session, and what was left open last time
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
| `vault.md` | Keep the structure, counts and pointers in step with the vault; draft a section's meaning | Confirm a section's meaning, in their words | Every session |
| `memory/` | Write, rewrite and remove freely | Edit or remove anything | Index every session; a memory when it fits |
| `.cortex/working.md` | Write freely | Edit or clear it | Every session |
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
6. **Sensitive fields stay in.** Email addresses, birthdate and city are never sent to another service, put in a URL, or included in anything published. They are shown to the agent so it can help, not so it can share.
7. **Every change is kept.** An earlier value can be read back and restored.
8. **Proposals do not nag.** A rejected proposal is not made again from the same evidence.

## How the vault is read: `vault.md`

`vault.md` is the agent's index of the vault, so a new session knows where things are without reading everything.

- **Structure and counts** come from the vault: each section and subsection, how many posts, what is recent. Cortex keeps these in step with vault events, without asking, because they are derived, not content.
- **Meanings** are the person's words: what each section is for and what goes in it. The agent may draft one; it stands once the person confirms or edits it.
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

### Working memory: `.cortex/working.md`

What the agent is noticing in this session, and what was left open last time.

| | Long-term memory | Working memory |
| --- | --- | --- |
| Holds | How they work, across sessions | How they are working today, and open threads |
| Example | Wants a short first draft first | Answering in Korean today, one-line replies. Filing three meeting notes, two done |
| Written | When stated, or seen in more than one session | Freely, all session |
| Life | Until corrected | Refreshed every session |

The cycle:

1. **Session start: before, then refresh.** The agent reads last session's working memory beside long-term memory and the vault index, then rewrites it for today. It keeps open threads and drops what was only about that day. Anything that looks like a habit becomes a note.
2. **During the session.** The agent updates working memory as it works. A correction goes there at once. Anything the person states outright also goes straight to long-term memory.
3. **Session end: distill.** What has now been seen in more than one session becomes a note, and a memory at the next settle. What is left stays as "last time" for the next refresh.

Style is learned in three steps: noticed today, seen again, remembered.

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

## What cortex needs from a vault

A small contract, so any vault can sit beside a cortex: ohm's service, an Obsidian folder, or another host.

| Operation | What it answers |
| --- | --- |
| Shape | The sections and subsections, with counts and recent posts |
| Read | One post by its ID |
| Exists | Whether a post ID still exists, and where it is now |
| Changes since | What was saved, moved or removed since a point |
| Profile | Identity facts the vault itself holds, such as its account and published profile, each with where it came from |

Cortex reads through this contract and never writes. Saving goes through the vault's own API, called by the agent.

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

Built in the `ohm-cortex` repository and tested (21 tests). Step 1, strict identity, is on the `identity` branch:

| Built | Keeps | Changes |
| --- | --- | --- |
| The folder store (`src/folder.mjs`) | Memories, history, notes, skill proposals, tool proposals | Add `vault.md`, working memory, identity fields and proposals |
| Strict identity (`src/identity.mjs`): fixed typed fields, proposals with evidence in `.cortex/identity.jsonl`, `cortex confirm`, `reject`, `clear` and `identity`, `init --account` | History of changes | Done (step 1). Vault evidence is checked for shape only until the vault contract exists |
| Memory kinds `person`, `preference`, `project`, `reference` | Rules for names, descriptions, versions | Drop `project` |
| Ten MCP tools, with `cortex_propose_identity` in place of `cortex_identity` | All | Add working memory and filing advice |
| Commands `init`, `mcp`, `identity`, `confirm`, `reject`, `clear`, `approve`, `event` | All | `event` takes structured vault events; add `status` |
| The rulebook in `agents/AGENTS.md`, with the identity policy | Secrets, git and identity sections | Rewrite around filing and working memory |
| Git policy files, with `.cortex/identity.jsonl` as append-only | Both | |

## Build order

1. **Identity.** *Done.* Fixed fields, validation, `.cortex/identity.jsonl`, proposals with evidence, `cortex confirm`. Done when a proposal without a post and passage is refused, a confirmed field is not overwritten by a proposal, and pronouns cannot be proposed from anything but the person's own words.
2. **Vault contract and `vault.md`.** The contract as an interface, a folder vault that implements it for tests, structured events, and `vault.md` kept in step. Done when removing a post in the test vault flags the memory that pointed at it.
3. **Working memory.** The file, a tool to update it, refresh at start and distill at end, callable without hooks. Done when something noticed in two sessions becomes a memory in the third, with nobody asked.
4. **Filing rules and advice.** The rulebook rewritten, a filing skill template, and a "how should I file this" answer built from `vault.md` and skills. Done when the answer for a source names a section, its conventions and related posts, and nothing is written to the vault.
5. **`cortex status`.** Everything waiting or broken, in one answer. Done when every item it lists has a way to clear it.
6. **The hooks adapter.** `cortex hook <moment>` for Claude Code, then Codex, answering from the folder with no network wait. Done when, with neither model calling a tool, a session starts with working memory refreshed and ends with it distilled.
7. **Sync with a host.** The folder kept in step with ohm's service, folder first. Done when a cortex removed from the host is restored from the folder unchanged, and the other way round.

Steps 1 to 5 need only the cortex folder and a test vault. Step 6 needs Claude Code and Codex signed in to verify. Step 7 needs ohm.

## Outside cortex

- **In ohm:** implement the vault contract over the vault service. Send vault events to a member's cortex. Hold a synced copy and show it in the editor.
- **An agent's own key,** issued by the host and limited to reading the vault and keeping the cortex, so no PDS password sits in a hook's settings.
- **The person's confirmation surface:** a command today, the ohm editor later, for identity proposals, skills and tools.
- **Removing the old cortex code** from ohm-content-layer once ohm syncs with this one.

## Open decisions

- **Where working memory lives** if two agents run at once: one shared file, or one per agent merged at distill.
- **Whether the agent may draft `vault.md` meanings** without the person, marked as drafts, or only ask.
- **Which identity fields are sensitive enough to hide from the agent's prompt** unless a task needs them. Birthdate is the obvious one.
- **How many sessions are enough** to turn an observation into a memory. Two is a guess.
- **Whether a cortex can serve more than one identity,** such as a person and their company. The plan assumes one cortex per identity.

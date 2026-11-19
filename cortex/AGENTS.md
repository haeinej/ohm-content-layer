# For coding agents working on ohm-cortex

This file is for agents changing this repository. The rulebook an agent follows when keeping someone's cortex is a different file: [template/agents/AGENTS.md](template/agents/AGENTS.md).

## What this is

Cortex is how an agent reads and edits a person's vault for them: who they are, how they work, where things are, how they want things filed. It is a folder of Markdown files the person can read. The vault is the source of truth; cortex holds no content of its own. Read [docs/plan.md](docs/plan.md) before changing anything. It is the specification, and its build order says what comes next.

## The rules

1. **Cortex does not run an agent; agents read it over MCP.** ChatGPT, Claude and coding agents never open the folder. The server's instructions are one paragraph under 512 characters that sends an agent to `cortex_start`; that call returns the playbook. Keep the instructions short, and put anything else an agent must know in the playbook.
2. **Folder first.** The files are the cortex. Do not add a database, a hidden second copy, or anything a person could not read by opening the folder.
3. **Cortex never writes to a vault.** It reads through the vault contract in the plan. Saving content is the vault's job.
4. **Standalone.** Do not import from ohm-vault or any host. A host's vault reaches cortex only through the vault contract (`src/vault.mjs`), as a module the person names. No runtime dependencies without a reason written in the commit message; today there are none.
5. **The agent's limits are enforced in code, not only in the rulebook.** No tool writes to `agents/`, `agents/secrets/` or the git policy files. No tool approves a skill, adds or enables a tool, or confirms an identity field.
6. **Agents edit directly; every change is marked with who made it; the person reverts.** Every write, by the person or an agent, is a `change` line naming its actor. Identity facts, skill approval and tools stay the person's, from the command line.
7. **Nothing is lost.** Every replaced or removed file goes to `.cortex/history/`, and every change is a line in `.cortex/journal.jsonl`, written only through `src/journal.mjs`.
8. **Private and synthetic.** Tests and examples use invented people. Never put a real person's details in this repository.

## Layout

```
src/core.mjs       memory rules, evidence, versions, the Markdown property format, the Refused error
src/journal.mjs    the journal: the one writer of .cortex/journal.jsonl, its line types, and actors
src/identity.mjs   identity fields, their types, and what counts as evidence
src/vault.mjs      the vault contract, and a folder vault that answers it
src/vaultmap.mjs   vault.md: reading and writing it without losing what anyone wrote
src/folder.mjs     the folder store: every operation on a cortex, nodes, history and sessions
src/tools.mjs      the MCP tools an agent is given, built only from folder operations, and the server's instructions
src/prompts.mjs    the prompts a person can pick, such as start
src/resources.mjs  what a client may read without a tool: the playbook, identity, vault.md, memories, skills, tools
src/protocol.mjs   MCP over standard input and output
bin/cortex.mjs     the command line: init, mcp, vault, identity, confirm, reject, approve, history, restore, revert, and more
template/          what a new cortex starts as
test/              node --test
docs/plan.md       the specification, build order and decisions
docs/guide.md      the words, evidence and history, explained for people and agents
```

## Working here

- Node 20 or newer. No install step.
- Run `npm test` after every change, and add a test for every rule you enforce. A test names the behaviour in plain words.
- Errors an agent may see are `Refused` with a code and a message that says what to do next.
- Keep the plan true: when you build a step, update its row in "What exists now" and mark it done in the build order.
- Work on a branch and open a pull request. Do not push to `main`. CI runs `npm test` on Node 20 and 22 for every pull request.
- If you were given a brief in [docs/handoff/](docs/handoff/), work only on it, and follow its rules for the files shared with other agents.

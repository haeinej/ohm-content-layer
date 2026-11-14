# For coding agents working on ohm-cortex

This file is for agents changing this repository. The rulebook an agent follows when keeping someone's cortex is a different file: [template/agents/AGENTS.md](template/agents/AGENTS.md).

## What this is

Cortex is how an agent reads and edits a person's vault for them: who they are, how they work, where things are, how they want things filed. It is a folder of Markdown files the person can read. The vault is the source of truth; cortex holds no content of its own. Read [docs/plan.md](docs/plan.md) before changing anything. It is the specification, and its build order says what comes next.

## The rules

1. **Folder first.** The files are the cortex. Do not add a database, a hidden second copy, or anything a person could not read by opening the folder.
2. **Cortex never writes to a vault.** It reads through the vault contract in the plan. Saving content is the vault's job.
3. **Standalone.** Do not import from ohm-content-layer or any host. No runtime dependencies without a reason written in the commit message; today there are none.
4. **The agent's limits are enforced in code, not only in the rulebook.** No tool writes to `agents/`, `agents/secrets/` or the git policy files. No tool approves a skill, adds or enables a tool, or confirms an identity field.
5. **Nothing is lost.** Every replaced or removed file goes to `.cortex/history/`.
6. **Private and synthetic.** Tests and examples use invented people. Never put a real person's details in this repository.

## Layout

```
src/core.mjs       memory rules, versions, the Markdown property format, the Refused error
src/folder.mjs     the folder store: every operation on a cortex
src/tools.mjs      the MCP tools an agent is given, built only from folder operations
src/protocol.mjs   MCP over standard input and output
bin/cortex.mjs     the command line: init, mcp, approve, event
template/          what a new cortex starts as
test/              node --test
docs/plan.md       the specification and build order
```

## Working here

- Node 20 or newer. No install step.
- Run `npm test` after every change, and add a test for every rule you enforce. A test names the behaviour in plain words.
- Errors an agent may see are `Refused` with a code and a message that says what to do next.
- Keep the plan true: when you build a step, update its row in "What exists now" and mark it done in the build order.
- Work on a branch and open a pull request. Do not push to `main`.

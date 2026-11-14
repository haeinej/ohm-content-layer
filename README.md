# ohm-cortex

What an agent knows about the person it works for, and what it can do for them, kept as a folder that person can read.

Cortex is separate software. It does not need ohm, a vault, or any one coding agent. A host such as ohm can store and sync a cortex, and any agent can keep one through the MCP server or the hooks adapter.

## A cortex

```
cortex/
├── agents/         AGENTS.md, the rulebook for keeping this cortex, and secrets/
├── identity.md     who this cortex belongs to, read in full every session
├── memory/         one thing learned per file, plus a generated MEMORY.md index
├── skills/         <name>/SKILL.md, in the form coding agents already read
└── tools/          the list of what the agent can do, each on or off
```

For the person, it is three folders: what my agent has learned, what it knows how to do, and what it is able to use. `agents/` says how it is kept, and `identity.md` says whose it is.

## The layers, and who may change each

| Layer | Where | Changed by | Read |
| --- | --- | --- | --- |
| Rulebook | `agents/AGENTS.md` | Cortex itself, plus the person's own additions | Every session |
| Secrets | `agents/secrets/` | The person only | Never by the agent. Never committed |
| Identity | `identity.md` | The person confirms; the agent only proposes, with evidence | Every session, in full |
| Memory | `memory/` | The agent, freely. The person, any time | Index every session, a memory when it fits |
| Skills | `skills/` | The agent proposes. The person approves | Descriptions every session, a skill when it fits |
| Tools | `tools/` | The person only. The agent may propose | The list every session |
| Machinery | `.cortex/` | Cortex itself | Never shown to the model directly |

`.cortex/` holds what the person does not need to think about: observations waiting to be settled, events from a host, turns waiting to be read, and earlier versions of every file.

A cortex also carries `.gitignore` and `.gitattributes`, so that one kept in git never commits a secret, keeps the same line endings everywhere, and joins two machines' notes without a conflict.

## Use it

```bash
node bin/cortex.mjs init ~/cortex
```

Then connect an agent to it over MCP, with this as the server's command:

```bash
node /path/to/cortex/bin/cortex.mjs mcp ~/cortex
```

| Command | Who runs it | What it does |
| --- | --- | --- |
| `cortex init [dir] [--account <did>]` | The person | Starts a cortex in an empty folder, optionally with the signed-in account |
| `cortex identity [dir]` | The person | Shows the confirmed identity and the facts an agent proposed |
| `cortex confirm <field or id> [dir]` | The person | Accepts a proposed identity fact |
| `cortex reject <field or id> [dir]` | The person | Turns one down; it is not proposed again from the same evidence |
| `cortex clear <field> [dir]` | The person | Removes an identity field |
| `cortex mcp [dir]` | An agent | Serves the ten `cortex_*` tools over standard input and output |
| `cortex approve <skill> [dir]` | The person | Moves a skill an agent proposed into `skills/` |
| `cortex event <text> [dir]` | A host | Records a change from outside, for the agent to settle |

The folder is the one named, or `CORTEX_DIR`, or `~/cortex`. Files a person edits by hand are what the agent is given next.

## This repository

```
template/   what every new cortex starts as
src/        the rules, the folder store, the MCP protocol and the tools
bin/        the command line
test/       run with npm test
```

## Status

Built: the folder store, strict identity, the ten tools and the commands above, tested against temporary folders. No real agent has been connected yet. See [docs/plan.md](docs/plan.md) for what comes next.

Not built: the hooks adapter for Claude Code and Codex, turns, syncing a cortex to a host, and switching tools on from anywhere but the file itself.

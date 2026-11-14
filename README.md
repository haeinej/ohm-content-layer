# cortex

What an agent knows about the person it works for, and what it can do for them, kept as a folder that person can read.

Cortex is separate software. It does not need ohm, a vault, or any one coding agent. A host such as ohm can store and sync a cortex, and any agent can keep one through the MCP server or the hooks adapter.

## A cortex

```
cortex/
├── AGENTS.md       the rulebook: how an agent keeps this cortex
├── identity.md     who this cortex belongs to, read in full every session
├── memory/         one thing learned per file, plus a generated MEMORY.md index
├── skills/         <name>/SKILL.md, in the form coding agents already read
└── tools/          the list of what the agent can do, each on or off
```

For the person, it is three folders: what my agent has learned, what it knows how to do, and what it is able to use. The two files above them say whose it is and how it is kept.

## The layers, and who may change each

| Layer | Where | Changed by | Read |
| --- | --- | --- | --- |
| Rulebook | `AGENTS.md` | Cortex itself, plus the person's own additions | Every session |
| Identity | `identity.md` | The person, or the agent with them | Every session, in full |
| Memory | `memory/` | The agent, freely. The person, any time | Index every session, a memory when it fits |
| Skills | `skills/` | The agent proposes. The person approves | Descriptions every session, a skill when it fits |
| Tools | `tools/` | The person only. The agent may propose | The list every session |
| Machinery | `.cortex/` | Cortex itself | Never shown to the model directly |

`.cortex/` holds what the person does not need to think about: observations waiting to be settled, events from a host, turns waiting to be read, and earlier versions of every file.

## This repository

```
template/   what every new cortex starts as
src/        the software: rules, stores, MCP server, adapter (not built here yet)
```

## Status

A skeleton. The rules, store and nine MCP tools exist in `ohm-content-layer` and have not been moved here yet.

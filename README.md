# ohm-cortex

What an agent knows about the person it works for, and what it can do for them, kept as a folder that person can read.

Cortex is separate software. It does not need ohm, a vault, or any one coding agent. A host such as ohm can store and sync a cortex, and any agent can keep one through the MCP server or the hooks adapter.

## A cortex

```
cortex/
├── agents/         AGENTS.md, the rulebook for keeping this cortex, and secrets/
├── identity.md     who this cortex belongs to, read in full every session
├── vault.md        how to read the vault: each section, what it means, how posts there are filed
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

Then connect an agent to it over MCP, with this as the server's command. When it connects, the agent is told to call `cortex_start`, which returns the cortex's playbook. It can also read the cortex's files as `cortex://` resources; secrets and birthdate are never served. In Claude Code, the `start` prompt appears as a slash command for beginning a session from your cortex.

```bash
node /path/to/cortex/bin/cortex.mjs mcp ~/cortex
```

| Command | Who runs it | What it does |
| --- | --- | --- |
| `cortex status [dir] [--json]` | The person | Lists everything waiting or broken, with how to clear each item; reads without changing files |
| `cortex init [dir] [--account <did>]` | The person | Starts a cortex in an empty folder, optionally with the signed-in account |
| `cortex vault connect <folder> [dir]` | The person | Connects the vault kept in that folder, and writes `vault.md` |
| `cortex vault [sync] [dir]` | The person or a host | Brings the cortex in step with the vault: counts, what moved or left, memories pointing at posts no longer there |
| `cortex identity [dir]` | The person | Shows the confirmed identity and the facts an agent proposed |
| `cortex confirm <field or id> [dir]` | The person | Accepts a proposed identity fact |
| `cortex reject <field or id> [dir]` | The person | Turns one down; that value is not proposed again |
| `cortex clear <field> [dir]` | The person | Removes an identity field |
| `cortex mcp [dir]` | An agent | Serves the ten `cortex_*` tools over standard input and output |
| `cortex serve [dir] [--port 8765] [--host 127.0.0.1]` | The person | Serves the same tools over HTTP at `/mcp`, for clients that connect to a server |
| `cortex token [dir] [--replace]` | The person | Makes the token HTTP clients sign in with, saves it in `agents/secrets/mcp-token`, and prints it once |
| `cortex approve <skill> [dir]` | The person | Moves a skill an agent proposed into `skills/` |
| `cortex event <text> [dir]` | A host | Records a change from outside, for the agent to settle |
| `cortex hook <moment> [dir] --agent <name>` | Claude Code or Codex, as a hook | Answers `session-start`, `prompt`, `stop` or `session-end` from the folder: the playbook and working memory at the start, a request to distill when working memory changed and was not distilled, once for each change. Exits 0 and writes nothing on any error |
| `cortex install-hooks claude-code\|codex` | The person | Prints the hooks to add to that client's settings. Writes nothing |

### Over HTTP

For a client that connects to a server rather than starting one, such as a coding agent on another machine. Make a token, then serve:

```bash
node bin/cortex.mjs token ~/cortex      # prints the token once; it is kept in agents/secrets/mcp-token
node bin/cortex.mjs serve ~/cortex      # http://127.0.0.1:8765/mcp
```

Every request must carry `Authorization: Bearer <token>`, or it is answered 401. `cortex serve` binds to 127.0.0.1 unless given `--host`, and with no token it refuses any other host. It does not do TLS: to reach it from another machine, put it behind something that does. Restart it after `cortex token --replace`.

Claude Code:

```bash
claude mcp add --transport http cortex http://127.0.0.1:8765/mcp --header "Authorization: Bearer $CORTEX_TOKEN"
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.cortex]
url = "http://127.0.0.1:8765/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

ChatGPT and Claude's web connectors sign in with OAuth, which is not built yet.

The folder is the one named, or `CORTEX_DIR`, or `~/cortex`. Files a person edits by hand are what the agent is given next.

## This repository

```
template/   what every new cortex starts as
src/        the rules, the folder store, the MCP protocol and the tools
bin/        the command line
test/       run with npm test
```

## Status

Built:
- the folder store and strict identity;
- the vault contract, with a folder vault and `vault.md`;
- working memory for each agent;
- filing advice and `cortex status`;
- MCP over standard input and output, and over HTTP with a token;
- the hooks adapter for Claude Code and Codex;
- the fourteen tools and the commands above.

97 tests run against temporary folders, and CI runs them on Node 20 and 22 for every pull request.

Not yet tried: the hooks in a real Claude Code or Codex session.

Not built: OAuth for ChatGPT and Claude's web connectors, fitting memories to each prompt, and switching tools on from anywhere but the file itself.

Not planned: syncing a cortex with ohm. A cortex stays a folder of its own. The older cortex inside ohm-content-layer is separate and is not connected to this one.

See [docs/plan.md](docs/plan.md) for the decisions behind this.

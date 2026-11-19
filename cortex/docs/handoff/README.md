# Handing the remaining work to parallel agents

Steps 1 to 3 of the build order in [../plan.md](../plan.md) are built and merged. This folder splits what is left into briefs that separate agents can work on at the same time, each on its own branch and pull request.

## Start here, every agent

1. Read [../../AGENTS.md](../../AGENTS.md) (the rules for changing this repository) and [../plan.md](../plan.md) (the specification).
2. Read your brief below, and only your brief's files are yours.
3. Run `npm test` before you change anything, and after every change. CI runs it on Node 20 and 22 for every pull request.
4. Work on a branch named in your brief and open a pull request against `main`. Do not merge it yourself, and do not push to `main`.

## The first wave: four briefs that can run at once

| Brief | Step | Branch | What it builds | Needs a decision first |
| --- | --- | --- | --- | --- |
| [04-filing.md](04-filing.md) | 4 | `filing` | "How should I file this?": a section, its conventions, the skill for that kind of source, and related posts | No |
| [05-status.md](05-status.md) | 5 | `status` | `cortex status`: everything waiting or broken, each with how to clear it | No |
| [06-http.md](06-http.md) | 6 | `http` | MCP over HTTP, so clients that connect to a remote server can reach a cortex | Sign-in: the brief builds a token first and leaves OAuth for ChatGPT open |
| [07-hooks.md](07-hooks.md) | 7 | `hooks` | `cortex hook <moment>` for Claude Code and Codex, so the playbook and working memory reach the model without it calling a tool | No, but full verification needs signed-in Claude Code and Codex |

## Who owns which files

Each brief has files of its own. A few files are shared, and every brief may need a small change in them:

| Shared file | What you may change |
| --- | --- |
| `src/tools.mjs` | Add your tools to the end of `TOOLS` and your handlers to `calls`. Do not change existing tools |
| `bin/cortex.mjs` | Add your command as one more branch before the final `else`, and one line to the help text |
| `template/agents/AGENTS.md` | Add one section of your own. Do not rewrite other sections |
| `docs/plan.md` | Mark your step *Done* in the build order and add one row for it in "What exists now". Nothing else |
| `README.md` | Add your command to the commands table |
| `test/cortex.test.mjs` | Nothing |

Two agents will often both append to `TOOLS` or to the command chain. That conflict is expected and small. Rebase on `main` before asking for review, and keep both sides.

## Merge order

Merge in this order, rebasing each on `main` after the one before it lands. It goes smallest and least shared first:

1. `status`
2. `filing`
3. `hooks`
4. `http`

## After the first wave

The first wave is merged: status (#7), filing (#9), HTTP (#8) and hooks (#10). What is left:

- **Step 8, sync with ohm, is not planned.** The person decided to keep the cortex a folder of its own.
- **Drop the `project` memory kind.** The plan says project facts are vault content. Touches `src/core.mjs` and the memory schema in `src/tools.mjs`.
- **`profile()` for a folder vault.** The contract has it; a folder answers nothing yet. Decide where a folder vault keeps profile facts first.

# Brief: step 7, the hooks adapter

Branch `hooks`. Read [README.md](README.md) first for the shared rules.

## Why

Over MCP, an agent only gets its cortex if the model chooses to call `cortex_start`, and only distills if it remembers to at the end. Claude Code and Codex both run programs at fixed moments of a session (hooks). Those programs run whatever the model does. This step uses them so the playbook and working memory reach the model at the start, and distilling is asked for at the end.

## What to build

1. **`cortex hook <moment> [dir]`**, in `src/adapter.mjs` and `bin/cortex.mjs`. It reads the hook's JSON object from standard input. It never waits on the network, because it reads the folder directly. It never fails the session: on any error it writes nothing and exits 0. Moments:
   - **`session-start`:** answer with context for the model. That is:
     - the short MCP instructions;
     - the playbook (`agents/AGENTS.md`);
     - the identity as an agent sees it (birthdate hidden);
     - the memories marked `always`, and the memory index;
     - this agent's working memory from last time, and other agents' with their dates.

     Use the format both clients document for adding context at session start (`hookSpecificOutput.additionalContext` with `hookEventName`). Keep it under 10,000 characters: cut the memory index first, then other agents' working memory.
   - **`prompt`:** answer with nothing for now. Fitting memories to the prompt is later work, and an empty answer must not slow a prompt.
   - **`stop`:** the model is about to finish. If this agent has not distilled since the session started, block once with the reason "Before you finish, call cortex_distill with what you noticed this session." The `stop_hook_active` field in the hook's input means it has already asked once, so let the session end. Never block twice.
   - **`session-end`:** record in `.cortex/sessions.jsonl` that the session ended and whether it was distilled. Nothing else.

   The agent's name comes from which hooks file called it (`--agent claude-code` or `--agent codex` in the command), through `agentName`.

Whether a session has distilled can't be matched by session ID, because the model does not know the client's session ID. Instead:
- `session-start` appends `{ agent, session, started }` to `.cortex/sessions.jsonl`, with `session` taken from the hook's input;
- `distill` in `src/folder.mjs` appends `{ agent, distilled }` with the time;
- `stop` asks whether this agent has distilled since its session started.

This brief owns that one change to `distill`.
2. **Hooks files** in `hooks/`:
   - `hooks/claude-code.json`, for `.claude/settings.json`;
   - `hooks/codex.toml`, for Codex's hooks configuration.

   Each runs `cortex hook <moment> --agent <name>` with the cortex folder from `CORTEX_DIR`. Check both clients' current hook documentation for event names and output format: [Claude Code hooks](https://code.claude.com/docs/en/hooks) and [Codex hooks](https://developers.openai.com/codex/hooks). An earlier probe of what each client hands a hook is recorded under "Agent 0 probe" in [ohm-content-layer's build plan](https://github.com/haeinej/ohm-content-layer/blob/main/plans/build-plan.md); the live docs win where they differ.
3. **`cortex install-hooks claude-code|codex`** prints the snippet to add. It writes nothing to the person's configuration.

## Your files

`src/adapter.mjs`, `hooks/`, `test/adapter.test.mjs`. The one change to `distill` in `src/folder.mjs` described above. The shared files as the README allows.

## Done when

`npm test` passes, with tests that feed recorded hook inputs (write synthetic ones matching each client's documented shape) on standard input and check:
- `session-start` returns the playbook and working memory within the size limit, with birthdate never present;
- `stop` blocks once when not distilled, and lets the session end when `stop_hook_active` is set or after a distill;
- a broken cortex folder makes every moment exit 0 with no output;
- no moment takes longer than 200 ms on a cortex with 100 memories.

Then, if you can sign in to Claude Code or Codex in your environment, install the hooks in a scratch folder and record what happened in the pull request. If you cannot, say so. The plan's "done when" for this step needs that real run.

## Not in scope

Fitting memories to each prompt, sending turns anywhere, and running an agent headless to distill.

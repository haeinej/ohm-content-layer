# Brief: step 5, `cortex status`

Branch `status`. Read [README.md](README.md) first for the shared rules.

## Why

The person needs one place to see what is waiting for them or broken in their cortex, without reading every file. Every item must say how to clear it, or it is noise.

## What to build

1. **`src/status.mjs`** with `cortexStatus(cortex)`, built only from operations `openCortex` already has. It answers a list of items, each `{ kind, what, clear }`, where `clear` is the command or action that removes it. Kinds:
   - `identity-proposal`: a fact an agent proposed. Clear: `cortex confirm <id>` or `cortex reject <id>`.
   - `skill-proposal`: a skill waiting for approval. Clear: `cortex approve <name>`.
   - `tool-proposal`: a tool an agent asked for. Clear: build it and add it to `tools/`, or delete the proposal file.
   - `observations`: how many observations are waiting to be settled. Clear: the next agent session settles them.
   - `broken-pointer`: a memory pointing at a post no longer in the vault. Clear: the agent rewrites or forgets the memory, or the person restores the post.
   - `undescribed-section`: a vault section with no meaning in `vault.md`. Clear: the agent describes it, or the person writes it.
   - `gone-section`: a section no longer in the vault that `vault.md` still describes. Clear: delete its block from `vault.md`.
   - `problem`: anything `cortex_start` reports under `problems` (unreadable files, a bad identity field, a vault that cannot be reached, two posts with one ID). Clear: the message says what to fix.
   - `stale-working`: another agent's working memory not written for 30 days. Clear: delete the file, or let that agent distill.
2. **`cortex status [dir]`** in `bin/cortex.mjs`. It prints one line per item, grouped by kind, and `Nothing is waiting.` when the list is empty. With `--json` it prints the list. It exits 0 either way.
3. **No tool for agents.** Status is the person's view. Agents already get the same facts from `cortex_start`.

## Your files

`src/status.mjs`, `test/status.test.mjs`. The shared files as the README allows (`bin/cortex.mjs`, `README.md`, `docs/plan.md`).

## Done when

`npm test` passes, with tests that, for each kind:
- set up the situation;
- see the item listed with its `clear`;
- carry out the `clear`;
- see the item gone.

That is the plan's "done when": every item it lists has a way to clear it.

## Not in scope

A web view, notifications, and changing anything from `cortex status` itself.

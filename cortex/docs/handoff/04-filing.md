# Brief: step 4, filing advice

Branch `filing`. Read [README.md](README.md) first for the shared rules.

## Why

The agent helps the person put their own sources into their vault: a transcript, a link, a note. The person decides what goes in. The agent proposes where it goes, a title in their style, and links, asks once, and saves through the vault's own tools. Cortex never writes to the vault. This step gives the agent one answer to "how should I file this?", built from what cortex already knows.

## What to build

1. **A `search` operation on the vault contract** (`src/vault.mjs`): `search(words, limit)` returns posts whose title or body contains the words, best first, as `[{ id, title, label, sublabel }]`. Make it optional in `checkVault`: a vault without it simply gives no related posts. Implement it for the folder vault.
2. **`src/filing.mjs`** with one operation, `adviseFiling({ kind, title, text })`, and a tool `cortex_file_advice` that calls it:
   - `kind` is what the source is, in the agent's words: "meeting transcript", "reading note", "link".
   - It answers with:
     - `sections`: up to three likely sections from `vault.md`, each with its meaning and conventions and why it fits. Matching is by words: the source's kind, title and text against each section's name and meaning. No model calls.
     - `skill`: the approved skill whose description best fits the kind, if one does.
     - `related`: up to five related posts from `search`.
     - `ask`: one sentence the agent can put to the person, naming the first section and title convention.
   - It writes nothing, anywhere.
3. **A filing skill in the template**, `template/skills/file-a-source/SKILL.md`. It tells the agent how to file any source:
   - ask what it is;
   - call `cortex_file_advice`;
   - propose once;
   - save through the vault's tools with the person's words untouched;
   - note in working memory anything the person changed about the proposal.

   It ships in `skills/` because the person installs the template themselves.
4. **Rulebook.** Add a "Filing" section to `template/agents/AGENTS.md`. It says:
   - file only what the person hands over;
   - never write a post or a fact of your own;
   - call `cortex_file_advice`, propose once, and save through the vault's tools.

   The "Reading the vault" section already covers some of this; move those lines rather than repeat them.

## Your files

`src/filing.mjs`, `test/filing.test.mjs`, `template/skills/file-a-source/`, and the `search` addition in `src/vault.mjs` (no one else touches that file in this wave). The shared files as the README allows.

## Done when

`npm test` passes, with tests that show:
- the answer for a source names a section from `vault.md` with its conventions, and up to five related posts;
- with no vault connected, it says so instead of guessing;
- a vault without `search` still answers, with no related posts;
- calling it changes no file in the cortex or the vault (compare a listing before and after);
- an approved skill whose description fits the kind is named, and an unapproved one is not.

## Not in scope

Writing to the vault, ranking by meaning, and model calls.

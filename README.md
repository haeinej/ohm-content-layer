# ohmmmm

A person's home in ohm: one folder, `ohmmmm.<handle>`, holding their **vault** and their **cortex** side by side.

```
ohmmmm.alice.example.com/
├── vault/     blocks and channels: what the person thinks and keeps (canonical)
└── cortex/    identity, memory, skills: what an agent knows about the person
```

- The **vault** is canonical. Blocks live there, in three layers chosen by each block's `visibility`: public (a `com.ohmmmm.post` on the PDS), friends (readable on the vault service) and private (end-to-end encrypted, keys only on the person's devices). Code and docs: [vault/](vault/README.md).
- The **cortex** never holds what belongs in the vault. It reads the vault through one small, read-only contract, and keeps its own memories, which point at blocks by ID. Code and docs: [cortex/](cortex/README.md).
- Sign-in, onboarding, grants and the private vault's keys are in the account app, [ohm-onboarding](https://github.com/haeinej/ohm-onboarding).

This repository joins what were two: `haeinej/ohm-vault` is in `vault/` and `haeinej/ohm-cortex` in `cortex/`, each with its history (`git log --follow vault/…`).

## Start a home

```sh
node bin/ohmmmm.mjs init alice.example.com        # makes ~/ohmmmm.alice.example.com
cd ~/ohmmmm.alice.example.com
node <this repo>/vault/bin/ohm.mjs vault index    # finds ./vault by itself
node <this repo>/cortex/bin/cortex.mjs status     # finds ./cortex, and reads ./vault by itself
```

Inside a home (or with `OHMMMM_HOME` set), `ohm vault …` uses the home's `vault/` and `cortex …` uses its `cortex/`. A cortex in a home reads the sibling vault through the vault's own reader unless `.cortex/vault.json` names another. Either folder still works on its own, as before.

## What is shared

| | Where | Used by |
| --- | --- | --- |
| The home: naming, finding, making | [home/home.mjs](home/home.mjs) | `bin/ohmmmm.mjs`, `ohm vault`, `cortex` |
| The vault reader contract | [contract/vault-reader.mjs](contract/vault-reader.mjs) | cortex checks a vault against it; the vault's reader answers it |
| The words | [docs/words.md](docs/words.md) | both |

## Tests

```sh
npm ci --prefix vault && npm ci --prefix vault/service
npm test        # the home and contract, then vault, then cortex
```

Node 22.13 or newer.

# Working in this repository

Two parts and a thin layer over them. Read [README.md](README.md) first, then the part you are changing: [vault/AGENTS.md](vault/AGENTS.md) or [cortex/AGENTS.md](cortex/AGENTS.md). Their rules still hold inside each folder.

- **One home per person:** `ohmmmm.<handle>/vault` and `ohmmmm.<handle>/cortex` ([home/home.mjs](home/home.mjs)). Do not add a third place a vault or a cortex can default to.
- **One contract:** cortex reads a vault only through [contract/vault-reader.mjs](contract/vault-reader.mjs). Change it there, and in both the vault's reader (`vault/vault/cortex.mjs`) and cortex's checks (`cortex/src/vault.mjs`) in the same change; `test/home.test.mjs` holds them together.
- **One set of words:** [docs/words.md](docs/words.md). Use a word that already names a thing; if the two parts disagree, settle it there.
- The vault is canonical; the cortex never copies what a block says, and never writes to the vault.
- Keys for the private layer live in the account app (ohm-onboarding `packages/keys`), not here. The vault service stores private blocks only as ciphertext.
- Run `npm test` at the root before handing work back.

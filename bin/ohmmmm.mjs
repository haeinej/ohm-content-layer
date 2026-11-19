#!/usr/bin/env node
// A person's home, ohmmmm.<handle>, with their vault and cortex inside (home/home.mjs).
//
//   ohmmmm init <handle> [parent]   make ohmmmm.<handle> in parent (default: your home folder), with
//                                   vault/ set up as a vault and cortex/ started for that handle
//   ohmmmm where [folder]           the home a folder is in, and its vault and cortex
//
// The vault and the cortex keep their own commands: `ohm vault …` (vault/bin/ohm.mjs) and
// `cortex …` (cortex/bin/cortex.mjs). Run inside a home, both find their folder by themselves.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHome, HomeProblem, makeHome } from '../home/home.mjs';
import { CONFIG, emptyConfig } from '../vault/vault/roots.mjs';
import { initCortex } from '../cortex/src/folder.mjs';

const TEMPLATE = fileURLToPath(new URL('../cortex/template', import.meta.url));

// Makes the home and fills it: the vault's configuration, and a cortex whose account is the handle.
// Each part is left as it is if it is already there.
export async function initHome(parent, handle) {
  const layout = await makeHome(parent, handle);
  const config = join(layout.vault, CONFIG);
  await mkdir(join(layout.vault, '.vault'), { recursive: true });
  if ((await readFile(config, 'utf8').catch(() => null)) === null) await writeFile(config, `${JSON.stringify(emptyConfig(), null, 2)}\n`, { flag: 'wx' });
  const started = await readFile(join(layout.cortex, 'agents', 'AGENTS.md'), 'utf8').then(() => true, () => false);
  if (!started) await initCortex(layout.cortex, TEMPLATE, { account: layout.handle });
  return layout;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'init' && rest[0]) {
      const layout = await initHome(rest[1] ?? homedir(), rest[0]);
      console.log(JSON.stringify(layout, null, 2));
    } else if (command === 'where') {
      const layout = findHome(rest[0] ?? process.cwd());
      if (!layout) { console.error('Not in a home. Make one with: ohmmmm init <handle>'); process.exitCode = 1; } else console.log(JSON.stringify(layout, null, 2));
    } else {
      console.log('ohmmmm init <handle> [parent] | where [folder]');
      if (command) process.exitCode = 1;
    }
  } catch (problem) {
    console.error(problem instanceof HomeProblem || problem?.code ? problem.message : problem);
    process.exitCode = 1;
  }
}

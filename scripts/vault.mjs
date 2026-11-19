// Work with a vault folder on this machine. Nothing here signs in, reaches the vault service or
// publishes anything; it reads the folder and its roots and keeps .vault/index.sqlite.
//
//   vault init   [--vault DIR]               make .vault/config.json, with no roots yet
//   vault index  [--vault DIR]               bring the index into line with the folder and its roots
//   vault status [--vault DIR]               what the index holds, and when it last scanned
//   vault inspect REF [--vault DIR]          one node: what it is, its file's size, times and address, its edges
//   vault search WORDS... [--vault DIR] [--limit N]
//
// --vault defaults to OHM_VAULT_FOLDER, then the current folder. REF is a slug, a path in the vault,
// or a node key such as block:3mzocqfoc22if.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const sqlite = await import('node:sqlite').catch(() => null);
if (!sqlite) {
  // Node before 22.13 has SQLite only behind a flag. Run this same command again with it.
  if (process.execArgv.includes('--experimental-sqlite')) {
    console.error('This Node has no SQLite. Use Node 22.13 or newer.');
    process.exit(1);
  }
  const again = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', process.argv[1], 'vault', ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(again.status ?? 1);
}
const { CONFIG, emptyConfig } = await import('../vault/roots.mjs');
const { inspect, openIndex, scan, search, summary } = await import('../vault/indexer.mjs');

const ACTIONS = ['init', 'index', 'status', 'inspect', 'search'];
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { vault: { type: 'string' }, limit: { type: 'string' } },
  });
  // The command line arrives with "vault" first when ohm runs this file.
  const [action, ...rest] = positionals[0] === 'vault' ? positionals.slice(1) : positionals;
  if (!ACTIONS.includes(action)) throw new Error(`Say what to do: ${ACTIONS.join(', ')}`);
  const vault = resolve(values.vault ?? process.env.OHM_VAULT_FOLDER ?? '.');
  const print = value => console.log(JSON.stringify(value, null, 2));
  if (action === 'init') {
    const file = resolve(vault, CONFIG);
    const held = await readFile(file, 'utf8').catch(() => null);
    if (held !== null) print({ vault, config: file, note: 'The vault already has a configuration; it was left as it is.' });
    else {
      await mkdir(resolve(vault, '.vault'), { recursive: true });
      await writeFile(file, `${JSON.stringify(emptyConfig(), null, 2)}\n`, { flag: 'wx' });
      print({ vault, config: file, note: 'Add folders the vault should read to "roots", then run: ohm vault index' });
    }
  } else {
    const db = await openIndex(vault, { DatabaseSync: sqlite.DatabaseSync });
    try {
      if (action === 'index') {
        const report = await scan({ vault, db });
        print({
          ...report,
          // Long lists are counted; the full lists are in the index.
          ...Object.fromEntries(['added', 'changed', 'removed'].map(key => [key, report[key].length > 50 ? report[key].length : report[key]])),
        });
      } else if (action === 'status') print(summary(db));
      else if (action === 'inspect') {
        if (!rest.length) throw new Error('Say which node: a slug, a path, or a key');
        const found = inspect(db, rest.join(' '));
        if (!found) throw new Error(`Nothing in the index is "${rest.join(' ')}". Run ohm vault index if it is new.`);
        print(found);
      } else {
        if (!rest.length) throw new Error('Say what to search for');
        const limit = values.limit === undefined ? 20 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit is a whole number from 1 to 500');
        print(search(db, rest.join(' '), { limit }));
      }
    } finally {
      db.close();
    }
  }
} catch (problem) {
  console.error(problem.message);
  process.exitCode = 1;
}

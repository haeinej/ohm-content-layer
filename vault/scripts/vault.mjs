// Work with a vault folder on this machine. Nothing here signs in, reaches the vault service or
// publishes anything; it reads the folder and its roots and keeps .vault/index.sqlite and
// .vault/journal.jsonl.
//
//   vault init   [--vault DIR]               make the folder if needed, and .vault/config.json
//   vault add SOURCE [--channel C] [--title T] [--by agent:NAME] [--move]
//                                            copy a file, or refer to an address, into the vault,
//                                            recording where it came from; then index
//   vault index  [--vault DIR]               bring the index into line with the folder and its roots
//   vault status [--vault DIR]               what the index holds, and when it last scanned
//   vault inspect REF [--vault DIR]          one node: what it is, its file, its edges, its history
//   vault search WORDS... [--vault DIR] [--limit N]
//   vault hook   [--vault DIR] [--agent NAME] an agent's PostToolUse hook: reads the hook's JSON on
//                                            standard input and journals a write inside the vault
//   vault mcp    [--vault DIR] [--agent NAME] serve the selected vault to a local stdio client
//
// --vault defaults to OHM_VAULT_FOLDER, then the vault of the home this runs in
// (ohmmmm.<handle>/vault, ../../home/home.mjs), then the current folder. REF is a slug, a path in the vault,
// or a node key such as block:3mzocqfoc22if.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultVault } from '../../home/home.mjs';

const ACTIONS = ['init', 'add', 'index', 'status', 'inspect', 'search', 'hook', 'mcp'];
const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    vault: { type: 'string' }, limit: { type: 'string' }, channel: { type: 'string' }, title: { type: 'string' },
    by: { type: 'string' }, move: { type: 'boolean' }, agent: { type: 'string' },
  },
});
// The command line arrives with "vault" first when ohm runs this file.
const [action, ...rest] = positionals[0] === 'vault' ? positionals.slice(1) : positionals;
const expand = path => (path === '~' ? homedir() : path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path);
const selected = values.vault || process.env.OHM_VAULT_FOLDER || defaultVault();
const vault = resolve(expand(selected || '.'));
const print = value => console.log(JSON.stringify(value, null, 2));

// A hook runs after every file an agent writes, so it is quick, needs no database, and never fails
// the agent's work: anything wrong is ignored.
if (action === 'hook') {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { hookEvent } = await import('../vault/add.mjs');
    const { appendEvents } = await import('../vault/journal.mjs');
    const event = hookEvent(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), { vault, agent: values.agent || 'claude-code' });
    if (event) await appendEvents(vault, [event]);
  } catch {}
  process.exit(0);
}

const sqlite = await import('node:sqlite').catch(() => null);
if (!sqlite) {
  // Node before 22.13 has SQLite only behind a flag. Run this same command again with it.
  if (process.execArgv.includes('--experimental-sqlite')) {
    console.error('This Node has no SQLite. Use Node 22.13 or newer.');
    process.exit(1);
  }
  const again = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(again.status ?? 1);
}
const { CONFIG, emptyConfig } = await import('../vault/roots.mjs');
const { inspect, openIndex, scan, search, summary } = await import('../vault/indexer.mjs');
const { addToVault } = await import('../vault/add.mjs');

try {
  if (!ACTIONS.includes(action)) throw new Error(`Say what to do: ${ACTIONS.join(', ')}`);
  const counted = report => ({
    ...report,
    // Long lists are counted; the full lists are in the index and the journal.
    ...Object.fromEntries(['added', 'changed', 'removed'].map(key => [key, report[key].length > 50 ? report[key].length : report[key]])),
  });
  if (action === 'mcp') {
    const { serveLocalVault } = await import('../mcp/local.mjs');
    await serveLocalVault({
      vault: selected && vault, agent: values.agent ?? 'mcp', DatabaseSync: sqlite.DatabaseSync,
      input: process.stdin, output: process.stdout,
    });
  } else if (action === 'init') {
    await mkdir(resolve(vault, '.vault'), { recursive: true });
    const file = resolve(vault, CONFIG);
    const held = await readFile(file, 'utf8').catch(() => null);
    if (held !== null) print({ vault, config: file, note: 'The vault already has a configuration; it was left as it is.' });
    else {
      await writeFile(file, `${JSON.stringify(emptyConfig(), null, 2)}\n`, { flag: 'wx' });
      print({ vault, config: file, note: 'Add folders the vault should read to "roots", then run: ohm vault index' });
    }
  } else {
    const db = await openIndex(vault, { DatabaseSync: sqlite.DatabaseSync });
    try {
      if (action === 'add') {
        if (rest.length !== 1) throw new Error('Say what to add: one file\'s path, or one address');
        const source = /^https?:\/\//i.test(rest[0]) ? rest[0] : resolve(expand(rest[0]));
        const added = await addToVault({
          vault, source, ...(values.channel ? { channel: values.channel } : {}), ...(values.title ? { title: values.title } : {}),
          by: values.by || 'me', move: Boolean(values.move),
        });
        const report = await scan({ vault, db });
        print({ ...added, index: { nodes: report.nodes, edges: report.edges, problems: report.problems } });
      } else if (action === 'index') print(counted(await scan({ vault, db })));
      else if (action === 'status') print(summary(db));
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

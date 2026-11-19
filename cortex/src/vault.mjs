// The vault contract: what cortex needs from a vault, so any vault can sit beside a cortex. Cortex
// only reads through it. The contract itself (the operations and what each gives) is kept once, in
// ../../contract/vault-reader.mjs, for both cortex and the vault's own reader. Saving content is the vault's own job, done by the agent through the
// vault's own API on the person's say-so.
//
// A vault holds blocks: one unit of thought each, and a published one is a post. Blocks are
// gathered in channels, ordered collections; a block can be in more than one. Here a block is
// named by the channel it was filed in, its path, such as `essays` or `notes/reading`.
//
//   shape()          the channels, with how many blocks each holds, and any problems reading the vault:
//                    { blocks, channels: [{ channel, blocks }], problems? }
//   read(id)         one block: { id, title, channel, body }, or null
//   exists(ids)      for each of a list of IDs, whether the block is still there, and where:
//                    { [id]: { exists, channel, title } }. One call, so a vault is read once
//                    however many blocks the memories point at
//   changes(cursor)  what was saved, moved or removed since a cursor an earlier call returned:
//                    { changes: [{ type, id, title, channel, from? }], cursor }. With no
//                    cursor, it returns none and a cursor to start from
//   profile()        identity facts the vault itself holds: [{ field, value, source }]
//   search(words, limit)  optional: blocks whose title or body holds any of the words, best first:
//                    [{ id, title, channel }]. A vault without it gives no related blocks
//
// A cursor is the vault's own: cortex keeps it and hands it back, and never looks inside.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contractProblems, OPTIONAL, REQUIRED } from '../../contract/vault-reader.mjs';
import { Refused, splitFront } from './core.mjs';

export const OPERATIONS = REQUIRED;
export { OPTIONAL };

export function checkVault(vault) {
  const [problem] = contractProblems(vault);
  if (problem) throw new Refused('InvalidVault', problem);
  return vault;
}

// The words of a text, for matching by words, lowercased.
//
// Latin-script words: runs of letters and digits, a plural's s dropped, and words that say nothing
// about what a text is about left out. Korean, Japanese and Chinese are not written with spaces
// between words, and particles join the word before them (회의를), so a run in those scripts gives
// its pairs of characters (회의, 의를), or the one character when it stands alone (책). Such a term
// matches a text that holds it anywhere: see matcherOf.
const COMMON = new Set('a about after all also an and any are as at be been before but by can could did do does for from had has have he her his how i if in into is it its just me more my no not of on one or our out over she so some than that the their them then there these they this to up us very was we were what when where which who why will with would you your'.split(' '));
const EAST_ASIAN = '\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30fc';
const EAST_ASIAN_RUN = new RegExp(`[${EAST_ASIAN}]+`, 'gu');
const EAST_ASIAN_TERM = new RegExp(`^[${EAST_ASIAN}]+$`, 'u');
const LATIN = /^[\p{Script=Latin}\p{N}]+$/u;
export function wordsOf(text) {
  const found = new Set();
  const lower = String(text ?? '').toLowerCase();
  for (const [run] of lower.matchAll(EAST_ASIAN_RUN)) {
    const characters = [...run];
    if (characters.length === 1) found.add(run);
    for (let at = 0; at + 1 < characters.length; at += 1) found.add(characters[at] + characters[at + 1]);
  }
  for (const [word] of lower.replace(EAST_ASIAN_RUN, ' ').matchAll(/[\p{L}\p{N}]+/gu)) {
    if (word.length < 2) continue;
    if (!LATIN.test(word)) { found.add(word); continue; }
    if (COMMON.has(word)) continue;
    found.add(word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
  }
  return found;
}

// Whether a text holds a term wordsOf gave: a Korean, Japanese or Chinese term anywhere in it, any
// other as one of its words.
export function matcherOf(text) {
  const words = wordsOf(text);
  const lower = String(text ?? '').toLowerCase();
  return term => EAST_ASIAN_TERM.test(term) ? lower.includes(term) : words.has(term);
}

// A vault kept as a folder of Markdown files: <channel>/<block>.md or <channel>/<sub>/<block>.md,
// whose channel is `channel/sub`, and which counts in `channel` too. Deeper folders join into one
// sub-channel name with hyphens. A block's ID is its `id` property; a file without one is known by
// its path, so moving it reads as removing one block and saving another. A file at the top of the
// folder is in the channel `other`. In a folder a block is in one channel, the one it is filed in.
//
// Each operation looks at every file, and reads again only those whose size or times changed since
// it last read them, so two operations in a row, such as shape and then search, read the blocks once
// and still see any block that changed in between. `readText` is for tests.
export function folderVault(root, { readText = path => readFile(path, 'utf8') } = {}) {
  const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

  let problems = [];
  let held = new Map();
  async function blocks() {
    const found = new Map();
    const seen = new Map();
    problems = [];
    async function walk(folder) {
      let entries;
      try { entries = await readdir(join(root, folder), { withFileTypes: true }); } catch (problem) {
        if (problem.code === 'ENOENT') throw new Refused('VaultUnreachable', `The vault folder ${root} cannot be found`);
        throw problem;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const path = folder ? join(folder, entry.name) : entry.name;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          const info = await stat(join(root, path));
          const stamp = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
          const text = held.get(path)?.stamp === stamp ? held.get(path).text : await readText(join(root, path));
          seen.set(path, { stamp, text });
          const { properties, body } = splitFront(text);
          const parts = path.split(sep);
          const channel = parts.length === 1 ? 'other' : parts.length === 2 ? parts[0] : `${parts[0]}/${parts.slice(1, -1).join('-')}`;
          const id = typeof properties.id === 'string' && properties.id.trim() ? properties.id.trim() : `path:${parts.join('/')}`;
          // Two files with one ID: the first stands, and the clash is reported so the person can fix it.
          if (found.has(id)) { problems.push(`${found.get(id).path} and ${parts.join('/')} have the same id, ${id}. Only the first is read`); continue; }
          found.set(id, { id, title: typeof properties.title === 'string' && properties.title.trim() ? properties.title.trim() : entry.name.slice(0, -3), channel, body, path: relative(root, join(root, path)), hash: hash(text) });
        }
      }
    }
    await walk('');
    held = seen;
    return found;
  }

  const place = block => ({ title: block.title, channel: block.channel });
  // A block in a sub-channel counts in the channel above it too.
  const within = channel => channel.includes('/') ? [channel.slice(0, channel.indexOf('/')), channel] : [channel];

  return checkVault({
    kind: 'folder',

    async shape() {
      const all = [...(await blocks()).values()];
      const channels = new Map();
      for (const block of all) {
        for (const key of within(block.channel)) {
          if (!channels.has(key)) channels.set(key, { channel: key, blocks: 0 });
          channels.get(key).blocks += 1;
        }
      }
      return { blocks: all.length, channels: [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)), ...(problems.length ? { problems: [...problems] } : {}) };
    },

    async read(id) {
      const block = (await blocks()).get(id);
      return block ? { id: block.id, ...place(block), body: block.body } : null;
    },

    async exists(ids) {
      const all = await blocks();
      return Object.fromEntries([...new Set(ids)].map(id => [id, all.has(id) ? { exists: true, ...place(all.get(id)) } : { exists: false }]));
    },

    async changes(cursor) {
      const now = await blocks();
      const next = Object.fromEntries([...now.values()].map(block => [block.id, { ...place(block), hash: block.hash }]));
      if (!cursor || typeof cursor !== 'object') return { changes: [], cursor: next };
      // A cursor from before channels named a block's place by label and sublabel.
      const channelOf = was => was.channel ?? (was.sublabel ? `${was.label}/${was.sublabel}` : was.label);
      const changes = [];
      for (const [id, was] of Object.entries(cursor)) {
        const block = next[id];
        if (!block) changes.push({ type: 'removed', id, title: was.title, channel: channelOf(was) });
        else if (block.channel !== channelOf(was)) changes.push({ type: 'moved', id, ...place(block), from: channelOf(was) });
        else if (block.hash !== was.hash) changes.push({ type: 'saved', id, ...place(block) });
      }
      for (const [id, block] of Object.entries(next)) if (!cursor[id]) changes.push({ type: 'saved', id, ...place(block), new: true });
      return { changes, cursor: next };
    },

    profile: async () => [],

    // A word in the title counts twice what a word in the body does. Ties go by title.
    async search(words, limit = 10) {
      const wanted = wordsOf(Array.isArray(words) ? words.join(' ') : words);
      const most = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
      if (!wanted.size) return [];
      const scored = [];
      for (const block of (await blocks()).values()) {
        const title = matcherOf(block.title);
        const body = matcherOf(block.body);
        let score = 0;
        for (const word of wanted) score += (title(word) ? 2 : 0) + (body(word) ? 1 : 0);
        if (score) scored.push({ score, block });
      }
      scored.sort((a, b) => b.score - a.score || a.block.title.localeCompare(b.block.title));
      return scored.slice(0, most).map(({ block }) => ({ id: block.id, ...place(block) }));
    },
  });
}

// A vault whose reader is a module the person named: a file that exports openVault({ path }),
// returning a vault that answers the contract. Cortex imports nothing from any vault; it loads the
// file the person chose, the first time it asks the vault anything, so vaultFrom stays synchronous.
// The module is the person's choice and runs as cortex does; cortex still only reads through it.
export function moduleVault({ module, path }) {
  let opened;
  const open = () => (opened ??= (async () => {
    let loaded;
    try {
      loaded = await import(pathToFileURL(module).href);
    } catch (problem) {
      throw new Refused('VaultUnreachable', `The vault reader ${module} cannot be loaded: ${problem.message}`);
    }
    if (typeof loaded.openVault !== 'function') throw new Refused('InvalidVault', `${module} does not export openVault({ path })`);
    return checkVault(await loaded.openVault({ path }));
  })().catch(problem => { opened = undefined; throw problem; }));
  const ask = operation => async (...args) => (await open())[operation](...args);
  return checkVault({
    kind: 'module',
    ...Object.fromEntries(OPERATIONS.map(operation => [operation, ask(operation)])),
    async search(...args) {
      const vault = await open();
      return vault.search ? vault.search(...args) : [];
    },
  });
}

// Which vault a cortex reads is set by the person, in .cortex/vault.json: a folder of Markdown
// files, which this file reads itself, or a folder with the module that reads it, such as the vault's
// own { kind: 'module', module: '/…/ohmmmm/vault/vault/cortex.mjs', path: '/…/ohmmmm.alice/vault' }.
// A cortex in a home (ohmmmm.<handle>/cortex) with nothing set reads the home's vault that way.
export function vaultFrom(config) {
  if (!config) return null;
  if (config.kind === 'folder' && typeof config.path === 'string' && config.path) return folderVault(config.path);
  if (config.kind === 'module') {
    if (typeof config.module !== 'string' || !isAbsolute(config.module)) throw new Refused('InvalidVault', 'A vault of kind module names its reader by its absolute path, as module');
    if (typeof config.path !== 'string' || !isAbsolute(config.path)) throw new Refused('InvalidVault', 'A vault of kind module names its folder by its absolute path, as path');
    return moduleVault(config);
  }
  throw new Refused('InvalidVault', `This cortex cannot open a vault of kind ${config.kind}`);
}

// This vault as cortex reads a vault: the vault reader contract, ../../contract/vault-reader.mjs.
//
//   shape()          { blocks, channels: [{ channel, blocks }], problems? }
//   read(id)         { id, title, channel, body } or null
//   exists(ids)      { [id]: { exists, channel, title } }
//   changes(cursor)  { changes: [{ type, id, title, channel, from?, new? }], cursor }
//   profile()        [{ field, value, source }]
//   search(words, limit)  [{ id, title, channel }]
//
// Cortex never writes to a vault, so this reader writes nothing either: not the index, not the
// journal, not the cache. It reads the folder and its roots itself, as cortex's own folder reader
// does, keeping each file's text in memory and reading a file again only when its size or times
// change. It needs no database, so it runs on any Node cortex runs on.
//
// It follows cortex's folder reader wherever the two could differ, so a cortex that read this folder
// before keeps everything it remembers: a block without an id property is `path:<file>`, a file at the
// top of the vault is in the channel `other`, and a cursor has the same shape and the same hashes.
// What it adds: only blocks are blocks (not _channel.md, entities or sources), and the blocks of
// read-only roots are included.
//
// Cortex loads it by itself for the vault in the same home (ohmmmm.<handle>/vault), or by the path
// the person gave: `cortex vault connect ~/Vault --module <this file>`, which calls openVault({ path }).
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ending, rootBlocks, stampOf, walk } from './indexer.mjs';
import { words } from './words.mjs';
import { readVault } from './node.mjs';
import { CONFIG, readConfig } from './roots.mjs';
import { ALL } from '../../contract/vault-reader.mjs';

// Every operation of the contract (../../contract/vault-reader.mjs), the optional search included.
export const OPERATIONS = ALL;
const hashOf = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
// The files of the vault folder that hold nodes: Markdown, and each source's source.json.
const nodeFile = path => /\.md$/i.test(path) || /^_sources\/[^/]+\/source\.json$/.test(path);

export function cortexVault(vault, { home = homedir() } = {}) {
  const held = new Map();
  // A file's text, read again only when its stamp moved since the last time.
  const textOf = async abs => {
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) return null;
    const stamp = stampOf(info);
    if (held.get(abs)?.stamp !== stamp) held.set(abs, { stamp, text: await readFile(abs, 'utf8'), size: info.size, mtime: info.mtimeMs });
    return held.get(abs);
  };

  async function blocks() {
    const problems = [];
    let config;
    try {
      config = JSON.parse(await readFile(join(vault, CONFIG), 'utf8'));
    } catch (problem) {
      if (problem.code !== 'ENOENT') problems.push(`${CONFIG} is not JSON`);
    }
    const { roots, problems: said } = readConfig(config, { vault, home });
    problems.push(...said.map(problem => `${CONFIG}: ${problem}`));
    const files = [], nodes = [], where = new Map(), seen = new Set();
    for (const path of await walk(vault, path => nodeFile(path))) {
      const file = await textOf(join(vault, path));
      if (!file) continue;
      seen.add(join(vault, path));
      files.push({ path, text: file.text });
      where.set(path, { text: file.text });
    }
    for (const root of roots) {
      let paths;
      try {
        paths = await walk(root.path, root.takes);
      } catch {
        problems.push(`The root "${root.name}" (${root.path}) cannot be read; its blocks are left out until it can`);
        continue;
      }
      const rows = [];
      for (const path of paths) {
        const abs = join(root.path, path);
        // A reference-only root is never opened: opening a Google Drive file downloads it.
        if (root.retain !== 'reference' && ending(path) === 'md') {
          const file = await textOf(abs);
          if (file) { seen.add(abs); rows.push({ path, abs, text: file.text }); }
        } else {
          const info = await stat(abs).catch(() => null);
          if (info?.isFile()) rows.push({ path, abs, text: null, size: info.size, mtime: info.mtimeMs });
        }
      }
      const made = rootBlocks(root, rows);
      files.push(...made.files);
      nodes.push(...made.nodes);
      for (const [path, row] of made.where) where.set(path, row);
    }
    for (const abs of [...held.keys()]) if (!seen.has(abs)) held.delete(abs);
    const read = readVault(files, { nodes });
    for (const { path, problems: each } of read.problems) problems.push(...each.map(problem => `${path}: ${problem}`));
    const found = new Map();
    for (const node of read.blocks) {
      const id = node.id ?? `path:${node.path}`;
      if (found.has(id)) continue;
      const row = where.get(node.path);
      found.set(id, {
        id, channel: node.home || 'other', body: node.body ?? '',
        title: node.title ?? node.path.split('/').at(-1).replace(/\.md$/i, ''),
        // The same hash cortex's folder reader gives a Markdown file, so its cursors carry over.
        hash: typeof row?.text === 'string' ? hashOf(row.text) : `${row?.size}:${row?.mtime}`,
        words: { title: [node.title, node.slug, ...(node.tags ?? [])].filter(Boolean).join(' '), body: node.body ?? '' },
      });
    }
    return { found, problems };
  }
  const place = block => ({ title: block.title, channel: block.channel });

  return {
    kind: 'ohm-vault',

    async shape() {
      const { found, problems } = await blocks();
      const channels = new Map();
      for (const block of found.values()) {
        // A block counts in its channel and in each channel around it.
        const parts = block.channel.split('/');
        for (let at = 1; at <= parts.length; at++) {
          const channel = parts.slice(0, at).join('/');
          if (!channels.has(channel)) channels.set(channel, { channel, blocks: 0 });
          channels.get(channel).blocks += 1;
        }
      }
      return { blocks: found.size, channels: [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)), ...(problems.length ? { problems } : {}) };
    },

    async read(id) {
      const block = (await blocks()).found.get(id);
      return block ? { id: block.id, ...place(block), body: block.body } : null;
    },

    async exists(ids) {
      const { found } = await blocks();
      return Object.fromEntries([...new Set(ids)].map(id => [id, found.has(id) ? { exists: true, ...place(found.get(id)) } : { exists: false }]));
    },

    async changes(cursor) {
      const next = Object.fromEntries([...(await blocks()).found.values()].map(block => [block.id, { ...place(block), hash: block.hash }]));
      if (!cursor || typeof cursor !== 'object') return { changes: [], cursor: next };
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

    // The vault holds no facts about the person; those are cortex's identity.md.
    profile: async () => [],

    // Ranked as the index ranks: how many of the words a block holds, then a word in its title, slug
    // or tags counting two and in its text one.
    async search(query, limit = 10) {
      const most = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
      const wanted = [...new Set(words(Array.isArray(query) ? query.join(' ') : String(query ?? '')))];
      if (!wanted.length) return [];
      const scored = [];
      for (const block of (await blocks()).found.values()) {
        const title = new Set(words(block.words.title)), body = new Set(words(block.words.body));
        let matched = 0, weight = 0;
        for (const word of wanted) {
          if (title.has(word) || body.has(word)) matched++;
          weight += (title.has(word) ? 2 : 0) + (body.has(word) ? 1 : 0);
        }
        if (matched) scored.push({ matched, weight, block });
      }
      scored.sort((a, b) => b.matched - a.matched || b.weight - a.weight || a.block.title.localeCompare(b.block.title));
      return scored.slice(0, most).map(({ block }) => ({ id: block.id, ...place(block) }));
    },
  };
}

// What cortex calls when .cortex/vault.json says { kind: "module", module: <this file>, path }.
export function openVault({ path }) {
  if (typeof path !== 'string' || !path) throw new Error('Say which vault folder, as path');
  return cortexVault(resolve(path));
}

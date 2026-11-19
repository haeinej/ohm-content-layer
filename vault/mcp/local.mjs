// Tools for a vault folder the person chose when launching the local stdio process.
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { addToVault } from '../vault/add.mjs';
import { VaultProblem } from '../vault/core.mjs';
import { setProperty } from '../vault/file.mjs';
import { CACHE, INDEX, inspect, openIndex, scan, search, summary } from '../vault/indexer.mjs';
import { appendEvents, JOURNAL } from '../vault/journal.mjs';
import { CHANNEL_FILE, EDGE_KINDS, isChannelPath, nodeFile, readNode, SOURCES } from '../vault/node.mjs';
import { CANONICAL, CONFIG, readConfig } from '../vault/roots.mjs';
import { createServer, serve } from './protocol.mjs';

const text = { type: 'string' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const tool = (name, description, properties, required = [], readOnlyHint = false) => ({
  name, description, inputSchema: { type: 'object', properties, required },
  ...(readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
});

export const LOCAL_TOOLS = [
  tool('vault_local_search', 'Search the local vault index by words.', { query: text, limit: integer(1, 50) }, ['query'], true),
  tool('vault_local_read', 'Read a local vault node with file stats and journal history.', { ref: text }, ['ref'], true),
  tool('vault_neighbors', 'Follow evidence from a local vault node. Filter by direction and kind, up to five steps away.', {
    ref: text, direction: { enum: ['in', 'out', 'both'] }, kind: { enum: EDGE_KINDS }, depth: integer(1, 5),
  }, ['ref'], true),
  tool('vault_capture', 'Propose a block from an HTTP(S) address or a file from a configured root. An address is kept as a reference.', {
    source: text, channel: text, title: text,
  }, ['source']),
  tool('vault_collect', 'File a local block in a channel, or move it to a zero-based position in the channel’s explicit order.', {
    block: text, channel: text, position: { type: 'integer', minimum: 0 },
  }, ['block', 'channel']),
  tool('vault_index', 'Scan the local vault and its configured roots. Returns what changed and any problems.', {}),
];

const refuse = message => { throw new VaultProblem(message); };
const present = value => typeof value === 'string' && value.trim() && !value.includes('\0');
const info = path => lstat(path).catch(problem => { if (problem.code !== 'ENOENT') throw problem; });

// Resolve vault files without following symlinks in the path, including the index and journal.
async function beneath(root, parts) {
  let path = root;
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\')) refuse('Give a path inside the vault or a configured root.');
    path = join(path, part);
    const item = await info(path);
    if (item && (item.isSymbolicLink() || (index < parts.length - 1 && !item.isDirectory()))) {
      refuse('Choose a path with ordinary folders and files, without symlinks.');
    }
  }
  return path;
}

async function ordinaryFile(root, parts) {
  const path = await beneath(root, parts);
  const item = await info(path);
  if (item && !item.isFile()) refuse('Choose an ordinary file.');
  return path;
}

async function captureSource(vault, source) {
  if (!present(source)) refuse('Give an HTTP(S) address or the absolute path of a file in a configured root.');
  if (URL.canParse(source)) {
    const url = new URL(source);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  }
  if (!isAbsolute(source)) refuse('Give an HTTP(S) address or the absolute path of a file in a configured root.');
  const configPath = await ordinaryFile(vault, CONFIG.split('/'));
  const config = await readFile(configPath, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  const { roots } = readConfig(config && JSON.parse(config), { vault, home: homedir() });
  for (const root of roots) {
    const path = relative(root.path, source);
    const parts = path.split(sep);
    if (!path || isAbsolute(path) || parts.some(part => part.startsWith('.') || part === 'node_modules')
      || root.retain === 'reference' || !root.takes(parts.join('/'))) continue;
    const file = await ordinaryFile(await realpath(root.path), parts);
    if ((await info(file))?.isFile()) return file;
  }
  refuse('Choose a file that a configured root keeps as text or full.');
}

const lookedUp = (db, ref) => {
  if (!present(ref) || ref.length > 1000) refuse('Give a node key, slug, or a path in the vault.');
  return inspect(db, ref) ?? refuse('No indexed node matches. Run vault_index if the vault has changed.');
};

function neighbors(db, { ref, direction = 'both', kind, depth = 1 }) {
  if (!['in', 'out', 'both'].includes(direction) || (kind !== undefined && !EDGE_KINDS.includes(kind))
    || !Number.isInteger(depth) || depth < 1 || depth > 5) refuse('Use in, out, or both, an evidence kind, and a depth from 1 to 5.');
  const node = lookedUp(db, ref).key;
  const seen = new Set([node]);
  const edges = new Map();
  let frontier = [node];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next = [];
    for (const key of frontier) {
      const found = inspect(db, key);
      if (!found) continue;
      for (const way of direction === 'both' ? ['out', 'in'] : [direction]) {
        for (const edge of found[way]) {
          if (kind !== undefined && edge.kind !== kind) continue;
          const [from, to] = way === 'out' ? [key, edge.node] : [edge.node, key];
          const value = { from, to, kind: edge.kind, at: edge.at };
          const id = JSON.stringify(value);
          if (!edges.has(id) && edges.size === 200) return { node, edges: [...edges.values()], truncated: true };
          edges.set(id, value);
          if (!seen.has(edge.node)) { seen.add(edge.node); next.push(edge.node); }
        }
      }
    }
    frontier = next;
  }
  return { node, edges: [...edges.values()] };
}

async function replaceFile(path, before, after) {
  const temp = join(dirname(path), `.collect-${randomUUID()}`);
  if (before === undefined) {
    await writeFile(path, after, { flag: 'wx' });
    return;
  }
  try {
    await writeFile(temp, after, { flag: 'wx', mode: (await lstat(path)).mode & 0o777 });
    if (await readFile(path, 'utf8') !== before) refuse('The file changed while collecting. Try again.');
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  }
}

// SQLite releases this lock even if a local MCP process exits during collection.
async function withCollectLock(vault, DatabaseSync, collect) {
  const path = await ordinaryFile(vault, ['.vault', 'collect.sqlite']);
  const lock = new DatabaseSync(path);
  try {
    try {
      lock.exec('BEGIN IMMEDIATE');
    } catch (problem) {
      if (problem.errcode === 5) refuse('Another collection is running in this vault. Try again.');
      throw problem;
    }
    return await collect();
  } finally {
    lock.close();
  }
}

export function createLocalTools({ vault, by, DatabaseSync }) {
  const rescan = db => scan({ vault, db });
  const recordChange = async (path, before, after) => {
    if (before === after) return;
    await replaceFile(join(vault, path), before, after);
    await appendEvents(vault, [{ at: new Date().toISOString(), op: before === undefined ? 'added' : 'changed', root: CANONICAL, path, by, via: 'collect' }]);
  };
  const calls = {
    vault_local_search: (db, { query, limit = 20 }) => {
      if (!present(query) || query.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 50) refuse('Give up to 1,000 characters of search text and a limit from 1 to 50.');
      return { nodes: search(db, query, { limit }) };
    },
    vault_local_read: (db, { ref }) => lookedUp(db, ref),
    vault_neighbors: neighbors,
    vault_index: rescan,

    async vault_capture(db, { source, channel = 'inbox', title }) {
      if (!isChannelPath(channel)) refuse('Give the channel’s path.');
      if (title !== undefined && !present(title)) refuse('Give a title as text.');
      await beneath(vault, channel.split('/'));
      if (channel === 'inbox') await ordinaryFile(vault, ['inbox', CHANNEL_FILE]);
      await beneath(vault, [SOURCES]);
      const added = await addToVault({ vault, source: await captureSource(vault, source), channel, title, by });
      await rescan(db);
      return { ...added, node: lookedUp(db, added.block).key, status: 'proposed' };
    },

    async vault_collect(db, { block, channel, position }) {
      if (!isChannelPath(channel) || (position !== undefined && (!Number.isSafeInteger(position) || position < 0))) {
        refuse('Give the channel’s path and, optionally, a zero-based position in its order.');
      }
      const prior = lookedUp(db, block);
      if (prior.root !== CANONICAL || prior.node.type !== 'block') refuse('Choose a block in the canonical vault. Capture a copy first if it is in a read-only root.');
      const channelPath = `${channel}/${CHANNEL_FILE}`;
      const target = await ordinaryFile(vault, channelPath.split('/'));
      const blockPath = prior.node.path;
      const source = await ordinaryFile(vault, blockPath.split('/'));
      const before = await readFile(source, 'utf8');
      const node = readNode(blockPath, before)?.node;
      if (node?.type !== 'block' || node.slug !== prior.node.slug || node.id !== prior.node.id) refuse('The block changed. Run vault_index and try again.');
      const held = await readFile(target, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
      const parsed = held === undefined ? null : readNode(channelPath, held);
      if (held !== undefined && (parsed?.node?.type !== 'channel' || parsed.problems.length)) refuse('Fix the channel file before collecting blocks in it.');
      const previousOrder = parsed?.node.order ?? [];
      const order = previousOrder.filter(slug => slug !== node.slug);
      const oldPosition = previousOrder.indexOf(node.slug);
      order.splice(position ?? (oldPosition === -1 ? order.length : oldPosition), 0, node.slug);
      const needsMembership = node.home !== channel && !node.channels.includes(channel);
      const nextBlock = needsMembership ? setProperty(before, 'channels', [...node.channels, channel]) : before;
      const nextChannel = held === undefined ? nodeFile({ type: 'channel', path: channel, order }).text
        : JSON.stringify(order) === JSON.stringify(previousOrder) ? held : setProperty(held, 'order', order);
      await mkdir(dirname(target), { recursive: true });
      await recordChange(blockPath, before, nextBlock);
      await recordChange(channelPath, held, nextChannel);
      await rescan(db);
      return { block: prior.key, channel, order, unchanged: nextBlock === before && nextChannel === held };
    },
  };
  return {
    async call(name, args = {}) {
      if (!Object.hasOwn(calls, name)) refuse(`There is no tool named ${name}`);
      for (const path of [CONFIG, JOURNAL, INDEX, `${INDEX}-wal`, `${INDEX}-shm`]) {
        await ordinaryFile(vault, path.split('/'));
      }
      await beneath(vault, CACHE.split('/'));
      const db = await openIndex(vault, { DatabaseSync });
      try {
        if (['vault_local_search', 'vault_local_read', 'vault_neighbors', 'vault_collect'].includes(name) && !summary(db).scanned) {
          refuse('Run vault_index to scan this vault first.');
        }
        const invoke = () => calls[name](db, args);
        return await (name === 'vault_collect' ? withCollectLock(vault, DatabaseSync, invoke) : invoke());
      } finally {
        db.close();
      }
    },
  };
}

export async function serveLocalVault({ vault, agent, DatabaseSync, input, output }) {
  if (!vault) refuse('Launch from a home or select its vault with --vault.');
  if (!/^[A-Za-z0-9._-]+$/.test(agent)) refuse('Name the agent with letters, digits, dots, underscores or hyphens.');
  if (!(await info(vault))?.isDirectory()) refuse('Select an existing vault folder.');
  const tools = createLocalTools({ vault: await realpath(vault), by: `agent:${agent}`, DatabaseSync });
  const instructions = 'These tools read the vault folder and its configured roots on this device. Run vault_index to refresh the index. Captures are proposed and collecting files them in channels. Both changes are journaled. Use with a client you trust to read the local vault.';
  input.setEncoding('utf8');
  await serve(createServer({ tools, list: LOCAL_TOOLS, instructions }), input, output);
}

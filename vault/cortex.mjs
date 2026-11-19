// This vault as ohm-cortex reads a vault: the contract in ohm-cortex's src/vault.mjs, answered from
// the index. Cortex only reads through it; nothing here changes a file.
//
//   shape()          { blocks, channels: [{ channel, blocks }], problems? }
//   read(id)         { id, title, channel, body } or null
//   exists(ids)      { [id]: { exists, channel, title } }
//   changes(cursor)  { changes: [{ type, id, title, channel, from?, new? }], cursor }
//   profile()        [{ field, value, source }]
//   search(words, limit)  [{ id, title, channel }]
//
// It follows cortex's own folder vault wherever the two could differ, so a cortex that read this
// folder before keeps everything it remembers: a block without an id property is `path:<file>`, a
// file at the top of the vault is in the channel `other`, and a cursor has the same shape and the
// same hashes. What it adds: only blocks are blocks (not _channel.md, entities or sources), and the
// blocks of read-only roots are included.
import { createHash } from 'node:crypto';
import { CANONICAL } from './roots.mjs';
import { openIndex, scan, search as searchIndex } from './indexer.mjs';

export const OPERATIONS = ['shape', 'read', 'exists', 'changes', 'profile', 'search'];
const hashOf = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

//   vault: the vault's absolute path; DatabaseSync: node:sqlite's class
//   fresh: bring the index up to date before each answer, as cortex's folder vault reads the folder
//          each time. Only files whose size or times changed are read again
export function cortexVault(vault, { DatabaseSync, fresh = true, home } = {}) {
  let db;
  const ready = async () => {
    db ??= await openIndex(vault, { DatabaseSync });
    if (fresh) await scan({ vault, db, ...(home ? { home } : {}) });
    return db;
  };
  const blocks = async () => {
    const rows = (await ready()).prepare(`SELECT n.node, n.root, n.file, n.title, f.text, f.hash, f.size, f.mtime
      FROM nodes n LEFT JOIN files f ON f.root = n.root AND f.path = n.file WHERE n.type = 'block' ORDER BY n.path`).all();
    const found = new Map();
    for (const row of rows) {
      const node = JSON.parse(row.node);
      const id = node.id ?? `path:${node.path}`;
      if (found.has(id)) continue;
      found.set(id, {
        id, channel: node.home || 'other', body: node.body ?? '',
        title: node.title ?? node.path.split('/').at(-1).replace(/\.md$/i, ''),
        // The same hash cortex's folder vault gives a Markdown file, so its cursors carry over.
        hash: row.text !== null && row.text !== undefined ? hashOf(row.text) : row.hash ?? `${row.size}:${row.mtime}`,
      });
    }
    return found;
  };
  const place = block => ({ title: block.title, channel: block.channel });

  return {
    kind: 'ohm-vault',

    async shape() {
      const all = [...(await blocks()).values()];
      const channels = new Map();
      for (const block of all) {
        // A block counts in its channel and in each channel around it.
        const parts = block.channel.split('/');
        for (let at = 1; at <= parts.length; at++) {
          const channel = parts.slice(0, at).join('/');
          if (!channels.has(channel)) channels.set(channel, { channel, blocks: 0 });
          channels.get(channel).blocks += 1;
        }
      }
      const problems = db.prepare('SELECT root, path, problem FROM problems ORDER BY root, path').all()
        .map(row => `${row.root === CANONICAL ? '' : `${row.root}: `}${row.path}: ${row.problem}`);
      return { blocks: all.length, channels: [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)), ...(problems.length ? { problems } : {}) };
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
      const next = Object.fromEntries([...(await blocks()).values()].map(block => [block.id, { ...place(block), hash: block.hash }]));
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

    // The vault holds no facts about the person yet; that is the cortex's identity.md.
    profile: async () => [],

    async search(words, limit = 10) {
      const most = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
      const all = await blocks();
      const ids = new Map([...all.values()].map(block => [block.id, block]));
      const hits = searchIndex(db, Array.isArray(words) ? words.join(' ') : String(words ?? ''), { limit: most * 4 })
        .filter(hit => hit.type === 'block');
      const out = [];
      for (const hit of hits) {
        const node = JSON.parse(db.prepare('SELECT node FROM nodes WHERE key = ?').get(hit.key).node);
        const block = ids.get(node.id ?? `path:${node.path}`);
        if (block && !out.some(each => each.id === block.id)) out.push({ id: block.id, ...place(block) });
        if (out.length === most) break;
      }
      return out;
    },

    close() {
      db?.close();
      db = undefined;
    },
  };
}

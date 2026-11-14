// The vault contract: what cortex needs from a vault, so any vault can sit beside a cortex. Cortex
// only reads through it. Saving content is the vault's own job, done by the agent through the
// vault's own API on the person's say-so.
//
//   shape()          the sections and subsections, with counts, and any problems reading the vault
//   read(id)         one post: { id, title, label, sublabel, body }, or null
//   exists(ids)      for each of a list of IDs, whether the post is still there, and where:
//                    { [id]: { exists, label, sublabel, title } }. One call, so a vault is read once
//                    however many posts the memories point at
//   changes(cursor)  what was saved, moved or removed since a cursor an earlier call returned:
//                    { changes: [{ type, id, title, label, sublabel, from? }], cursor }. With no
//                    cursor, it returns none and a cursor to start from
//   profile()        identity facts the vault itself holds: [{ field, value, source }]
//
// A cursor is the vault's own: cortex keeps it and hands it back, and never looks inside.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Refused, splitFront } from './core.mjs';

export const OPERATIONS = ['shape', 'read', 'exists', 'changes', 'profile'];

export function checkVault(vault) {
  const missing = OPERATIONS.filter(operation => typeof vault?.[operation] !== 'function');
  if (missing.length) throw new Refused('InvalidVault', `A vault answers ${OPERATIONS.join(', ')}. This one is missing ${missing.join(', ')}`);
  return vault;
}

// A section is a label, or a label and a sublabel, written as `label/sublabel`.
export const sectionOf = ({ label, sublabel }) => sublabel ? `${label}/${sublabel}` : label;

// A vault kept as a folder of Markdown files: <label>/<post>.md or <label>/<sublabel>/<post>.md.
// A post's ID is its `id` property; a file without one is known by its path, so moving it reads as
// removing one post and saving another. A file at the top of the folder is filed under `other`.
export function folderVault(root) {
  const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

  let problems = [];
  async function posts() {
    const found = new Map();
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
          const text = await readFile(join(root, path), 'utf8');
          const { properties, body } = splitFront(text);
          const parts = path.split(sep);
          const [label, sublabel] = parts.length === 1 ? ['other'] : parts.length === 2 ? [parts[0]] : [parts[0], parts.slice(1, -1).join('-')];
          const id = typeof properties.id === 'string' && properties.id.trim() ? properties.id.trim() : `path:${parts.join('/')}`;
          // Two files with one ID: the first stands, and the clash is reported so the person can fix it.
          if (found.has(id)) { problems.push(`${found.get(id).path} and ${parts.join('/')} have the same id, ${id}. Only the first is read`); continue; }
          found.set(id, { id, title: typeof properties.title === 'string' && properties.title.trim() ? properties.title.trim() : entry.name.slice(0, -3), label, ...(sublabel ? { sublabel } : {}), body, path: relative(root, join(root, path)), hash: hash(text) });
        }
      }
    }
    await walk('');
    return found;
  }

  const place = post => ({ title: post.title, label: post.label, ...(post.sublabel ? { sublabel: post.sublabel } : {}) });

  return checkVault({
    kind: 'folder',

    async shape() {
      const all = [...(await posts()).values()];
      const sections = new Map();
      for (const post of all) {
        for (const key of post.sublabel ? [post.label, sectionOf(post)] : [post.label]) {
          if (!sections.has(key)) sections.set(key, { section: key, posts: 0 });
          sections.get(key).posts += 1;
        }
      }
      return { posts: all.length, sections: [...sections.values()].sort((a, b) => a.section.localeCompare(b.section)), ...(problems.length ? { problems: [...problems] } : {}) };
    },

    async read(id) {
      const post = (await posts()).get(id);
      return post ? { id: post.id, ...place(post), body: post.body } : null;
    },

    async exists(ids) {
      const all = await posts();
      return Object.fromEntries([...new Set(ids)].map(id => [id, all.has(id) ? { exists: true, ...place(all.get(id)) } : { exists: false }]));
    },

    async changes(cursor) {
      const now = await posts();
      const next = Object.fromEntries([...now.values()].map(post => [post.id, { ...place(post), hash: post.hash }]));
      if (!cursor || typeof cursor !== 'object') return { changes: [], cursor: next };
      const changes = [];
      for (const [id, was] of Object.entries(cursor)) {
        const post = next[id];
        const { hash: _, ...where } = was;
        if (!post) changes.push({ type: 'removed', id, ...where });
        else if (sectionOf(post) !== sectionOf(was)) changes.push({ type: 'moved', id, ...place(post), from: sectionOf(was) });
        else if (post.hash !== was.hash) changes.push({ type: 'saved', id, ...place(post) });
      }
      for (const [id, post] of Object.entries(next)) if (!cursor[id]) changes.push({ type: 'saved', id, ...place(post), new: true });
      return { changes, cursor: next };
    },

    profile: async () => [],
  });
}

// Which vault a cortex reads is set by the person, in .cortex/vault.json. Kinds other than a folder
// are provided by their host, such as ohm, and passed in; this file knows only the folder kind.
export function vaultFrom(config) {
  if (!config) return null;
  if (config.kind === 'folder' && typeof config.path === 'string' && config.path) return folderVault(config.path);
  throw new Refused('InvalidVault', `This cortex cannot open a vault of kind ${config.kind}`);
}

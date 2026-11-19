// The private layer's store: private blocks as `{ id, ciphertext, version }`, which the service
// keeps and cannot read (plans/encryption.md, "The two stores").
//
// - `id` is opaque: chosen on the member's device, it says nothing about the block. Its path, title,
//   channels and text are all inside the ciphertext.
// - `ciphertext` is a sealed file as ohm-onboarding's packages/keys makes it: `{ v, alg, generation?,
//   key: { iv, ciphertext }, data: { iv, ciphertext } }`, every value base64url. The service checks
//   that shape and nothing else, so readable text sent by mistake is refused rather than kept.
// - `version` is computed over the ciphertext, and every write and removal names the version it
//   replaces, checked in the same statement that makes the change. Two devices never overwrite each
//   other unseen, and the service needs to read nothing to say which write is stale.
//
// The member's keys are not here: they are on the member's devices, and the account app keeps only
// wrapped copies. `db` has the shape of a Cloudflare D1 database.
import { Refused } from './store.mjs';

const PAGE = 1000;
// A block can be 600 KB of text; sealed and written as base64url it is a third larger, with room.
const LARGEST = 1_000_000;
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

const encoder = new TextEncoder();
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

// A version names exactly one ciphertext.
export async function privateVersion(ciphertext) {
  return `pv_${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(ciphertext)))).slice(0, 32)}`;
}

const refuse = message => { throw new Refused(400, 'InvalidBlock', message); };
const opaqueId = id => (typeof id === 'string' && ID.test(id) ? id : refuse('A private block is named by an opaque ID: 16 to 64 letters, digits, - or _'));

const sealedPart = (part, name) => {
  if (!part || typeof part !== 'object' || Array.isArray(part)) refuse(`${name} is { iv, ciphertext }`);
  const { iv, ciphertext, ...more } = part;
  if (Object.keys(more).length) refuse(`${name} has only iv and ciphertext`);
  if (typeof iv !== 'string' || iv.length !== 16 || !B64URL.test(iv)) refuse(`${name}.iv is a 12-byte nonce in base64url`);
  if (typeof ciphertext !== 'string' || ciphertext.length < 22 || !B64URL.test(ciphertext)) refuse(`${name}.ciphertext is base64url, with its tag`);
};

// The sealed file, checked for shape only, and kept as the exact text it was sent as.
export function sealedBlock(given) {
  const { id, ciphertext, ...more } = given ?? {};
  if (Object.keys(more).length) refuse(`A private block is sent as id and ciphertext, and nothing else: ${Object.keys(more).join(', ')}`);
  opaqueId(id);
  if (!ciphertext || typeof ciphertext !== 'object' || Array.isArray(ciphertext)) refuse('ciphertext is the sealed file, as an object');
  const { v, alg, generation = 1, key, data, ...extra } = ciphertext;
  if (Object.keys(extra).length) refuse(`A sealed file has v, alg, generation, key and data, and nothing else: ${Object.keys(extra).join(', ')}. Private text is never sent readable`);
  if (v !== 1 || alg !== 'A256GCM') refuse('A sealed file is { v: 1, alg: "A256GCM" }');
  if (!Number.isSafeInteger(generation) || generation < 1) refuse('generation is a whole number from 1');
  sealedPart(key, 'key');
  if (key.ciphertext.length !== 64) refuse('key.ciphertext is a wrapped 32-byte file key and its tag');
  sealedPart(data, 'data');
  const text = JSON.stringify({ v, alg, ...(generation === 1 ? {} : { generation }), key: { iv: key.iv, ciphertext: key.ciphertext }, data: { iv: data.iv, ciphertext: data.ciphertext } });
  if (encoder.encode(text).length > LARGEST) throw new Refused(413, 'TooLarge', 'A private block can be at most 1 MB sealed');
  return { id, text, generation };
}

export function privateStore(db) {
  const current = (did, id) => db.prepare('SELECT version, ciphertext, generation, seq FROM private_blocks WHERE did = ?1 AND id = ?2').bind(did, id).first();
  const next = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM private_blocks WHERE did = ?1)';
  const changed = (id, held) => new Refused(409, 'Changed', 'The private block has changed since the version this request names', { id, current: held?.version ?? null });
  const row = held => ({ ciphertext: JSON.parse(held.ciphertext), version: held.version });

  return {
    // Every private block, or with `since`, what changed after that point, removals included. Only
    // IDs, versions, sizes and generations: what the service can know without reading anything.
    async list(did, { since, below } = {}) {
      const after = since === undefined ? 0 : Number(since);
      if (!Number.isSafeInteger(after) || after < 0) throw new Refused(400, 'InvalidCursor', 'since is a value an earlier list returned');
      const under = below === undefined ? null : Number(below);
      if (under !== null && (!Number.isSafeInteger(under) || under < 1)) throw new Refused(400, 'InvalidRequest', 'below is a generation, a whole number from 1');
      const { results } = await db.prepare(
        `SELECT id, version, generation, size, seq FROM private_blocks
         WHERE did = ?1 AND seq > ?2 ${since === undefined ? 'AND version IS NOT NULL' : ''} ${under === null ? '' : 'AND (version IS NULL OR generation < ?3)'}
         ORDER BY seq LIMIT ${PAGE + 1}`,
      ).bind(did, after, under).all();
      const page = results.slice(0, PAGE);
      const latest = page.length ? page.at(-1).seq
        : since !== undefined ? after
        : (await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM private_blocks WHERE did = ?1').bind(did).first()).seq;
      return {
        blocks: page.map(each => (each.version === null ? { id: each.id, removed: true } : { id: each.id, version: each.version, generation: each.generation, size: each.size })),
        cursor: String(latest),
        ...(results.length > PAGE ? { more: true } : {}),
      };
    },

    async read(did, id) {
      const held = await current(did, opaqueId(id));
      if (!held || held.version === null) throw new Refused(404, 'NotFound', 'There is no such private block');
      return { id, ...row(held) };
    },

    // Compare-and-swap: `replaces` is the version being replaced, and nothing for a new block.
    async write(did, given, { replaces = null, now = new Date() } = {}) {
      const { id, text, generation } = sealedBlock(given);
      const version = await privateVersion(text);
      const held = await current(did, id);
      const was = held?.version ?? null;
      if (was === version) return { id, version, unchanged: true };
      if (was !== replaces) throw changed(id, held);
      const written = await db.prepare(
        `INSERT INTO private_blocks (did, id, version, ciphertext, generation, size, seq, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${next}, ?7, ?7)
         ON CONFLICT (did, id) DO UPDATE SET version = excluded.version, ciphertext = excluded.ciphertext, generation = excluded.generation,
           size = excluded.size, seq = excluded.seq, updated_at = excluded.updated_at
         WHERE private_blocks.version IS ?8
         RETURNING seq`,
      ).bind(did, id, version, text, generation, encoder.encode(text).length, now.toISOString(), replaces).first();
      if (!written) throw changed(id, await current(did, id));
      return { id, version };
    },

    async remove(did, id, { replaces = null, now = new Date() } = {}) {
      const held = await current(did, opaqueId(id));
      if (!held || held.version === null) return { id, removed: true, unchanged: true };
      if (held.version !== replaces) throw changed(id, held);
      const gone = await db.prepare(
        `UPDATE private_blocks SET version = NULL, ciphertext = NULL, generation = NULL, size = NULL, seq = ${next}, updated_at = ?3
         WHERE did = ?1 AND id = ?2 AND version IS ?4 RETURNING seq`,
      ).bind(did, id, now.toISOString(), replaces).first();
      if (!gone) throw changed(id, await current(did, id));
      return { id, removed: true };
    },
  };
}

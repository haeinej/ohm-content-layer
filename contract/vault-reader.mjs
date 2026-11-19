// The vault reader contract: what a cortex needs from a vault, and all it may ask. One copy, used by
// both sides: cortex checks a vault against it (cortex/src/vault.mjs), and the vault's own reader
// says it answers it (vault/vault/cortex.mjs).
//
// A vault holds blocks: one unit of thought each, and a published one is a post. Blocks are
// gathered in channels, ordered collections; a block can be in more than one. A block's ID is its
// `id` property (a 13-character TID); a block without one is known as `path:<file>`. A channel is
// named by its path, such as `essays` or `notes/reading`.
//
//   shape()          { blocks, channels: [{ channel, blocks }], problems? }
//   read(id)         one block: { id, title, channel, body }, or null
//   exists(ids)      { [id]: { exists, channel, title } }, in one call
//   changes(cursor)  { changes: [{ type, id, title, channel, from? }], cursor }. With no cursor, it
//                    returns none and a cursor to start from. A cursor is the vault's own
//   profile()        identity facts the vault itself holds: [{ field, value, source }]
//   search(words, limit)  optional: [{ id, title, channel }], best first
//
// A reader only reads. It never writes a block, the journal, the index or a cache. Saving content
// is the vault's own job, through the vault's own tools, on the person's say-so.
//
// A reader reads the folder on the person's own machine. A private block is plain text only there,
// decrypted on the device (vault/plans/encryption.md); no service can hand cortex anything private.

export const REQUIRED = Object.freeze(['shape', 'read', 'exists', 'changes', 'profile']);
// Operations a vault may leave out. Cortex does without what they would answer.
export const OPTIONAL = Object.freeze(['search']);
export const ALL = Object.freeze([...REQUIRED, ...OPTIONAL]);

// What is wrong with a vault, as a list of problems; empty when it answers the contract.
export function contractProblems(vault) {
  const problems = [];
  const missing = REQUIRED.filter(operation => typeof vault?.[operation] !== 'function');
  if (missing.length) problems.push(`A vault answers ${REQUIRED.join(', ')}. This one is missing ${missing.join(', ')}`);
  const wrong = OPTIONAL.filter(operation => vault?.[operation] !== undefined && typeof vault[operation] !== 'function');
  if (wrong.length) problems.push(`${wrong.join(', ')} is an operation; leave it out if this vault does not answer it`);
  return problems;
}

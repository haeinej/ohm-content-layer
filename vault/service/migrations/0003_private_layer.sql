-- The private layer: private blocks, kept only as ciphertext the service cannot open.
-- Additive: nothing existing changes. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0003_private_layer.sql
CREATE TABLE IF NOT EXISTS private_blocks (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  ciphertext TEXT,
  generation INTEGER,
  size INTEGER,
  seq INTEGER NOT NULL,
  -- The kept version that is this block's contents now.
  rev INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS private_blocks_changes ON private_blocks (did, seq);

-- Every version of each private block, as ciphertext, under a `rev` that never changes, so a device
-- can restore any of them. Written in the same batch as the change that makes it.
CREATE TABLE IF NOT EXISTS private_block_versions (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  version TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  generation INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, id, rev)
);
CREATE INDEX IF NOT EXISTS private_block_versions_generation ON private_block_versions (did, generation);
-- The private layer's journal: each entry sealed on the device (what changed, to which page, by whom
-- and why are inside), kept in the same batch as the changes it describes.
CREATE TABLE IF NOT EXISTS private_journal (
  did TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, seq)
);
CREATE INDEX IF NOT EXISTS private_journal_generation ON private_journal (did, generation);
-- Batches already applied, by the ID the device gave, with what they answered: sent again, a batch
-- answers the same and changes nothing.
CREATE TABLE IF NOT EXISTS private_batches (
  did TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (did, batch_id)
);
-- Always empty. A statement in a batch that inserts a 0 here fails the CHECK, and so refuses the
-- whole batch: how a version or rotation check stops several changes from half happening.
CREATE TABLE IF NOT EXISTS private_guard (ok INTEGER NOT NULL CHECK (ok = 1));

-- A member's key rotation, as the private store sees it: `target` is the generation of the master key
-- being rotated to. From the start, a write sealed under an older generation is refused, so no device
-- holding only the old key adds a file the rotation would miss; `finished` is set only when no block
-- is below the target, in the same statement that checks. The row stays after, as the floor.
CREATE TABLE IF NOT EXISTS private_rotations (
  did TEXT PRIMARY KEY,
  target INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('rotating', 'finished')),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

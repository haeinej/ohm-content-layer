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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS private_blocks_changes ON private_blocks (did, seq);

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

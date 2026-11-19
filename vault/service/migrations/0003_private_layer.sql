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

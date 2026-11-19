-- The friends layer: friends-only blocks other than posts, and each member's friend list.
-- Additive: nothing existing changes. Apply once to a database created before it:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0002_friends_layer.sql
CREATE TABLE IF NOT EXISTS blocks (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  path TEXT,
  kind TEXT,
  title TEXT,
  text TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS blocks_changes ON blocks (did, seq);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_path ON blocks (did, path) WHERE version IS NOT NULL;
CREATE TABLE IF NOT EXISTS friends (
  did TEXT NOT NULL,
  friend TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (did, friend)
);
CREATE INDEX IF NOT EXISTS friends_of ON friends (friend);

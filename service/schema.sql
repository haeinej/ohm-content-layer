-- The vault service's storage. One row for each post a member has. A post's ID is given once, when
-- it is made, and is what the row is known by; its slug, label and everything else can change. A
-- removed post keeps its row with no version, so a client asking "what changed since" is told
-- that it went.
CREATE TABLE IF NOT EXISTS posts (
  did TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT,
  slug TEXT,
  label TEXT,
  sublabel TEXT,
  visibility TEXT,
  title TEXT,
  form TEXT,
  date TEXT,
  problems TEXT,
  post TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (did, id)
);
CREATE INDEX IF NOT EXISTS posts_changes ON posts (did, seq);
-- A slug is the end of a post's address, so it is used once in a vault. The database refuses a second.
CREATE UNIQUE INDEX IF NOT EXISTS posts_slug ON posts (did, slug) WHERE version IS NOT NULL;

-- Which AT Protocol account an ohm account works in. Made once, when the person connects their
-- PDS and proves the account is theirs. One ohm account, one AT Protocol account, each way.
CREATE TABLE IF NOT EXISTS links (
  user_id TEXT PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  linked_at TEXT NOT NULL,
  -- When what the account had already published was first brought into the vault. Empty until then.
  mirrored_at TEXT
);

-- The friends layer: blocks a member keeps readable here, so the friends they chose can read them.
-- One row for each block that is not a post (posts stay in `posts`, whose friends-only rows are part
-- of the same layer). A block is kept as the file it is in the member's folder: its path and its
-- text. Private blocks are never kept here; public ones are published as posts. A removed block
-- keeps its row with no version, so "what changed since" can say it went. See plans/encryption.md.
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
-- A path is a file in the member's folder, so it is used once.
CREATE UNIQUE INDEX IF NOT EXISTS blocks_path ON blocks (did, path) WHERE version IS NOT NULL;

-- Who may read a member's friends layer, by DID. The member adds and removes them.
CREATE TABLE IF NOT EXISTS friends (
  did TEXT NOT NULL,
  friend TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (did, friend)
);
CREATE INDEX IF NOT EXISTS friends_of ON friends (friend);

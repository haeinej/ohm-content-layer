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

-- The private layer: private blocks, as ciphertext only (plans/encryption.md, "The two stores").
-- `id` is opaque, chosen on the member's device; paths and names are content and are inside the
-- ciphertext. `ciphertext` is the sealed file (a file key wrapped by the member's master key, and
-- the contents encrypted with it), which the service cannot open. `version` is computed over the
-- ciphertext, so a stale write is refused without reading anything. `generation` says which master
-- key wraps the file key, so a key rotation can find the files it has not re-wrapped yet. A removed
-- block keeps its row with no version, so "what changed since" can say it went.
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

-- Who may read a member's friends layer, by DID. The member adds and removes them.
CREATE TABLE IF NOT EXISTS friends (
  did TEXT NOT NULL,
  friend TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (did, friend)
);
CREATE INDEX IF NOT EXISTS friends_of ON friends (friend);

-- The cortex moved to its own repository (ohm-cortex) and keeps its data in a folder, not here.
-- This removes the MVP cortex tables from a vault database created before that. It is not run
-- automatically: apply it once, when nothing still reads them:
--   wrangler d1 execute ohm-vault --remote --config service/wrangler.deploy.jsonc --file service/migrations/0001_drop_cortex.sql
-- Export first if the rows are worth keeping:
--   wrangler d1 export ohm-vault --remote --config service/wrangler.deploy.jsonc --output cortex-backup.sql
DROP TRIGGER IF EXISTS cortex_preserve_memory;
DROP TABLE IF EXISTS cortex_memory_versions;
DROP TABLE IF EXISTS cortex_memories;
DROP TABLE IF EXISTS cortex_turn_receipts;
DROP TABLE IF EXISTS cortex_turns;
DROP TABLE IF EXISTS cortex_notes;
DROP TABLE IF EXISTS cortex_skills;
DROP TABLE IF EXISTS cortex_tools;

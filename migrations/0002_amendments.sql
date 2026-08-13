-- Payer amendments. Swapping who paid is the one edit that rewrites a row
-- in an otherwise append-only ledger, so the row records that it happened:
-- both members can see an entry was changed and by whom, without the swap
-- costing two extra ledger rows the way a void-and-repost would.
--
-- Both columns are nullable and additive — rows written before this
-- migration read as "never amended", and code that predates it ignores them.

ALTER TABLE expenses ADD COLUMN amended_at INTEGER;
ALTER TABLE expenses ADD COLUMN amended_by TEXT;

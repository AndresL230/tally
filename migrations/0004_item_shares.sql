-- Custom per-item splits. share_cents means: the member named in
-- assigned_to pays exactly this many cents of the item and the other
-- member pays the rest. NULL keeps the old meaning (the whole item, or a
-- half when assigned_to is 'half'), so rows written before this migration
-- and code that predates it are untouched. The server refuses it on a
-- 'half' item and outside 0..price_cents; the column itself stays loose so
-- the migration is a pure ADD.

ALTER TABLE receipt_items ADD COLUMN share_cents INTEGER;

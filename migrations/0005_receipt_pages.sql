-- A receipt can arrive as several files: a long receipt photographed in
-- parts, the front and back of one, or a PDF plus a photo of the
-- handwritten tip. receipts.r2_key stays page 1, so every existing row is
-- a one-page receipt with no backfill; pages 2..n live here, in the order
-- they were uploaded (which is the order the model reads them in).

CREATE TABLE receipt_pages (
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  page       INTEGER NOT NULL CHECK (page >= 2),
  r2_key     TEXT NOT NULL,
  PRIMARY KEY (receipt_id, page)
);

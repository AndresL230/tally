-- Tally schema. All money is INTEGER CENTS. The ledger is append-only:
-- rows are never updated or deleted; voids are reversing expenses via
-- reverses_id. Balance is derived from the ledger_entries view, never stored.

CREATE TABLE users (
  email        TEXT PRIMARY KEY,
  display_name TEXT,
  accent_color TEXT,
  created_at   INTEGER
);

-- person_a is always the lexicographically smaller email. Deltas are stored
-- from person_a's perspective forever; the UI negates for person_b so both
-- viewers see positive = "I'm owed".
CREATE TABLE ledgers (
  id         TEXT PRIMARY KEY,
  person_a   TEXT NOT NULL,
  person_b   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (person_a, person_b),
  CHECK (person_a < person_b)
);

CREATE TABLE receipts (
  id           TEXT PRIMARY KEY,
  ledger_id    TEXT NOT NULL REFERENCES ledgers(id),
  r2_key       TEXT,
  sha256       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN
                 ('uploaded','extracting','needs_review','posted','failed','discarded')),
  raw_json     TEXT,
  merchant     TEXT,
  purchased_on TEXT,
  total_cents  INTEGER,
  uploaded_by  TEXT,
  created_at   INTEGER,
  UNIQUE (ledger_id, sha256)                     -- same bytes twice = one receipt
);

CREATE TABLE expenses (
  id                TEXT PRIMARY KEY,            -- client-generated UUID (idempotency key)
  ledger_id         TEXT NOT NULL REFERENCES ledgers(id),
  occurred_on       TEXT NOT NULL,               -- 'YYYY-MM-DD', a date not a timestamp
  merchant          TEXT NOT NULL,
  total_cents       INTEGER NOT NULL,
  payer             TEXT NOT NULL,               -- email
  other_share_cents INTEGER NOT NULL,            -- the non-payer's share
  method            TEXT NOT NULL CHECK (method IN ('items','percent','manual')),
  note              TEXT,
  receipt_id        TEXT REFERENCES receipts(id),
  extra_cents       INTEGER,                     -- total - items subtotal; display metadata
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  reverses_id       TEXT UNIQUE REFERENCES expenses(id)  -- UNIQUE: an entry can be voided once
);
CREATE INDEX idx_expenses_ledger ON expenses(ledger_id);

CREATE TABLE settlements (
  id           TEXT PRIMARY KEY,                 -- client-generated UUID (idempotency key)
  ledger_id    TEXT NOT NULL REFERENCES ledgers(id),
  occurred_on  TEXT NOT NULL,
  from_email   TEXT,
  to_email     TEXT,
  amount_cents INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_settlements_ledger ON settlements(ledger_id);

CREATE TABLE receipt_items (
  id          TEXT PRIMARY KEY,
  receipt_id  TEXT NOT NULL REFERENCES receipts(id),
  label       TEXT,
  qty         TEXT,
  price_cents INTEGER,
  assigned_to TEXT                               -- email or the literal 'half'; canonical, never viewer-relative
);
CREATE INDEX idx_receipt_items_receipt ON receipt_items(receipt_id);

-- Union of expenses and settlements with canonical (person_a-perspective)
-- deltas. Positive delta = person_b owes person_a more.
--   expense:    payer's outlay earns them the other side's share.
--   settlement: cash from from_email to to_email; money out of a's pocket
--               moves the balance in a's favor, same as an expense outlay.
CREATE VIEW ledger_entries AS
SELECT
  e.id, e.ledger_id, e.occurred_on, e.created_at,
  e.merchant AS label,
  CASE WHEN e.payer = l.person_a THEN e.other_share_cents
       ELSE -e.other_share_cents END AS delta_cents
FROM expenses e JOIN ledgers l ON l.id = e.ledger_id
UNION ALL
SELECT
  s.id, s.ledger_id, s.occurred_on, s.created_at,
  'Settle up' AS label,
  CASE WHEN s.from_email = l.person_a THEN s.amount_cents
       ELSE -s.amount_cents END AS delta_cents
FROM settlements s JOIN ledgers l ON l.id = s.ledger_id;

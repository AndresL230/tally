-- Demo seed mirroring the mockup's data (integer cents, canonical deltas).
-- Viewer for manual review: alex@example.com (set DEV_ALLOW_USER in .dev.vars).
-- Amounts follow the integer-cents rules, so item entries land within a cent
-- of the mockup's float display (documented in DEVIATIONS.md).

INSERT OR IGNORE INTO users (email, display_name, accent_color, created_at) VALUES
  ('alex@example.com',   'Alex',   '#0a8a9b', 1000),
  ('jordan@example.com', 'Jordan', '#1b6ef3', 1000),
  ('sam@example.com',    'Sam',    '#d4437a', 1000),
  ('priya@example.com',  'Priya',  NULL,      1000);

INSERT OR IGNORE INTO ledgers (id, person_a, person_b, created_at) VALUES
  ('led-jordan', 'alex@example.com', 'jordan@example.com', 1000),
  ('led-sam',    'alex@example.com', 'sam@example.com',    1001),
  ('led-priya',  'alex@example.com', 'priya@example.com',  1002);

-- Receipts backing the item entries (no stored image; sha is a seed marker).
INSERT OR IGNORE INTO receipts (id, ledger_id, r2_key, sha256, status, merchant, purchased_on, total_cents, uploaded_by, created_at) VALUES
  ('rcpt-lardo',   'led-jordan', NULL, 'seed-lardo',   'posted', 'Lardo',      '2026-07-06', 4680,  'jordan@example.com', 1003),
  ('rcpt-safeway', 'led-jordan', NULL, 'seed-safeway', 'posted', 'Safeway',    '2026-07-11', 9635,  'alex@example.com',   1004),
  ('rcpt-kachka',  'led-jordan', NULL, 'seed-kachka',  'posted', 'Kachka',     '2026-08-01', 11840, 'alex@example.com',   1007),
  ('rcpt-fm',      'led-jordan', NULL, 'seed-fm',      'posted', 'Fred Meyer', '2026-08-06', 2875,  'alex@example.com',   1008);

INSERT OR IGNORE INTO receipt_items (id, receipt_id, label, qty, price_cents, assigned_to) VALUES
  ('ri-lardo-1', 'rcpt-lardo', 'Muffuletta',          NULL, 1600, 'alex@example.com'),
  ('ri-lardo-2', 'rcpt-lardo', 'Pork belly banh mi',  NULL, 1550, 'jordan@example.com'),
  ('ri-lardo-3', 'rcpt-lardo', 'Fries',               NULL, 550,  'half'),
  ('ri-lardo-4', 'rcpt-lardo', 'Lemonade',            '×2', 590,  'half'),
  ('ri-sfwy-1', 'rcpt-safeway', 'Chicken thighs',     NULL, 1420, 'jordan@example.com'),
  ('ri-sfwy-2', 'rcpt-safeway', 'Cold brew',          NULL, 1199, 'jordan@example.com'),
  ('ri-sfwy-3', 'rcpt-safeway', 'Eggs',               '×2', 998,  'half'),
  ('ri-sfwy-4', 'rcpt-safeway', 'Olive oil',          NULL, 1849, 'half'),
  ('ri-sfwy-5', 'rcpt-safeway', 'Rice, 5lb',          NULL, 1275, 'jordan@example.com'),
  ('ri-sfwy-6', 'rcpt-safeway', 'Yogurt',             NULL, 649,  'alex@example.com'),
  ('ri-sfwy-7', 'rcpt-safeway', 'Frozen dumplings',   '×2', 1298, 'jordan@example.com'),
  ('ri-sfwy-8', 'rcpt-safeway', 'Sparkling water',    NULL, 662,  'half'),
  ('ri-kchk-1', 'rcpt-kachka', 'Herring under fur coat', NULL, 1400, 'jordan@example.com'),
  ('ri-kchk-2', 'rcpt-kachka', 'Pelmeni',             NULL, 1900, 'half'),
  ('ri-kchk-3', 'rcpt-kachka', 'Chicken Kiev',        NULL, 3200, 'jordan@example.com'),
  ('ri-kchk-4', 'rcpt-kachka', 'Beet salad',          NULL, 1200, 'alex@example.com'),
  ('ri-kchk-5', 'rcpt-kachka', 'Horseradish vodka',   '×4', 2400, 'half'),
  ('ri-fm-1',   'rcpt-fm',     'Paper towels',        NULL, 1299, 'half'),
  ('ri-fm-2',   'rcpt-fm',     'Dish soap',           NULL, 549,  'half'),
  ('ri-fm-3',   'rcpt-fm',     'Trash bags',          NULL, 1027, 'jordan@example.com');

INSERT OR IGNORE INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
    other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id) VALUES
  ('exp-tj',      'led-jordan', '2026-06-28', 'Trader Joe''s', 8240,  'alex@example.com',   4120, 'percent', 'Halved by percentage — no line items on the photo.', NULL, NULL, 'alex@example.com',   1001, NULL),
  ('exp-lardo',   'led-jordan', '2026-07-06', 'Lardo',         4680,  'jordan@example.com', 2367, 'items',   NULL, 'rcpt-lardo',   390,  'jordan@example.com', 1003, NULL),
  ('exp-safeway', 'led-jordan', '2026-07-11', 'Safeway',       9635,  'alex@example.com',   7159, 'items',   NULL, 'rcpt-safeway', 285,  'alex@example.com',   1004, NULL),
  ('exp-pokpok',  'led-jordan', '2026-07-18', 'Pok Pok',       4980,  'alex@example.com',   2490, 'percent', 'Halved by percentage — no line items on the photo.', NULL, NULL, 'alex@example.com',   1005, NULL),
  ('exp-ns',      'led-jordan', '2026-07-24', 'New Seasons',   3680,  'jordan@example.com', 1840, 'manual',  'Entered by hand.', NULL, NULL, 'jordan@example.com', 1006, NULL),
  ('exp-kachka',  'led-jordan', '2026-08-01', 'Kachka',        11840, 'alex@example.com',   7913, 'items',   NULL, 'rcpt-kachka',  1740, 'alex@example.com',   1007, NULL),
  ('exp-fm',      'led-jordan', '2026-08-06', 'Fred Meyer',    2875,  'alex@example.com',   1951, 'items',   NULL, 'rcpt-fm',      0,    'alex@example.com',   1008, NULL),
  ('exp-sam-1',   'led-sam',    '2026-06-02', 'Elephants Deli',    3000, 'alex@example.com', 1500, 'percent', 'Halved by percentage — no line items on the photo.', NULL, NULL, 'alex@example.com', 1001, NULL),
  ('exp-sam-2',   'led-sam',    '2026-06-14', 'Market of Choice',  5400, 'sam@example.com',  2700, 'manual',  'Entered by hand.', NULL, NULL, 'sam@example.com', 1002, NULL);

INSERT OR IGNORE INTO settlements (id, ledger_id, occurred_on, from_email, to_email, amount_cents, created_at) VALUES
  ('set-1', 'led-jordan', '2026-07-02', 'jordan@example.com', 'alex@example.com', 4120, 1002);

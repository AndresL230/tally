-- Own auth (replaces Cloudflare Access). All timestamps are epoch ms.

-- Explicit invites. "May sign in" is the union of: ADMIN_EMAIL, a users row,
-- membership in any ledger, or a row here. Creating a ledger with a friend's
-- email is therefore already an invite; this table is for inviting someone
-- who has no ledger yet.
CREATE TABLE invites (
  email      TEXT PRIMARY KEY,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One-time codes, append-only; only the NEWEST row per email is live.
-- Stores sha256(id || ':' || code), never the code. Rows older than a day
-- are pruned opportunistically by the code endpoint.
CREATE TABLE auth_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,           -- created_at + 10 minutes
  attempts    INTEGER NOT NULL DEFAULT 0, -- dead at 5
  consumed_at INTEGER
);
CREATE INDEX idx_auth_codes_email ON auth_codes(email, created_at);

-- id = sha256(cookie token). The raw token exists only in the cookie.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_email ON sessions(email);

-- App-wide switches. signup_mode: 'invite' (default when absent) | 'open'.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

// Migrations are applied from zero at the start of every run (storage is
// fresh per vitest invocation; already-applied migrations are skipped
// within a run).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// This pool version has no per-test isolated storage, so start every test
// from an empty database. Child tables first (receipt_items references
// receipts, etc.).
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM receipt_items"),
    env.DB.prepare("DELETE FROM expenses"), // references receipts + ledgers
    env.DB.prepare("DELETE FROM settlements"),
    env.DB.prepare("DELETE FROM receipts"),
    env.DB.prepare("DELETE FROM ledgers"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

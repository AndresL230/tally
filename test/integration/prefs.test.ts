// M3: multiple ledgers + prefs. Cross-ledger isolation and the sign
// convention verified from BOTH viewers are this milestone's gate.

import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import { authedFetch, authedJson } from "../helpers/auth";
import { ALEX, JORDAN, SAM, OUTSIDER, insertExpense, insertLedger } from "../helpers/fixtures";
import { ACCENT_PALETTE } from "../../src/shared/prefs";
import { viewerDelta } from "../../src/shared/ledger";
import type { LedgerDetail, LedgerSummary } from "../../src/shared/types";

function put(path: string, email: string, body: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function post(path: string, email: string, body: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/me (prefs)", () => {
  it("upserts display name and accent color and round-trips through GET", async () => {
    const res = await put("/api/me", ALEX, { display_name: "Alex", accent_color: ACCENT_PALETTE[2] });
    expect(res.status).toBe(200);
    const me = await authedJson<{ display_name: string; accent_color: string }>("/api/me", ALEX);
    expect(me).toMatchObject({ email: ALEX, display_name: "Alex", accent_color: ACCENT_PALETTE[2] });

    // Update in place (second PUT wins; created_at untouched semantics not observable here)
    expect((await put("/api/me", ALEX, { display_name: "Alexandra", accent_color: null })).status).toBe(200);
    const updated = await authedJson<{ display_name: string; accent_color: string | null }>("/api/me", ALEX);
    expect(updated).toMatchObject({ display_name: "Alexandra", accent_color: null });
  });

  it("absent accent_color keeps the stored value; explicit null clears it", async () => {
    await put("/api/me", ALEX, { display_name: "Alex", accent_color: ACCENT_PALETTE[1] });
    // Name-only update: accent untouched.
    await put("/api/me", ALEX, { display_name: "Al" });
    let me = await authedJson<{ display_name: string; accent_color: string | null }>("/api/me", ALEX);
    expect(me).toMatchObject({ display_name: "Al", accent_color: ACCENT_PALETTE[1] });
    // Explicit null: cleared.
    await put("/api/me", ALEX, { display_name: "Al", accent_color: null });
    me = await authedJson<{ display_name: string; accent_color: string | null }>("/api/me", ALEX);
    expect(me.accent_color).toBeNull();
  });

  it("rejects off-palette colors, blank and oversized names", async () => {
    expect((await put("/api/me", ALEX, { display_name: "Alex", accent_color: "#ff0000" })).status).toBe(400);
    expect((await put("/api/me", ALEX, { display_name: "   " })).status).toBe(400);
    expect((await put("/api/me", ALEX, { display_name: "x".repeat(81) })).status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await SELF.fetch("https://tally.test/api/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "Nobody" }),
    });
    expect(res.status).toBe(401);
  });

  it("only ever writes the caller's own row (identity from the JWT, not the body)", async () => {
    await put("/api/me", ALEX, { display_name: "Alex", email: JORDAN, accent_color: null });
    const jordanRow = await env.DB.prepare("SELECT * FROM users WHERE email = ?1")
      .bind(JORDAN)
      .first();
    expect(jordanRow).toBeNull();
  });
});

describe("POST /api/ledgers (new-ledger flow)", () => {
  it("creates with canonical member ordering regardless of who initiates", async () => {
    // SAM initiates with ALEX: alex@ < sam@, so person_a must be ALEX.
    const res = await post("/api/ledgers", SAM, { id: crypto.randomUUID(), friend_email: ALEX });
    expect(res.status).toBe(201);
    const { ledger } = (await res.json()) as { ledger: LedgerSummary };
    expect(ledger.person_a).toBe(ALEX);
    expect(ledger.person_b).toBe(SAM);
    expect(ledger.friend_email).toBe(ALEX); // viewer-relative convenience field
    expect(ledger.balance_cents).toBe(0);
  });

  it("normalizes friend email case", async () => {
    const res = await post("/api/ledgers", ALEX, {
      id: crypto.randomUUID(),
      friend_email: "Jordan@Example.COM",
    });
    expect(res.status).toBe(201);
    const { ledger } = (await res.json()) as { ledger: LedgerSummary };
    expect(ledger.person_b).toBe(JORDAN);
  });

  it("is idempotent by pair: recreating an existing pair returns the existing ledger (200)", async () => {
    const first = await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: JORDAN });
    expect(first.status).toBe(201);
    const firstLedger = ((await first.json()) as { ledger: LedgerSummary }).ledger;

    // The FRIEND recreating it also lands on the same ledger.
    const again = await post("/api/ledgers", JORDAN, { id: crypto.randomUUID(), friend_email: ALEX });
    expect(again.status).toBe(200);
    const againLedger = ((await again.json()) as { ledger: LedgerSummary }).ledger;
    expect(againLedger.id).toBe(firstLedger.id);
    expect(againLedger.friend_email).toBe(ALEX); // relative to Jordan now

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM ledgers").first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it("rejects self-ledgers, junk emails, and reused ids", async () => {
    expect(
      (await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: ALEX })).status,
    ).toBe(400);
    expect(
      (await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: "not-an-email" })).status,
    ).toBe(400);

    const id = crypto.randomUUID();
    expect((await post("/api/ledgers", ALEX, { id, friend_email: JORDAN })).status).toBe(201);
    const reuse = await post("/api/ledgers", ALEX, { id, friend_email: SAM });
    expect(reuse.status).toBe(409);
  });

  it("requires authentication", async () => {
    const res = await SELF.fetch("https://tally.test/api/ledgers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), friend_email: JORDAN }),
    });
    expect(res.status).toBe(401);
  });
});

describe("M3 gate — cross-ledger isolation", () => {
  it("a member of two ledgers never sees entries bleed between them", async () => {
    const withJordan = await insertLedger(ALEX, JORDAN);
    const withSam = await insertLedger(ALEX, SAM);
    await insertExpense({
      id: "iso-jordan-exp",
      ledger_id: withJordan,
      occurred_on: "2026-08-01",
      merchant: "Jordan Only",
      total_cents: 1000,
      payer: ALEX,
      other_share_cents: 700,
      created_at: 1,
    });
    await insertExpense({
      id: "iso-sam-exp",
      ledger_id: withSam,
      occurred_on: "2026-08-02",
      merchant: "Sam Only",
      total_cents: 2000,
      payer: SAM,
      other_share_cents: 900,
      created_at: 2,
    });

    const jordanView = await authedJson<LedgerDetail>(`/api/ledgers/${withJordan}`, ALEX);
    expect(jordanView.entries.map((e) => e.id)).toEqual(["iso-jordan-exp"]);
    expect(jordanView.entries[0]!.running_cents).toBe(700);

    const samView = await authedJson<LedgerDetail>(`/api/ledgers/${withSam}`, ALEX);
    expect(samView.entries.map((e) => e.id)).toEqual(["iso-sam-exp"]);
    expect(samView.entries[0]!.running_cents).toBe(-900);

    // The summaries keep the same wall between them.
    const { ledgers } = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", ALEX);
    const j = ledgers.find((l) => l.id === withJordan)!;
    const s = ledgers.find((l) => l.id === withSam)!;
    expect(j.balance_cents).toBe(700);
    expect(j.entry_count).toBe(1);
    expect(s.balance_cents).toBe(-900);
    expect(s.entry_count).toBe(1);

    // Jordan cannot see or touch the Alex+Sam ledger at all.
    expect((await authedFetch(`/api/ledgers/${withSam}`, JORDAN)).status).toBe(404);
    const jordanList = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", JORDAN);
    expect(jordanList.ledgers.map((l) => l.id)).toEqual([withJordan]);

    // And an outsider sees nothing anywhere.
    const outsiderList = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", OUTSIDER);
    expect(outsiderList.ledgers).toEqual([]);
  });
});

describe("M3 gate — sign convention from both viewers", () => {
  it("both members receive identical canonical numbers; the translation flips exactly once", async () => {
    const lid = await insertLedger(ALEX, JORDAN);
    await insertExpense({
      ledger_id: lid,
      occurred_on: "2026-08-03",
      total_cents: 5000,
      payer: ALEX,
      other_share_cents: 3149,
      created_at: 1,
    });

    const L = { person_a: ALEX, person_b: JORDAN };
    const asAlex = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", ALEX);
    const asJordan = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", JORDAN);
    const alexSummary = asAlex.ledgers[0]!;
    const jordanSummary = asJordan.ledgers[0]!;

    // Wire values are canonical for both viewers…
    expect(alexSummary.balance_cents).toBe(3149);
    expect(jordanSummary.balance_cents).toBe(3149);
    // …the friend fields flip…
    expect(alexSummary.friend_email).toBe(JORDAN);
    expect(jordanSummary.friend_email).toBe(ALEX);
    // …and the UI translation gives each viewer "positive = I'm owed".
    expect(viewerDelta(alexSummary.balance_cents, ALEX, L)).toBe(3149);
    expect(viewerDelta(jordanSummary.balance_cents, JORDAN, L)).toBe(-3149);
  });
});

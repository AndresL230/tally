import type { Hono } from "hono";
import type { AppContext } from "./env";
import { orderMembers } from "../shared/ledger";
import { isAccentColor, looksLikeEmail } from "../shared/prefs";
import { listLedgers } from "./db";
import { ValidationError, assertId, assertString, readJson } from "./validate";

export function registerPrefs(app: Hono<AppContext>): void {
  // Display name + accent color; the whole users row (D1 stores no auth
  // data — identity is the Access-verified email, full stop).
  app.put("/api/me", async (c) => {
    const email = c.get("email");
    const body = await readJson(c.req.raw);
    const displayName = assertString(body.display_name, "display_name", {
      trim: true,
      max: 80,
    });
    // Absent field = keep the stored value; explicit null = clear it.
    let accent: string | null;
    if (!("accent_color" in body)) {
      const existing = await c.env.DB.prepare(
        "SELECT accent_color FROM users WHERE email = ?1",
      )
        .bind(email)
        .first<{ accent_color: string | null }>();
      accent = existing?.accent_color ?? null;
    } else if (body.accent_color === null) {
      accent = null;
    } else if (isAccentColor(body.accent_color)) {
      accent = body.accent_color;
    } else {
      throw new ValidationError("accent_color must be one of the app palette");
    }
    await c.env.DB.prepare(
      `INSERT INTO users (email, display_name, accent_color, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email) DO UPDATE SET display_name = ?2, accent_color = ?3`,
    )
      .bind(email, displayName, accent, Date.now())
      .run();
    return c.json({ email, display_name: displayName, accent_color: accent });
  });

  // New ledger = the friend's email. The other half of adding a friend is
  // the Access policy (documented in README/HUMAN_TODO) — this route only
  // creates the pair.
  app.post("/api/ledgers", async (c) => {
    const email = c.get("email");
    const body = await readJson(c.req.raw);
    const id = assertId(body.id, "id");
    const friendRaw = assertString(body.friend_email, "friend_email", { trim: true });
    const friend = friendRaw.toLowerCase();
    if (!looksLikeEmail(friend)) {
      throw new ValidationError("friend_email must be an email address");
    }
    if (friend === email) {
      throw new ValidationError("a ledger needs two different people");
    }
    const [a, b] = orderMembers(email, friend);

    // Idempotent by pair: creating a ledger that already exists lands you
    // in the existing one (200), whatever id the client minted this time.
    const insert = await c.env.DB.prepare(
      `INSERT INTO ledgers (id, person_a, person_b, created_at)
       SELECT ?1, ?2, ?3, ?4
       WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE person_a = ?2 AND person_b = ?3)
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(id, a, b, Date.now())
      .run();

    const pair = await c.env.DB.prepare(
      "SELECT id FROM ledgers WHERE person_a = ?1 AND person_b = ?2",
    )
      .bind(a, b)
      .first<{ id: string }>();
    if (!pair) {
      // Our insert didn't land and the pair doesn't exist: the id is used
      // by some other ledger.
      return c.json({ error: "id already used" }, 409);
    }

    const summaries = await listLedgers(c.env.DB, email);
    const summary = summaries.find((l) => l.id === pair.id);
    if (!summary) {
      // The caller is a member of the pair by construction; not finding it
      // means listLedgers broke — fail loudly rather than serialize {}.
      throw new Error(`ledger ${pair.id} missing from creator's own list`);
    }
    return c.json({ ledger: summary }, insert.meta.changes === 1 ? 201 : 200);
  });
}

import { Hono } from "hono";
import type { AppContext } from "./env";
import { getUser, requireUser } from "./auth";
import { ledgerDetail, ledgerForMember, listLedgers } from "./db";
import { registerMutations } from "./mutations";
import { registerReceipts } from "./receipts";
import { registerPrefs } from "./prefs";

const app = new Hono<AppContext>();

// Every /api/* request must carry a verified Access identity.
app.use("/api/*", requireUser);

registerMutations(app);
registerReceipts(app);
registerPrefs(app);

app.get("/api/me", async (c) => {
  const email = c.get("email");
  const row = await c.env.DB.prepare(
    "SELECT email, display_name, accent_color FROM users WHERE email = ?1",
  )
    .bind(email)
    .first<{ email: string; display_name: string | null; accent_color: string | null }>();
  return c.json(row ?? { email, display_name: null, accent_color: null });
});

app.get("/api/ledgers", async (c) => {
  return c.json({ ledgers: await listLedgers(c.env.DB, c.get("email")) });
});

app.get("/api/ledgers/:id", async (c) => {
  const email = c.get("email");
  const ledger = await ledgerForMember(c.env.DB, c.req.param("id"), email);
  if (!ledger) return c.json({ error: "not found" }, 404);
  return c.json(await ledgerDetail(c.env.DB, ledger, email));
});

// The root has two faces: a signed-in browser (Access cookie, verified for
// real — or the localhost dev bypass) gets the app shell; everyone else gets
// the public landing page. The app's URL never changes.
app.get("/", async (c) => {
  const user = await getUser(c.req.raw, c.env);
  const url = new URL(user ? "/" : "/welcome", c.req.url);
  return c.env.ASSETS.fetch(new Request(url));
});

// Cloudflare Access fronts /login, so any request reaching the Worker here
// has just authenticated — bounce it into the app (same-origin paths only).
app.get("/login", (c) => {
  const next = c.req.query("next") ?? "/";
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return c.redirect(dest, 302);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "not found" }, 404);
  }
  // Non-API paths are normally served by Static Assets before the Worker
  // runs (run_worker_first is scoped to /api/*); this is a dev/test fallback.
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;

import type { Hono, MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import type { AdminState, PendingInvite } from "../shared/types";
import { looksLikeEmail } from "../shared/prefs";
import { getSignupMode, setSignupMode } from "./settings";
import { sendMail } from "./mailer";
import { invited } from "./emails";
import { ValidationError, assertString, readJson } from "./validate";

export function isAdmin(env: Env, email: string): boolean {
  return !!env.ADMIN_EMAIL && env.ADMIN_EMAIL.toLowerCase() === email;
}

const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!isAdmin(c.env, c.get("email"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

/** Owner-only routes. Registered after the global session middleware. */
export function registerAdmin(app: Hono<AppContext>): void {
  app.use("/api/admin", requireAdmin);
  app.use("/api/admin/*", requireAdmin);

  app.get("/api/admin", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT i.email, i.created_at AS invited_at
       FROM invites i LEFT JOIN users u ON u.email = i.email
       WHERE u.email IS NULL
       ORDER BY i.created_at DESC`,
    ).all<PendingInvite>();
    const state: AdminState = { signup_mode: await getSignupMode(c.env.DB), pending: results };
    return c.json(state);
  });

  app.put("/api/admin/signup-mode", async (c) => {
    const body = await readJson(c.req.raw);
    if (body.mode !== "invite" && body.mode !== "open") {
      throw new ValidationError("mode must be 'invite' or 'open'");
    }
    await setSignupMode(c.env.DB, body.mode);
    if (body.mode === "invite") {
      // Closing the door means closing it: strangers who signed in while
      // sign-up was open lose their sessions, so open mode is reversible.
      // Anyone with a ledger or an invite keeps theirs, and so does the owner.
      await c.env.DB.prepare(
        `DELETE FROM sessions
         WHERE lower(email) != lower(?1)
           AND NOT EXISTS (SELECT 1 FROM ledgers l WHERE l.person_a = sessions.email OR l.person_b = sessions.email)
           AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.email = sessions.email)`,
      )
        .bind(c.env.ADMIN_EMAIL ?? "")
        .run();
    }
    return c.json({ signup_mode: body.mode });
  });

  app.post("/api/admin/invites", async (c) => {
    const body = await readJson(c.req.raw);
    const email = assertString(body.email, "email", { trim: true, max: 254 }).toLowerCase();
    if (!looksLikeEmail(email)) throw new ValidationError("email must be an email address");
    if (email === c.get("email")) throw new ValidationError("you're already here");
    const insert = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO invites (email, invited_by, created_at) VALUES (?1, ?2, ?3)",
    )
      .bind(email, c.get("email"), Date.now())
      .run();
    // Re-inviting re-sends: the row is idempotent, the email is the point.
    await sendMail(c.env, { to: email, ...invited(null) });
    return c.json({ email }, insert.meta.changes === 1 ? 201 : 200);
  });

  app.delete("/api/admin/invites/:email", async (c) => {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase();
    await c.env.DB.prepare("DELETE FROM invites WHERE email = ?1").bind(email).run();
    return c.body(null, 204);
  });
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { authedFetch, authedJson, sessionCookieFor } from "../helpers/auth";
import { ALEX, JORDAN, insertLedger } from "../helpers/fixtures";
import { failNextSend, installMailPatch, lastCodeFor, outbox, removeMailPatch } from "../helpers/mail";
import type { AdminState } from "../../src/shared/types";

const ADMIN = "admin@example.com"; // vitest.config.ts binds ADMIN_EMAIL

function json(method: string, path: string, email: string, body?: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => installMailPatch());
afterEach(() => removeMailPatch());

describe("/api/me is_admin", () => {
  it("is true only for ADMIN_EMAIL", async () => {
    expect((await authedJson<{ is_admin: boolean }>("/api/me", ADMIN)).is_admin).toBe(true);
    expect((await authedJson<{ is_admin: boolean }>("/api/me", ALEX)).is_admin).toBe(false);
  });
});

describe("admin routes", () => {
  it("are forbidden for everyone but the owner", async () => {
    expect((await json("GET", "/api/admin", ALEX)).status).toBe(403);
    expect((await json("PUT", "/api/admin/signup-mode", ALEX, { mode: "open" })).status).toBe(403);
    expect((await json("POST", "/api/admin/invites", ALEX, { email: JORDAN })).status).toBe(403);
    expect((await json("DELETE", `/api/admin/invites/${JORDAN}`, ALEX)).status).toBe(403);
    expect((await SELF.fetch("https://tally.test/api/admin")).status).toBe(401);
  });

  it("reports the default state", async () => {
    const state = await authedJson<AdminState>("/api/admin", ADMIN);
    expect(state).toEqual({ signup_mode: "invite", pending: [] });
  });

  it("flips signup mode and rejects anything else", async () => {
    const res = await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "open" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signup_mode: "open" });
    expect((await authedJson<AdminState>("/api/admin", ADMIN)).signup_mode).toBe("open");
    expect((await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "everyone" })).status).toBe(400);
    expect((await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "invite" })).status).toBe(200);
  });

  it("switching back to invite-only signs out whoever open mode let in", async () => {
    const STRANGER = "stranger@example.com";
    const me = (cookie: string) => SELF.fetch("https://tally.test/api/me", { headers: { Cookie: cookie } });
    const anon = (path: string, body: unknown) =>
      SELF.fetch(`https://tally.test${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    await insertLedger(ALEX, JORDAN);
    const alexCookie = await sessionCookieFor(ALEX);
    const ownerCookie = await sessionCookieFor(ADMIN);
    expect((await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "open" })).status).toBe(200);

    // A stranger walks in through the open door.
    expect((await anon("/api/auth/code", { email: STRANGER })).status).toBe(200);
    const verified = await anon("/api/auth/verify", { email: STRANGER, code: lastCodeFor(STRANGER) });
    expect(verified.status).toBe(200);
    const strangerCookie = /tally_session=[^;]+/.exec(verified.headers.get("set-cookie") ?? "")![0];
    expect((await me(strangerCookie)).status).toBe(200);

    // The owner closes it again: the stranger is out, members and the owner stay.
    expect((await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "invite" })).status).toBe(200);
    expect((await me(strangerCookie)).status).toBe(401);
    expect((await me(alexCookie)).status).toBe(200);
    expect((await me(ownerCookie)).status).toBe(200);
  });

  it("invites: inserts, emails the owner variant, lists as pending, and is idempotent", async () => {
    const first = await json("POST", "/api/admin/invites", ADMIN, { email: "Mia@Example.com" });
    expect(first.status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toEqual(["mia@example.com"]);
    expect(outbox[0]!.subject).toBe("You've been invited to Tally");

    const again = await json("POST", "/api/admin/invites", ADMIN, { email: "mia@example.com" });
    expect(again.status).toBe(200);
    expect(outbox).toHaveLength(2); // re-inviting re-sends

    const state = await authedJson<AdminState>("/api/admin", ADMIN);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]!.email).toBe("mia@example.com");
    expect(typeof state.pending[0]!.invited_at).toBe("number");
  });

  it("an invite stops being pending once the person has onboarded", async () => {
    await json("POST", "/api/admin/invites", ADMIN, { email: JORDAN });
    await env.DB.prepare("INSERT INTO users (email, display_name, accent_color, created_at) VALUES (?1, 'J', NULL, 1)")
      .bind(JORDAN)
      .run();
    expect((await authedJson<AdminState>("/api/admin", ADMIN)).pending).toEqual([]);
  });

  it("removes an invite", async () => {
    await json("POST", "/api/admin/invites", ADMIN, { email: JORDAN });
    expect((await json("DELETE", `/api/admin/invites/${JORDAN}`, ADMIN)).status).toBe(204);
    expect((await authedJson<AdminState>("/api/admin", ADMIN)).pending).toEqual([]);
    expect((await json("DELETE", `/api/admin/invites/${JORDAN}`, ADMIN)).status).toBe(204); // idempotent
  });

  it("reports a mail failure as 502 and keeps the invite pending", async () => {
    failNextSend(500);
    const res = await json("POST", "/api/admin/invites", ADMIN, { email: JORDAN });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "couldn't send the email" });
    const state = await authedJson<AdminState>("/api/admin", ADMIN);
    expect(state.pending.map((p) => p.email)).toEqual([JORDAN]);
    // Inviting again re-sends, and now it works.
    expect((await json("POST", "/api/admin/invites", ADMIN, { email: JORDAN })).status).toBe(200);
    expect(outbox).toHaveLength(1);
  });

  it("validates the invite email and refuses self-invites", async () => {
    expect((await json("POST", "/api/admin/invites", ADMIN, { email: "nope" })).status).toBe(400);
    expect((await json("POST", "/api/admin/invites", ADMIN, { email: ADMIN })).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });
});

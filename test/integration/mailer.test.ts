import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { sendMail } from "../../src/worker/mailer";

const mutableEnv = env as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch;

afterEach(() => {
  delete mutableEnv["RESEND_API_KEY"];
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const MAIL = { to: "alex@example.com", subject: "Your Tally code: 482 913", html: "<p>482 913</p>", text: "Your code: 482 913" };

describe("sendMail", () => {
  it("without RESEND_API_KEY: logs the subject and text, touches no network", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.fetch = (async () => {
      throw new Error("network must not be used");
    }) as typeof fetch;
    await sendMail(env, MAIL);
    const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toContain("Your Tally code: 482 913");
    expect(printed).toContain("alex@example.com");
  });

  it("with RESEND_API_KEY: POSTs to Resend with the bearer key and From, and never logs", async () => {
    mutableEnv["RESEND_API_KEY"] = "re_test";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      seen = { url: req.url, auth: req.headers.get("Authorization"), body: (await req.json()) as Record<string, unknown> };
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await sendMail(env, MAIL);
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect(seen!.auth).toBe("Bearer re_test");
    expect(seen!.body).toMatchObject({ from: env.MAIL_FROM, to: ["alex@example.com"], subject: MAIL.subject, html: MAIL.html, text: MAIL.text });
    expect(log).not.toHaveBeenCalled();
  });

  it("with RESEND_API_KEY: a non-2xx from Resend throws", async () => {
    mutableEnv["RESEND_API_KEY"] = "re_test";
    globalThis.fetch = (async () => new Response("nope", { status: 422 })) as typeof fetch;
    await expect(sendMail(env, MAIL)).rejects.toThrow(/resend 422/);
  });
});

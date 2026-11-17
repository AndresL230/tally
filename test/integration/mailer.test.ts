import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { parseFrom, sendMail } from "../../src/worker/mailer";

const mutableEnv = env as unknown as Record<string, unknown>;
const realBinding = mutableEnv["EMAIL"];

afterEach(() => {
  mutableEnv["EMAIL"] = realBinding;
  vi.restoreAllMocks();
});

const MAIL = { to: "alex@example.com", subject: "Your Tally code: 482 913", html: "<p>482 913</p>", text: "Your code: 482 913" };

describe("parseFrom", () => {
  it("splits a display name from the address", () => {
    expect(parseFrom("Tally <sign-in@tally.andresl.dev>")).toEqual({ name: "Tally", email: "sign-in@tally.andresl.dev" });
    expect(parseFrom('"Tally App" <a@b.dev>')).toEqual({ name: "Tally App", email: "a@b.dev" });
  });
  it("passes a bare address through", () => {
    expect(parseFrom(" sign-in@tally.andresl.dev ")).toBe("sign-in@tally.andresl.dev");
    expect(parseFrom("<a@b.dev>")).toBe("a@b.dev");
  });
});

describe("sendMail", () => {
  it("hands the message to the EMAIL binding with the parsed From, and never logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const seen: EmailMessageBuilder[] = [];
    mutableEnv["EMAIL"] = { send: async (m: EmailMessageBuilder) => (seen.push(m), { messageId: "m1" }) };
    await sendMail(env, MAIL);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ from: parseFrom(env.MAIL_FROM!), to: MAIL.to, subject: MAIL.subject, html: MAIL.html, text: MAIL.text });
    expect(log).not.toHaveBeenCalled();
  });

  it("rethrows a binding error with its code", async () => {
    mutableEnv["EMAIL"] = {
      send: async () => {
        throw Object.assign(new Error("domain not verified"), { code: "E_SENDER_NOT_VERIFIED" });
      },
    };
    await expect(sendMail(env, MAIL)).rejects.toThrow(/E_SENDER_NOT_VERIFIED.*domain not verified/);
  });

  it("works against the local simulated binding (the configured sender is allowed)", async () => {
    await expect(sendMail(env, MAIL)).resolves.toBeUndefined();
  });
});

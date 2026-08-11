import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { accessJwt, authedFetch } from "../helpers/auth";

describe("Access authentication on /api/*", () => {
  it("rejects requests with no credentials", async () => {
    const res = await SELF.fetch("https://tally.test/api/me");
    expect(res.status).toBe(401);
  });

  it("rejects garbage tokens", async () => {
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a valid-signature token with the wrong audience", async () => {
    const token = await accessJwt("alex@example.com", { aud: "some-other-app" });
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a valid-signature token with the wrong issuer", async () => {
    const token = await accessJwt("alex@example.com", { iss: "https://evil.example.com" });
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = await accessJwt("alex@example.com", { expiresIn: -60 });
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token without an email claim", async () => {
    const token = await accessJwt("alex@example.com", { omitEmail: true });
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(401);
  });

  it("never trusts the Cf-Access-Authenticated-User-Email header alone", async () => {
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Authenticated-User-Email": "alex@example.com" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and lowercases the email", async () => {
    const token = await accessJwt("Alex@Example.COM");
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "alex@example.com" });
  });

  it("accepts the JWT via the CF_Authorization cookie", async () => {
    const token = await accessJwt("alex@example.com");
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { Cookie: `CF_Authorization=${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("authenticates a normal API round-trip", async () => {
    const res = await authedFetch("/api/ledgers", "alex@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ledgers: [] });
  });
});

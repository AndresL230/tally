import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SignJWT, generateKeyPair } from "jose";
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

  it("rejects a claims-perfect token signed by an untrusted key", async () => {
    // Same kid, same iss/aud/exp/email — only the signature is wrong. This
    // is the test that fails if signature verification is ever skipped.
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: "alex@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "tally-test-key" })
      .setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`)
      .setAudience(env.ACCESS_AUD)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(privateKey);
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token whose kid is not in the JWKS", async () => {
    const token = await accessJwt("alex@example.com", { kid: "some-other-key" });
    const res = await SELF.fetch("https://tally.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a trusted-key token without an exp claim", async () => {
    const token = await accessJwt("alex@example.com", { omitExp: true });
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

describe("DEV_ALLOW_USER localhost-only bypass", () => {
  // vitest.config.ts binds DEV_ALLOW_USER=devuser@example.com explicitly.

  it("grants the dev identity for localhost requests", async () => {
    const res = await SELF.fetch("http://localhost/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "devuser@example.com" });
  });

  it("grants the dev identity for 127.0.0.1 requests", async () => {
    const res = await SELF.fetch("http://127.0.0.1/api/me");
    expect(res.status).toBe(200);
  });

  it("never applies to non-localhost hosts, even with the var set", async () => {
    const res = await SELF.fetch("https://tally.test/api/me");
    expect(res.status).toBe(401);
  });

  it("never applies to lookalike hosts", async () => {
    const res = await SELF.fetch("https://localhost.evil.example/api/me");
    expect(res.status).toBe(401);
  });
});

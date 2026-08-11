import { SignJWT, importJWK } from "jose";
import { env, SELF } from "cloudflare:test";
import privateJwk from "../keys/jwk-private.json";

export interface JwtOptions {
  aud?: string;
  iss?: string;
  expiresIn?: number; // seconds; negative = already expired
  omitEmail?: boolean;
  kid?: string; // override the key id in the protected header
  omitExp?: boolean;
}

/** Sign a JWT the way Cloudflare Access would, using the committed test key. */
export async function accessJwt(email: string, opts: JwtOptions = {}): Promise<string> {
  const key = await importJWK(privateJwk as JsonWebKey, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = opts.expiresIn ?? 600;
  const jwt = new SignJWT(opts.omitEmail ? {} : { email })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "tally-test-key" })
    .setIssuer(opts.iss ?? `https://${env.ACCESS_TEAM_DOMAIN}`)
    .setAudience(opts.aud ?? env.ACCESS_AUD)
    .setIssuedAt(now)
    .setSubject(`test-sub-${email}`);
  if (!opts.omitExp) jwt.setExpirationTime(now + expiresIn);
  return await jwt.sign(key);
}

/** SELF.fetch with a forged-valid Access JWT for `email`. */
export async function authedFetch(
  path: string,
  email: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await accessJwt(email);
  const headers = new Headers(init.headers);
  headers.set("Cf-Access-Jwt-Assertion", token);
  return await SELF.fetch(`https://tally.test${path}`, { ...init, headers });
}

export async function authedJson<T>(
  path: string,
  email: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await authedFetch(path, email, init);
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

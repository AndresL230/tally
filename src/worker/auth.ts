import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";

// Module-scope cache: createRemoteJWKSet caches fetched keys internally and
// refetches on unknown-kid with a cooldown, so one instance per team domain
// lives for the isolate's lifetime.
const remoteJwks = new Map<string, JWTVerifyGetKey>();

function keySource(env: Env): JWTVerifyGetKey {
  if (env.ACCESS_JWKS) return createLocalJWKSet(JSON.parse(env.ACCESS_JWKS));
  let source = remoteJwks.get(env.ACCESS_TEAM_DOMAIN);
  if (!source) {
    source = createRemoteJWKSet(
      new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
    );
    remoteJwks.set(env.ACCESS_TEAM_DOMAIN, source);
  }
  return source;
}

/**
 * Resolve the authenticated user from a request. All identity flows through
 * here. The Access JWT is verified for real (signature against the team
 * JWKS, issuer, audience, expiry) — the Cf-Access-Authenticated-User-Email
 * header is never trusted, or even read.
 */
export async function getUser(
  request: Request,
  env: Env,
): Promise<{ email: string } | null> {
  // Local development only: wrangler dev has no Access in front of it.
  // Honored exclusively for loopback hosts so a leaked prod var can't be
  // used to skip verification.
  if (env.DEV_ALLOW_USER) {
    const host = new URL(request.url).hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return { email: env.DEV_ALLOW_USER.toLowerCase() };
    }
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    cookieToken(request.headers.get("Cookie"));
  if (!token || !COMPACT_JWS.test(token)) return null;
  try {
    // Synchronous structural check; malformed tokens fail here without
    // creating a rejected promise inside the crypto path (workerd reports
    // those as unhandled even when awaited-and-caught by our caller).
    decodeProtectedHeader(token);
  } catch {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, keySource(env), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
    });
    const email = payload["email"];
    if (typeof email !== "string" || email.length === 0) return null;
    return { email: email.toLowerCase() };
  } catch {
    return null;
  }
}

// Shape check before handing the token to jose, so obvious garbage is
// rejected without exercising (and error-logging through) the crypto path.
const COMPACT_JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function cookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization") return rest.join("=") || null;
  }
  return null;
}

/** Hono middleware: 401 unless the request carries a valid Access identity. */
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  const user = await getUser(c.req.raw, c.env);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  c.set("email", user.email);
  await next();
};

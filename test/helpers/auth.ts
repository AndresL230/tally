import { env, SELF } from "cloudflare:test";
import { SESSION_COOKIE, createSession } from "../../src/worker/session";

/** Mint a real session row for `email`; returns the Cookie header value. */
export async function sessionCookieFor(email: string): Promise<string> {
  const token = await createSession(env.DB, email.toLowerCase());
  return `${SESSION_COOKIE}=${token}`;
}

/** SELF.fetch as `email`: a fresh, valid session cookie on every call. */
export async function authedFetch(
  path: string,
  email: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await sessionCookieFor(email));
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

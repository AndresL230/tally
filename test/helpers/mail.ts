// Resend, intercepted. SELF's worker runs in this isolate, so patching
// globalThis.fetch captures its outbound mail. Same shape as the gateway
// patch in receipts.test.ts: anything un-mocked throws.

import { env } from "cloudflare:test";

export interface SentMail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export const outbox: SentMail[] = [];

const RESEND_URL = "https://api.resend.com/emails";
const mutableEnv = env as unknown as Record<string, unknown>;
let realFetch: typeof fetch | null = null;
let failStatus: number | null = null;

/** Set RESEND_API_KEY (so the real send path runs) and capture every send. */
export function installMailPatch(): void {
  mutableEnv["RESEND_API_KEY"] = "re_test";
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input as RequestInfo, init);
    if (req.url !== RESEND_URL) throw new Error(`unmocked outbound fetch: ${req.url}`);
    if (failStatus !== null) {
      const status = failStatus;
      failStatus = null;
      return new Response(JSON.stringify({ message: "nope" }), { status });
    }
    const body = (await req.json()) as SentMail;
    outbox.push(body);
    return new Response(JSON.stringify({ id: `msg_${outbox.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

export function removeMailPatch(): void {
  if (realFetch) globalThis.fetch = realFetch;
  realFetch = null;
  failStatus = null;
  delete mutableEnv["RESEND_API_KEY"];
  outbox.length = 0;
}

/** The next send returns this HTTP status instead of succeeding. */
export function failNextSend(status: number): void {
  failStatus = status;
}

/** The six digits from the latest code email sent to `email`. */
export function lastCodeFor(email: string): string {
  const mail = [...outbox].reverse().find((m) => m.to.includes(email));
  if (!mail) throw new Error(`no mail sent to ${email}`);
  const m = /Your code: (\d{3}) (\d{3})/.exec(mail.text);
  if (!m) throw new Error(`no code in mail to ${email}: ${mail.text}`);
  return `${m[1]}${m[2]}`;
}

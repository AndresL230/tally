// Cloudflare Email Sending, intercepted. SELF's worker runs in this isolate
// and shares `env`, so swapping env.EMAIL for a fake binding captures every
// send. Without the patch, sends go to miniflare's local simulator (which
// logs and writes temp files, never the network).

import { env } from "cloudflare:test";

export interface SentMail {
  from: string | EmailAddress;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export const outbox: SentMail[] = [];

const mutableEnv = env as unknown as Record<string, unknown>;
let realBinding: unknown = undefined;
let failCode: string | null = null;

function asList(v: EmailMessageBuilder["to"]): string[] {
  const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
  return list.map((a) => (typeof a === "string" ? a : a.email));
}

/** Replace the EMAIL binding with a fake that records each message. */
export function installMailPatch(): void {
  realBinding = mutableEnv["EMAIL"];
  const fake = {
    async send(message: EmailMessageBuilder): Promise<EmailSendResult> {
      if (failCode !== null) {
        const err = Object.assign(new Error("simulated send failure"), { code: failCode });
        failCode = null;
        throw err;
      }
      outbox.push({
        from: message.from,
        to: asList(message.to),
        subject: message.subject,
        html: message.html ?? "",
        text: message.text ?? "",
      });
      return { messageId: `msg_${outbox.length}` } as EmailSendResult;
    },
  };
  mutableEnv["EMAIL"] = fake;
}

export function removeMailPatch(): void {
  if (realBinding !== undefined) mutableEnv["EMAIL"] = realBinding;
  realBinding = undefined;
  failCode = null;
  outbox.length = 0;
}

/** The next send throws a binding error with this code instead of succeeding. */
export function failNextSend(code = "E_INTERNAL_SERVER_ERROR"): void {
  failCode = code;
}

/** The six digits from the latest code email sent to `email`. */
export function lastCodeFor(email: string): string {
  const mail = [...outbox].reverse().find((m) => m.to.includes(email));
  if (!mail) throw new Error(`no mail sent to ${email}`);
  const m = /Your code: (\d{3}) (\d{3})/.exec(mail.text);
  if (!m) throw new Error(`no code in mail to ${email}: ${mail.text}`);
  return `${m[1]}${m[2]}`;
}

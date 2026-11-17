import type { Env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const DEFAULT_FROM = "Tally <sign-in@tally.andresl.dev>";

/** "Tally <sign-in@x.dev>" → { name, email }; otherwise the bare address. */
export function parseFrom(value: string): string | EmailAddress {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  if (!m) return value.trim();
  const name = m[1]!.replace(/^"(.*)"$/, "$1");
  return name ? { name, email: m[2]! } : m[2]!;
}

/**
 * The one door mail leaves through: Cloudflare Email Sending via the EMAIL
 * binding. The binding throws an Error carrying a string `code` (for example
 * E_SENDER_NOT_VERIFIED); that is rethrown with the code in the message so
 * callers' logs say why. Under `wrangler dev` the binding is simulated: it
 * prints From/To/Subject and writes the text body (with the code) to a file.
 */
export async function sendMail(env: Env, mail: Mail): Promise<void> {
  try {
    await env.EMAIL.send({
      from: parseFrom(env.MAIL_FROM ?? DEFAULT_FROM),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`email ${typeof code === "string" ? code : "send"} failed: ${message.slice(0, 200)}`);
  }
}

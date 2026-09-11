import type { Env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Tally <sign-in@tally.andresl.dev>";

/**
 * The one door mail leaves through. With RESEND_API_KEY set it POSTs to
 * Resend and throws on a non-2xx. Without it (local dev only) it prints the
 * message to the terminal and returns — the text body carries the code, and
 * this is the ONLY condition under which a code is ever logged.
 */
export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail] ${mail.subject} → ${mail.to}\n${mail.text}`);
    return;
  }
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? DEFAULT_FROM,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

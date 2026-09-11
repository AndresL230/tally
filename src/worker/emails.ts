// The two transactional emails, ported from the Claude Design artboards
// (mockup/signin-account.dc.html, 2a/2b). Email-safe on purpose: inline
// styles, system font stacks, no web fonts, and no images at all — the
// brand mark is a solid accent banner with a text wordmark, so it renders
// the same with images blocked or proxied. Every template has an HTML and
// a plain-text body.

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

const APP_URL = "https://tally.andresl.dev";
const LOGIN_URL = `${APP_URL}/login`;

const SANS = "Helvetica,Arial,sans-serif";
const MONO = "'Courier New',monospace";
const ACCENT = "#0a8a9b";

// Four tally strokes drawn as inline blocks (no image), then the wordmark.
const STROKE =
  `<span style="display:inline-block;width:3px;height:16px;background:#ffffff;` +
  `border-radius:2px;margin-right:4px;vertical-align:middle"></span>`;
const BANNER =
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
  `<tr><td style="background:${ACCENT};padding:18px 24px;border-radius:8px 8px 0 0;text-align:left">` +
  STROKE.repeat(4) +
  `<span style="display:inline-block;margin-left:8px;color:#ffffff;font:600 15px ${MONO};` +
  `letter-spacing:.08em;vertical-align:middle">Tally</span>` +
  `<span style="display:inline-block;margin-left:12px;color:rgba(255,255,255,.75);font:400 12px ${SANS};` +
  `vertical-align:middle">a private ledger for two</span>` +
  `</td></tr></table>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(inner: string, align: "center" | "left"): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;padding:0;background:#f2efe7">` +
    `<div style="max-width:480px;margin:0 auto;padding:28px 16px">` +
    BANNER +
    `<div style="background:#ffffff;border-radius:0 0 8px 8px;padding:30px 24px 28px;text-align:${align};` +
    `font-family:${SANS};color:#211f1c">${inner}</div></div></body></html>`
  );
}

/** "482913" -> "482 913" (the way the code is shown everywhere). */
export function groupCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function signInCode(code: string): MailContent {
  const shown = groupCode(code);
  return {
    subject: `Your Tally code: ${shown}`,
    html: shell(
      `<div style="margin-top:4px;background:#fbfaf6;border:1px solid rgba(0,0,0,.09);border-radius:6px;` +
        `padding:26px 10px;font:600 40px ${MONO};color:#211f1c;letter-spacing:.04em">${shown}</div>` +
        `<div style="margin-top:16px;font:400 15px ${SANS};line-height:1.5;color:#4a453d">` +
        `This code works for 10 minutes and can be used once.</div>` +
        `<div style="margin-top:26px;font:400 12px ${SANS};line-height:1.5;color:#8a857c">` +
        `If you didn't ask for this, you can ignore it — nobody can sign in without the code.</div>`,
      "center",
    ),
    text:
      `TALLY\n\nYour code: ${shown}\n\nIt works for 10 minutes and can be used once.\n\n` +
      `If you didn't ask for this, you can ignore it —\nnobody can sign in without the code.\n`,
  };
}

export function invited(rawInviterName: string | null): MailContent {
  // A display name reaches the subject header and the plain-text body, so
  // its line breaks go first — a CR or LF there is header injection.
  const oneLine = rawInviterName?.replace(/[\r\n]+/g, " ").trim();
  const inviterName = oneLine ? oneLine : null;
  const safe = inviterName ? escapeHtml(inviterName) : null;
  const heading = safe ? `${safe} started a ledger with you.` : "You've been invited to Tally.";
  const headingText = inviterName ? `${inviterName} started a ledger with you.` : "You've been invited to Tally.";
  const subject = inviterName ? `${inviterName} started a ledger with you on Tally` : "You've been invited to Tally";
  const pitch = "One ledger, two people. Photograph the receipt, tap what was yours, settle when it suits you.";
  const footer = "You'll sign in with this email address and a one-time code — no password.";
  return {
    subject,
    html: shell(
      `<div style="margin-top:4px;font-family:Georgia,serif;font-size:28px;line-height:1.15;color:#211f1c">${heading}</div>` +
        `<div style="margin-top:14px;font:400 15px ${SANS};line-height:1.55;color:#4a453d">${pitch}</div>` +
        `<div style="margin-top:26px"><a href="${LOGIN_URL}" style="display:inline-block;background:#0a8a9b;` +
        `color:#ffffff;font:600 15px ${SANS};padding:16px 28px;border-radius:14px;text-decoration:none">Open Tally</a></div>` +
        `<div style="margin-top:26px;font:400 12px ${SANS};line-height:1.5;color:#8a857c">${footer}</div>`,
      "left",
    ),
    text: `TALLY\n\n${headingText}\n\n${pitch}\n\nOpen Tally: ${LOGIN_URL}\n\n${footer}\n`,
  };
}

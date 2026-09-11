// The two transactional emails, ported from the Claude Design artboards
// (mockup/signin-account.dc.html, 2a/2b). Email-safe on purpose: inline
// styles, system font stacks, no web fonts, and the logo as a hosted PNG —
// Gmail strips inline SVG. Every template has an HTML and a plain-text body.

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

const APP_URL = "https://tally.andresl.dev";
const LOGIN_URL = `${APP_URL}/login`;

const SANS = "Helvetica,Arial,sans-serif";
const MONO = "'Courier New',monospace";

const LOGO =
  `<img src="${APP_URL}/icon-192.png" width="24" height="24" alt="" ` +
  `style="display:inline-block;vertical-align:middle;border-radius:5px">` +
  ` <span style="letter-spacing:.08em;color:#0a8a9b;font:600 13px ${MONO};vertical-align:middle">Tally</span>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(inner: string, align: "center" | "left"): string {
  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">` +
    `<div style="max-width:480px;margin:0 auto;padding:30px 24px 28px;text-align:${align};` +
    `font-family:${SANS};color:#211f1c">${inner}</div></body></html>`
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
      `<div>${LOGO}</div>` +
        `<div style="margin-top:22px;background:#fbfaf6;border:1px solid rgba(0,0,0,.09);border-radius:6px;` +
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

export function invited(inviterName: string | null): MailContent {
  const safe = inviterName ? escapeHtml(inviterName) : null;
  const heading = safe ? `${safe} started a ledger with you.` : "You've been invited to Tally.";
  const headingText = inviterName ? `${inviterName} started a ledger with you.` : "You've been invited to Tally.";
  const subject = inviterName ? `${inviterName} started a ledger with you on Tally` : "You've been invited to Tally";
  const pitch = "One ledger, two people. Photograph the receipt, tap what was yours, settle when it suits you.";
  const footer = "You'll sign in with this email address and a one-time code — no password.";
  return {
    subject,
    html: shell(
      `<div>${LOGO}</div>` +
        `<div style="margin-top:24px;font-family:Georgia,serif;font-size:28px;line-height:1.15;color:#211f1c">${heading}</div>` +
        `<div style="margin-top:14px;font:400 15px ${SANS};line-height:1.55;color:#4a453d">${pitch}</div>` +
        `<div style="margin-top:26px"><a href="${LOGIN_URL}" style="display:inline-block;background:#0a8a9b;` +
        `color:#ffffff;font:600 15px ${SANS};padding:16px 28px;border-radius:14px;text-decoration:none">Open Tally</a></div>` +
        `<div style="margin-top:26px;font:400 12px ${SANS};line-height:1.5;color:#8a857c">${footer}</div>`,
      "left",
    ),
    text: `TALLY\n\n${headingText}\n\n${pitch}\n\nOpen Tally: ${LOGIN_URL}\n\n${footer}\n`,
  };
}

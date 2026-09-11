import { describe, expect, it } from "vitest";
import { groupCode, invited, signInCode } from "../../src/worker/emails";

describe("sign-in code email", () => {
  it("puts the grouped code in the subject, the html, and the text", () => {
    const m = signInCode("482913");
    expect(m.subject).toBe("Your Tally code: 482 913");
    expect(m.html).toContain("482 913");
    expect(m.text).toContain("Your code: 482 913");
    expect(m.text).toContain("It works for 10 minutes and can be used once.");
  });

  it("has no links — the user types the code", () => {
    const m = signInCode("000001");
    expect(m.html).not.toMatch(/<a\s/i);
    expect(m.text).not.toContain("http");
  });

  it("uses only email-safe fonts and the app icon on a banner", () => {
    const m = signInCode("123456");
    expect(m.html).not.toContain("<svg");
    expect(m.html).toContain('src="https://tally.andresl.dev/icon-192.png"');
    expect(m.html).toContain('<meta charset="utf-8">');
    expect(m.html).toContain("background:#0a8a9b");
    expect(m.html).toContain(">Tally</span>");
    expect(m.html).not.toMatch(/Archivo|Instrument Serif|IBM Plex/);
  });
});

describe("invite email", () => {
  it("names the ledger partner when there is one", () => {
    const m = invited("Alex Rivera");
    expect(m.subject).toBe("Alex Rivera started a ledger with you on Tally");
    expect(m.html).toContain("Alex Rivera started a ledger with you.");
    expect(m.text).toContain("Alex Rivera started a ledger with you.");
  });

  it("uses the owner variant when the inviter has no name", () => {
    const m = invited(null);
    expect(m.subject).toBe("You've been invited to Tally");
    expect(m.html).toContain("You've been invited to Tally.");
  });

  it("flattens line breaks in the inviter's name (header injection)", () => {
    const m = invited("Mallory\r\nBcc: victim@example.com");
    expect(m.subject).toBe("Mallory Bcc: victim@example.com started a ledger with you on Tally");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).not.toContain("Mallory\r\n");
  });

  it("links to /login exactly once and escapes the inviter's name", () => {
    const m = invited("<b>Mallory</b>");
    expect(m.html.match(/https:\/\/tally\.andresl\.dev\/login/g)?.length).toBe(1);
    expect(m.html).not.toContain("<b>Mallory</b>");
    expect(m.html).toContain("&lt;b&gt;Mallory&lt;/b&gt;");
    expect(m.text).toContain("Open Tally: https://tally.andresl.dev/login");
  });
});

describe("groupCode", () => {
  it("splits six digits as 3 + 3", () => {
    expect(groupCode("482913")).toBe("482 913");
  });
});

import { describe, expect, it } from "vitest";
import {
  dollars,
  longDate,
  money,
  moneyAbs,
  moneySigned,
  parseDollarsToCents,
  runningLabel,
  shortDate,
} from "../../src/shared/format";

describe("cents display formatting", () => {
  it("formats magnitudes with two digits, integer math only", () => {
    expect(dollars(0)).toBe("0.00");
    expect(dollars(5)).toBe("0.05");
    expect(dollars(50)).toBe("0.50");
    expect(dollars(12345)).toBe("123.45");
    expect(dollars(-12345)).toBe("123.45");
    // A value float math would mangle: 0.1 + 0.2 territory.
    expect(dollars(30)).toBe("0.30");
  });

  it("money() matches the mockup's m()", () => {
    expect(money(4120)).toBe("$41.20");
    expect(money(-4120)).toBe("-$41.20");
    expect(money(0)).toBe("$0.00");
  });

  it("moneySigned uses U+2212 and renders zero as the mockup does", () => {
    expect(moneySigned(1951)).toBe("+$19.51");
    expect(moneySigned(-2367)).toBe("−$23.67");
    // mockup: pos = dv > 0, so zero takes the minus branch
    expect(moneySigned(0)).toBe("−$0.00");
  });

  it("moneyAbs and runningLabel", () => {
    expect(moneyAbs(-15306)).toBe("$153.06");
    expect(runningLabel(0)).toBe("even");
    expect(runningLabel(-1)).toBe("$0.01");
  });

  it("formats dates without Date-object timezone hazards", () => {
    expect(shortDate("2026-08-06")).toBe("Aug 6");
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(longDate("2026-12-31")).toBe("Dec 31, 2026");
  });
});

describe("parseDollarsToCents", () => {
  it("parses plain and decorated dollar strings", () => {
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(parseDollarsToCents("$12.34")).toBe(1234);
    expect(parseDollarsToCents(" 12 ")).toBe(1200);
    expect(parseDollarsToCents("0.05")).toBe(5);
    expect(parseDollarsToCents(".5")).toBe(50);
    expect(parseDollarsToCents("12.")).toBe(1200);
  });

  it("truncates beyond two decimals instead of float-rounding", () => {
    expect(parseDollarsToCents("12.999")).toBe(1299);
    expect(parseDollarsToCents("0.005")).toBe(0);
  });

  it("handles float-hostile inputs exactly", () => {
    expect(parseDollarsToCents("0.10")).toBe(10);
    expect(parseDollarsToCents("0.30")).toBe(30);
    expect(parseDollarsToCents("19.99")).toBe(1999);
    expect(parseDollarsToCents("1.13")).toBe(113);
  });

  it("rejects garbage", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("$")).toBeNull();
    expect(parseDollarsToCents(".")).toBeNull();
    expect(parseDollarsToCents("1.2.3")).toBeNull();
  });
});

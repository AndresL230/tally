// Money math. ALL INTEGER CENTS. Identities hold exactly — every "other
// side" is computed once and the counterpart derived by subtraction (the
// penny rule). BigInt internally so rounding never rides on float division.

export interface SplitItem {
  price_cents: number;
  /** Canonical: otherEmail | payerEmail | 'half'. */
  assigned_to: string;
}

export interface SplitResult {
  items_subtotal_cents: number;
  extra_cents: number;
  other_sub_cents: number;
  payer_sub_cents: number;
  other_extra_cents: number;
  payer_extra_cents: number;
  other_share_cents: number;
  payer_share_cents: number;
}

/** Round num/den to the nearest integer, halves toward +infinity. den > 0. */
export function divRoundHalfUp(num: number, den: number): number {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0) {
    throw new Error("divRoundHalfUp needs safe integers and den > 0");
  }
  const n = BigInt(num);
  const d = BigInt(den);
  let q = n / d; // truncates toward zero
  const r = n % d;
  if (2n * r >= d) q += 1n;
  else if (2n * r < -d) q -= 1n;
  return Number(q);
}

/**
 * Split an itemized receipt between payer and other.
 * - 'half' items are accumulated in HALF-CENT UNITS and rounded once at the
 *   end (never per item).
 * - extra = total - items subtotal (may be negative: discounts). The other
 *   person's extra share is rounded; the payer absorbs the remainder.
 */
export function splitItems(
  items: SplitItem[],
  payerEmail: string,
  otherEmail: string,
  totalCents: number,
): SplitResult {
  if (payerEmail === otherEmail) {
    throw new Error("payer and other must be different people");
  }
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error("total_cents must be a non-negative integer");
  }
  let subtotal = 0;
  let otherHalfUnits = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.price_cents) || item.price_cents < 0) {
      throw new Error("item price_cents must be a non-negative integer");
    }
    subtotal += item.price_cents;
    if (item.assigned_to === otherEmail) {
      otherHalfUnits += 2 * item.price_cents;
    } else if (item.assigned_to === "half") {
      otherHalfUnits += item.price_cents;
    } else if (item.assigned_to !== payerEmail) {
      throw new Error("assigned_to must be a member email or 'half'");
    }
  }
  const otherSub = divRoundHalfUp(otherHalfUnits, 2);
  const extra = totalCents - subtotal;
  const otherExtra = subtotal === 0 ? 0 : divRoundHalfUp(extra * otherSub, subtotal);
  const otherShare = otherSub + otherExtra;
  return {
    items_subtotal_cents: subtotal,
    extra_cents: extra,
    other_sub_cents: otherSub,
    payer_sub_cents: subtotal - otherSub,
    other_extra_cents: otherExtra,
    payer_extra_cents: extra - otherExtra,
    other_share_cents: otherShare,
    payer_share_cents: totalCents - otherShare,
  };
}

/** The OTHER person's share of totalCents at pctOther percent (0..100). */
export function percentShare(totalCents: number, pctOther: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error("total_cents must be a non-negative integer");
  }
  if (!Number.isSafeInteger(pctOther) || pctOther < 0 || pctOther > 100) {
    throw new Error("pct must be an integer between 0 and 100");
  }
  return divRoundHalfUp(totalCents * pctOther, 100);
}

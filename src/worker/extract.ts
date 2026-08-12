// Receipt extraction through Cloudflare AI Gateway -> Anthropic Messages
// API. ONE call per image ever: uploads dedupe on SHA-256 and results are
// cached in receipts.raw_json.
//
// Rule 7: the request forces a tool call (tool_choice) AND the output is
// schema-validated anyway — a negative price or garbage date degrades to
// blank fields and needs_review, never a crash.

import type { Env } from "./env";
import { isValidDate } from "./validate";

export const EXTRACT_MODEL = "claude-haiku-4-5";

const RECEIPT_TOOL = {
  name: "record_receipt",
  description:
    "Record the fields read from a photographed receipt. All amounts are integer cents (e.g. $12.34 is 1234). If the image is not a receipt, set looks_like_receipt to false and leave everything else null.",
  input_schema: {
    type: "object",
    properties: {
      looks_like_receipt: {
        type: "boolean",
        description: "false if the image is not a purchase receipt",
      },
      merchant: {
        type: ["string", "null"],
        description: "The store or restaurant name as printed",
      },
      purchased_on: {
        type: ["string", "null"],
        description: "Purchase date as YYYY-MM-DD, null if unreadable",
      },
      total_cents: {
        type: ["integer", "null"],
        description:
          "The printed grand total in integer cents, including tax and any tip. null if unreadable.",
      },
      items: {
        type: "array",
        description:
          "Line items. Omit tax, tip, subtotal and total lines — items only.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            qty: {
              type: ["string", "null"],
              description: "Quantity suffix if shown, e.g. \"×2\"",
            },
            price_cents: {
              type: "integer",
              description: "Line price in integer cents (for the whole line)",
            },
          },
          required: ["label", "price_cents"],
        },
      },
    },
    required: ["looks_like_receipt"],
  },
} as const;

export interface ExtractedItem {
  label: string;
  qty: string | null;
  price_cents: number;
}

export interface ExtractionFields {
  merchant: string | null;
  purchased_on: string | null;
  total_cents: number | null;
  items: ExtractedItem[];
}

const BLANK: ExtractionFields = {
  merchant: null,
  purchased_on: null,
  total_cents: null,
  items: [],
};

/**
 * Field-level salvage of the model's tool input. Valid fields survive,
 * invalid ones blank out; one bad item poisons the whole item list (a
 * partly-garbled read can't be trusted for money).
 */
export function salvageExtraction(input: unknown): ExtractionFields {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ...BLANK };
  }
  const o = input as Record<string, unknown>;
  if (o.looks_like_receipt !== true) return { ...BLANK };

  let merchant: string | null = null;
  if (typeof o.merchant === "string") {
    const trimmed = o.merchant.trim();
    if (trimmed.length >= 1 && trimmed.length <= 200) merchant = trimmed;
  }

  let purchasedOn: string | null = null;
  if (typeof o.purchased_on === "string" && isValidDate(o.purchased_on)) {
    purchasedOn = o.purchased_on;
  }

  let totalCents: number | null = null;
  if (
    typeof o.total_cents === "number" &&
    Number.isSafeInteger(o.total_cents) &&
    o.total_cents >= 0 &&
    o.total_cents <= 10_000_000
  ) {
    totalCents = o.total_cents;
  }

  let items: ExtractedItem[] = [];
  // >100 items is treated like any other garbled read: the whole list is
  // dropped (the expense route caps at 100 anyway; a receipt that long is
  // far more likely a mis-read than a real purchase).
  if (Array.isArray(o.items) && o.items.length <= 100) {
    const salvaged: ExtractedItem[] = [];
    let allValid = true;
    for (const raw of o.items) {
      if (typeof raw !== "object" || raw === null) {
        allValid = false;
        break;
      }
      const it = raw as Record<string, unknown>;
      const label = typeof it.label === "string" ? it.label.trim() : "";
      const price = it.price_cents;
      const qty =
        it.qty === undefined || it.qty === null
          ? null
          : typeof it.qty === "string"
            ? it.qty.slice(0, 10)
            : undefined;
      if (
        label.length < 1 ||
        label.length > 200 ||
        typeof price !== "number" ||
        !Number.isSafeInteger(price) ||
        price < 0 ||
        qty === undefined
      ) {
        allValid = false;
        break;
      }
      salvaged.push({ label, qty, price_cents: price });
    }
    if (allValid) items = salvaged;
  }

  return { merchant, purchased_on: purchasedOn, total_cents: totalCents, items };
}

/** Pull record_receipt's input out of a Messages API response body. */
export function toolInputOf(responseBody: unknown): unknown | null {
  if (typeof responseBody !== "object" || responseBody === null) return null;
  const content = (responseBody as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "tool_use" &&
      (block as Record<string, unknown>).name === RECEIPT_TOOL.name
    ) {
      return (block as Record<string, unknown>).input ?? null;
    }
  }
  return null;
}

export class GatewayError extends Error {}

function base64Of(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * The single model call. Returns the raw response text (cached verbatim in
 * receipts.raw_json) plus the salvaged fields. Throws GatewayError on
 * HTTP/network failure — the route turns that into status 'failed'.
 */
export async function runExtraction(
  env: Env,
  imageBytes: ArrayBuffer,
  mediaType: string,
): Promise<{ raw: string; fields: ExtractionFields }> {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic/v1/messages`;
  const request = {
    model: EXTRACT_MODEL,
    max_tokens: 2048,
    tools: [RECEIPT_TOOL],
    tool_choice: { type: "tool", name: RECEIPT_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Of(imageBytes),
            },
          },
          {
            type: "text",
            text: "Read this receipt and record its fields. Integer cents. Only real line items — never tax, tip, subtotal or total rows as items.",
          },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new GatewayError(`gateway unreachable: ${String(err)}`);
  }
  const raw = await res.text();
  if (!res.ok) {
    throw new GatewayError(`extraction failed (${res.status})`);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null; // malformed body -> blank fields below
  }
  const fields = salvageExtraction(toolInputOf(parsed));
  return { raw, fields };
}

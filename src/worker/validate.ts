// Request validation helpers. Every failure is a plain message the route
// turns into a 400.

export class ValidationError extends Error {}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' and a real calendar date. */
export function assertDate(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const m = DATE_RE.exec(value);
  if (!m) throw new ValidationError(`${field} must be YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new ValidationError(`${field} has an invalid month`);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > lengths[month - 1]!) {
    throw new ValidationError(`${field} has an invalid day`);
  }
  return value;
}

/** Boolean form of assertDate for salvage paths that blank instead of 400. */
export function isValidDate(value: string): boolean {
  try {
    assertDate(value, "date");
    return true;
  } catch {
    return false;
  }
}

export function assertInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new ValidationError(`${field} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new ValidationError(`${field} must be <= ${opts.max}`);
  }
  return value;
}

export function assertString(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; trim?: boolean } = {},
): string {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const s = opts.trim ? value.trim() : value;
  const min = opts.min ?? 1;
  if (s.length < min) throw new ValidationError(`${field} is too short`);
  if (opts.max !== undefined && s.length > opts.max) {
    throw new ValidationError(`${field} is too long`);
  }
  return s;
}

const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** Client-generated idempotency id (UUIDs qualify). */
export function assertId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new ValidationError(`${field} must be a client-generated id (8-80 url-safe chars)`);
  }
  return value;
}

export function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError("note must be a string");
  if (value.length > 500) throw new ValidationError("note is too long");
  return value;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

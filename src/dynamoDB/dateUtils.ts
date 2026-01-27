// Validators / formatters

export function ensureYYYYMM(v: string) {
  if (!/^\d{4}-\d{2}$/.test(v)) {
    throw new Error(`month must be 'YYYY-MM', got: ${v}`);
  }
  return v;
}

export function yOf(monthYYYYMM: string) {
  return ensureYYYYMM(monthYYYYMM).slice(0, 4);
}

export function mOf(monthYYYYMM: string) {
  return ensureYYYYMM(monthYYYYMM).slice(5, 7);
}

// Normalize input date-like string to strict ISO UTC (fixed length).
// - If input is already ISO-like, it will be parsed and re-serialized via toISOString().
// - If input is "YYYY-MM-DD", we treat it as 00:00:00Z of that day.
export function toIsoUtc(dateLike: unknown): string | undefined {
  if (dateLike == null) return undefined;

  // If it's already a Date
  if (dateLike instanceof Date) {
    if (isNaN(dateLike.getTime())) throw new Error(`Invalid Date input: ${dateLike}`);
    return dateLike.toISOString();
  }

  // If it's a number (likely epoch seconds → convert to ms)
  if (typeof dateLike === "number") {
    const d = new Date(dateLike > 1e12 ? dateLike : dateLike * 1000);
    if (isNaN(d.getTime())) throw new Error(`Invalid epoch time: ${dateLike}`);
    return d.toISOString();
  }

  // If it's a string
  if (typeof dateLike === "string") {
    const trimmed = dateLike.trim();
    if (!trimmed) return undefined;

    // Already ISO-ish
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const d = new Date(trimmed);
      if (isNaN(d.getTime())) throw new Error(`Invalid ISO datetime: ${trimmed}`);
      return d.toISOString();
    }

    // Only date
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(trimmed + "T00:00:00Z").toISOString();
    }

    // Try to auto-fix "YYYY-MM-DD HH:mm:ss"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) {
      const d = new Date(trimmed.replace(" ", "T") + "Z");
      if (isNaN(d.getTime())) throw new Error(`Invalid fallback datetime: ${trimmed}`);
      return d.toISOString();
    }

    // Fallback
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) throw new Error(`Invalid date string: ${trimmed}`);
    return d.toISOString();
  }

  throw new Error(`Unsupported date input type: ${typeof dateLike}`);
}

// If you want "month" aligned to *JST* day boundaries instead of UTC, use this:
// (Default below keeps UTC alignment; switch if your product logic is JST-centric.)
export function monthFromIsoUsingJST(isoUtc: string): string {
  const d = new Date(isoUtc);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000); // UTC+9h
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Convert "8" or "08" to "YYYY-08" using a base date (UTC year by default)
export function toYYYYMM(monthLike: string, baseDate = new Date()): string {
  const m = monthLike.padStart(2, "0").slice(-2);
  const y = String(baseDate.getUTCFullYear());
  return `${y}-${m}`;
}

export function toDateOnly(dateLike: unknown): string | undefined {
  const iso = toIsoUtc(dateLike);
  if (!iso) return undefined;
  return iso.slice(0, 10);
}

export function lastNDaysRange(n: number, now = new Date()) {
  const end = now.toISOString();
  const start = new Date(now.getTime() - n * 86_400_000).toISOString();
  return { start, end };
}
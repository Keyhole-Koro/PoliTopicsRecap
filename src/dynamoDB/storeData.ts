// DynamoDB single-table pattern for Articles + thin indexes
//
// Overview
// --------
// - Main item (one per article):
//     PK = "A#<id>", SK = "META"
//     Holds heavy attributes (dialogs, summaries, etc.).
//
// - Thin index items (for fast listing by facets):
//     PK in { CATEGORY#<category>, PERSON#<name>, KEYWORD#<kw>,
//             IMAGEKIND#<kind>, SESSION#<zero-padded>, HOUSE#<house>, MEETING#<meeting> }
//     SK = "Y#<YYYY>#M#<MM>#D#<ISO-UTC>#A#<id>"
//     Example: "Y#2025#M#08#D#20T12:34:56.000Z#A#a1"
//     Using a fixed-length ISO UTC string guarantees lexicographic order == chronological order.
//
// - Optional "recent keyword" log (for trending views):
//     PK = "KEYWORD_RECENT"
//     SK = "D#<ISO-UTC>#KW#<keyword>#A#<id>"
//
// - GSIs (global listings):
//     ArticleByDate   (GSI1PK = "ARTICLE",       GSI1SK = <ISO-UTC date>)
//     MonthDateIndex  (GSI2PK = "YEAR#YYYY#MONTH#MM", GSI2SK = <ISO-UTC date>)
//
// Notes
// -----
// - Always store dates as ISO UTC (toISOString()) to keep ordering correct.
// - Keep thin index items minimal (list-view fields only) to reduce cost.
// - Initialize DynamoDBDocumentClient with marshallOptions: { removeUndefinedValues: true } upstream.

import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

import type Article from './article';

// ---- Minimal self-contained types (replace with your project types if available) ----
export type Summary = unknown;
export type SoftSummary = unknown;
export type MiddleSummary = unknown;
export type Dialog = { speaker?: string; text?: string };
export type Participant = { name?: string };
export type Keyword = { keyword?: string };
export type Term = { term?: string };

export type Cfg = {
  doc: DynamoDBDocumentClient;
  table_name: string; // single table name
};

// ==========================
// Key helpers
// ==========================
const artPK = (id: string) => `A#${id}`;
const artSK = "META";

// Consider normalizing PERSON/KEYWORD via yomi/slug in production
const catKey = (c: string) => `CATEGORY#${c}`;
const personKey = (p: string) => `PERSON#${p}`;
const kwKey = (k: string) => `KEYWORD#${k}`;
const kindKey = (k: string) => `IMAGEKIND#${k}`;
const sessionKey = (s: number | string) => `SESSION#${String(s).padStart(4, "0")}`;
const houseKey = (h: string) => `HOUSE#${h}`;
const meetingKey = (m: string) => `MEETING#${m}`;

// ==========================
// Validators / formatters
// ==========================
function ensureYYYYMM(v: string) {
  if (!/^\d{4}-\d{2}$/.test(v)) {
    throw new Error(`month must be 'YYYY-MM', got: ${v}`);
  }
  return v;
}
function yOf(monthYYYYMM: string) { return ensureYYYYMM(monthYYYYMM).slice(0, 4); }
function mOf(monthYYYYMM: string) { return ensureYYYYMM(monthYYYYMM).slice(5, 7); }

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

// Compose thin-index SK as "Y#YYYY#M#MM#D#<ISO-UTC>#A#<id>"
const idxSK = (monthYYYYMM: string, isoDate: string, id: string) =>
  `Y#${yOf(monthYYYYMM)}#M#${mOf(monthYYYYMM)}#D#${isoDate}#A#${id}`;

// Convert "8" or "08" to "YYYY-08" using a base date (UTC year by default)
export function toYYYYMM(monthLike: string, baseDate = new Date()): string {
  const m = monthLike.padStart(2, "0").slice(-2);
  const y = String(baseDate.getUTCFullYear());
  return `${y}-${m}`;
}

export function lastNDaysRange(n: number, now = new Date()) {
  const end = now.toISOString();
  const start = new Date(now.getTime() - n * 86_400_000).toISOString();
  return { start, end };
}

// ==========================
// BatchWrite helper (max 25 per request) with simple retry
// ==========================
async function batchPutAll(
  doc: DynamoDBDocumentClient,
  table: string,
  items: any[]
) {
  let i = 0;
  while (i < items.length) {
    const slice = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    const res = await doc.send(
      new BatchWriteCommand({ RequestItems: { [table]: slice } })
    );

    const unp = res.UnprocessedItems?.[table] ?? [];
    if (unp.length > 0) {
      // naive backoff + requeue unprocessed items into the current window
      await new Promise((r) => setTimeout(r, 200));
      const retryItems = unp.map((u) => u.PutRequest!.Item);
      items.splice(i, 0, ...retryItems);
    } else {
      i += 25;
    }
  }
}

// ==========================
// Store: main item + thin index items
// ==========================
export default async function storeData(
  config: Cfg,
  article: Article
): Promise<{ ok: boolean; id: string }> {
  const { doc, table_name: TableName } = config;

  // ---- Normalize date & month to keep ordering and prefix filters consistent
  const iso = toIsoUtc(article.date);

  if (!iso) {
    throw new Error(`Invalid article.date, cannot normalize to ISO UTC: ${article.date}`);
  }

  // Choose which alignment you want for "month":
  //   1) UTC-based (default here)
  const monthNorm = ensureYYYYMM(article.month ?? iso.slice(0, 7));
  //   2) JST-based (uncomment the next line and comment out the UTC line above if needed)
  // const monthNorm = monthFromIsoUsingJST(iso);

  const gsi2pk = `Y#${yOf(monthNorm)}#M#${mOf(monthNorm)}`;

  // ---- Main item (heavy fields kept here)
  const mainItem = {
    ...article,            // keep original fields (will be overridden below)
    date: iso,             // enforce ISO UTC
    month: monthNorm,      // align month with normalized date
    PK: artPK(article.id),
    SK: artSK,
    type: "ARTICLE",

    // GSIs for global listings
    GSI1PK: "ARTICLE",
    GSI1SK: iso,
    GSI2PK: gsi2pk,
    GSI2SK: iso,
  };

  await doc.send(new PutCommand({ TableName, Item: mainItem }));

  // ---- Thin index items (minimal fields for list views only)
  const thinBase = {
    type: "THIN_INDEX",
    articleId: article.id,
    title: article.title,
    date: iso,             // ISO UTC
    month: monthNorm,      // aligned to date
    imageKind: article.imageKind,
    nameOfMeeting: article.nameOfMeeting,
    session: article.session,
    nameOfHouse: article.nameOfHouse,
    // Add description if your list UI needs it (trade-off: storage + write cost).
    // description: article.description,
  };

  const sk = idxSK(monthNorm, iso, article.id);
  const idxItems: any[] = [];

  // Category indexes
  for (const c of article.categories ?? []) {
    const cat = (c ?? "").trim();
    if (!cat) continue;
    idxItems.push({
      PK: catKey(cat),
      SK: sk,
      kind: "CATEGORY_INDEX",
      ...thinBase,
    });
  }

  // Person indexes
  for (const p of article.participants ?? []) {
    const name = (p?.name ?? "").trim();
    if (!name) continue;
    idxItems.push({
      PK: personKey(name),
      SK: sk,
      kind: "PERSON_INDEX",
      ...thinBase,
    });
  }

  // Keyword indexes + optional recent keyword occurrence log
  for (const k of article.keywords ?? []) {
    const kw = (k?.keyword ?? "").trim();
    if (!kw) continue;
    idxItems.push({
      PK: kwKey(kw),
      SK: sk,
      kind: "KEYWORD_INDEX",
      ...thinBase,
    });

    // Optional: recent keyword occurrence (for "trending keywords" views)
    idxItems.push({
      PK: "KEYWORD_RECENT",
      SK: `D#${iso}#KW#${kw}#A#${article.id}`,
      kind: "KEYWORD_OCCURRENCE",
      keyword: kw,
      articleId: article.id,
      title: article.title,
      date: iso,
      month: monthNorm,
    });
  }

  // Other facet indexes
  idxItems.push({
    PK: kindKey(article.imageKind),
    SK: sk,
    kind: "IMAGEKIND_INDEX",
    ...thinBase,
  });

  idxItems.push({
    PK: sessionKey(article.session),
    SK: sk,
    kind: "SESSION_INDEX",
    ...thinBase,
  });

  if (article.nameOfHouse?.trim()) {
    idxItems.push({
      PK: houseKey(article.nameOfHouse.trim()),
      SK: sk,
      kind: "HOUSE_INDEX",
      ...thinBase,
    });
  }

  if (article.nameOfMeeting?.trim()) {
    idxItems.push({
      PK: meetingKey(article.nameOfMeeting.trim()),
      SK: sk,
      kind: "MEETING_INDEX",
      ...thinBase,
    });
  }

  if (idxItems.length) {
    await batchPutAll(doc, TableName, idxItems);
  }

  return { ok: true, id: article.id };
}
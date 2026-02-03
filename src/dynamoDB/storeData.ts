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
} from "@aws-sdk/lib-dynamodb";

import type Article from './article';
import {
  toDateOnly,
  ensureYYYYMM,
  yOf,
  mOf,
  monthFromIsoUsingJST,
} from "./dateUtils";
import {
  artPK,
  artSK,
  idxSK,
  catKey,
  personKey,
  kwKey,
  kindKey,
  sessionKey,
  houseKey,
  meetingKey,
} from "./dbKeys";
import {
  persistArticleAsset,
  type ArticleAssetStorage,
} from "./assetStorage";
import { batchPutAll } from "./batchWrite";

// Re-export for compatibility with existing consumers/tests
export * from "./dateUtils";
export * from "./assetStorage";

export type Cfg = {
  doc: DynamoDBDocumentClient;
  table_name: string; // single table name
  assets: ArticleAssetStorage;
};


// ==========================
// Store: main item + thin index items
// ==========================
export default async function storeData(
  config: Cfg,
  article: Article
): Promise<{ ok: boolean; id: string }> {
  const { doc, table_name: TableName, assets } = config;

  // ---- Normalize date & month to keep ordering and prefix filters consistent
  const isoDate = toDateOnly(article.date);

  if (!isoDate) {
    throw new Error(`Invalid article.date, cannot normalize to date-only string: ${article.date}`);
  }

  // Choose which alignment you want for "month":
  //   1) UTC-based (default here)
  const monthNorm = ensureYYYYMM(article.month ?? isoDate.slice(0, 7));
  //   2) JST-based (uncomment the next line and comment out the UTC line above if needed)
  // const monthNorm = monthFromIsoUsingJST(iso);

  const gsi2pk = `Y#${yOf(monthNorm)}#M#${mOf(monthNorm)}`;

  const {
    key_points,
    summary,
    soft_language_summary,
    middle_summary,
    dialogs,
    ...articleRest
  } = article;

  const { key: assetKey, url: assetUrl } = await persistArticleAsset(assets, article.id, {
    key_points,
    summary,
    soft_language_summary,
    middle_summary,
    dialogs,
  });

  // ---- Main item (heavy fields kept in S3 references)
  const mainItem = {
    ...articleRest,
    date: isoDate,         // date-only for display and ordering
    month: monthNorm,      // align month with normalized date
    PK: artPK(article.id),
    SK: artSK,
    type: "ARTICLE",
    asset_url: assetUrl,
    asset_key: assetKey,

    // GSIs for global listings
    GSI1PK: "ARTICLE",
    GSI1SK: isoDate,
    GSI2PK: gsi2pk,
    GSI2SK: isoDate,
  };

  await doc.send(new PutCommand({ TableName, Item: mainItem }));

  // ---- Thin index items (minimal fields for list views only)
  const thinBase = {
    type: "THIN_INDEX",
    articleId: article.id,
    issueID: article.issueID,
    title: article.title,
    description: article.description,
    categories: article.categories ?? [],
    keywords: article.keywords ?? [],
    participants: article.participants ?? [],
    date: isoDate,         // date-only
    month: monthNorm,      // aligned to date
    imageKind: article.imageKind,
    nameOfMeeting: article.nameOfMeeting,
    session: article.session,
    nameOfHouse: article.nameOfHouse,
    asset_key: assetKey,
    asset_url: assetUrl,
    // Add description if your list UI needs it (trade-off: storage + write cost).
    // description: article.description,
  };

  const sk = idxSK(monthNorm, isoDate, article.id);
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

  // Keyword indexes
  for (const k of article.keywords ?? []) {
    const kw = (k?.keyword ?? "").trim();
    if (!kw) continue;
    idxItems.push({
      PK: kwKey(kw),
      SK: sk,
      kind: "KEYWORD_INDEX",
      ...thinBase,
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

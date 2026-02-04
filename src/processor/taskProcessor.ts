import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import {
  markChunkReady,
  markTaskSucceeded,
  type TaskRepositoryConfig,
} from "../tasks/taskRepository";
import type { TaskItem } from "../tasks/types";
import type { LlmClient } from "@llm/llmClient";
import type { ArticleAssetStorage } from "../dynamoDB/storeData";
import storeData from "../dynamoDB/storeData";
import type Article from "../dynamoDB/article";
import { fetchObjectText, parseS3Uri, uploadObject } from "@utils/s3";
import { appConfig } from "../config";
import { buildReduceInput, buildSpeechInput, stripCodeFence } from "../prompts/promptInput";
import {
  attachSpeakerMetadata,
  assertAttachedAssets,
  assertNonEmptySpeakerMap,
  loadSpeakerMapFromAttachedAssets,
  type SpeakerMap,
} from "./speakerMetadata";
import {
  notifyArticlePersisted,
  notifyArticlePersistenceSkipped,
  notifyTaskWarning,
} from "./notifications";

export type TaskProcessorArgs = {
  task: TaskItem;
  docClient: DynamoDBDocumentClient;
  repoConfig: TaskRepositoryConfig;
  s3Client: S3Client;
  llmClient: LlmClient;
  articleTableName: string;
  articleAssets: ArticleAssetStorage;
  meeting: TaskItem["meeting"];
};

export async function handleDirectTask(args: TaskProcessorArgs): Promise<void> {
  const { task, s3Client, llmClient, docClient, repoConfig, articleTableName, articleAssets, meeting } = args;
  console.log(`[TaskProcessor] SINGLE_CHUNK: Starting task ${task.pk}`);
  
  try {
    assertAttachedAssets(task);
    const promptUrl = requireTaskUrl(task, "prompt_url");
    const resultUrl = requireTaskUrl(task, "result_url");
    const promptText = await loadPromptText(s3Client, promptUrl, task);
    const attachedMap = await loadSpeakerMapFromAttachedAssets(s3Client, task.attachedAssets.speakerMetadataUrl);
    assertNonEmptySpeakerMap(attachedMap, "attached assets");
    
    console.log(`[TaskProcessor] Fetched prompt for ${task.pk} (${promptText.length} chars). Preview: ${promptText.slice(0, 100)}...`);

    const llmResult = await llmClient.generate({
      messages: [{ role: "user", content: promptText }],
      maxOutputTokens: appConfig.geminiMaxOutputToken,
    });
    console.log(`[TaskProcessor] LLM response for ${task.pk} (${llmResult.text.length} chars). Preview: ${llmResult.text.slice(0, 100)}...`);

    await writeS3Text(s3Client, resultUrl, llmResult.text);
    console.log(`[TaskProcessor] Uploaded result to ${resultUrl}`);

    const persistResult = await persistArticleIfPossible(
      docClient,
      articleTableName,
      llmResult.text,
      articleAssets,
      meeting,
      attachedMap,
      task,
      llmClient,
    );

    if (!persistResult.persisted) {
      await notifyArticlePersistenceSkipped(task, persistResult.reason, persistResult.payloadDumpUri);
      throw new Error(`Failed to persist article for ${task.pk}: ${persistResult.reason}`);
    }

    await notifyArticlePersisted(task, persistResult.article);
    console.log(`[TaskProcessor] Persisted article for ${task.pk}`);
    await markTaskSucceeded(docClient, repoConfig, task);
    console.log(`[TaskProcessor] SINGLE_CHUNK: Completed task ${task.pk}`);
  } catch (err) {
    console.error(`[TaskProcessor] SINGLE_CHUNK failed for ${task.pk}`, err);
    throw err;
  }
}

export async function handleChunkedTask(args: TaskProcessorArgs): Promise<void> {
  const { task, s3Client, llmClient, docClient, repoConfig, articleTableName, articleAssets, meeting } = args;
  console.log(`[TaskProcessor] CHUNKED: Starting processing for ${task.pk}`);
  assertAttachedAssets(task);
  if (!task.chunks || task.chunks.length === 0) {
    console.warn("Chunked task missing chunk definitions", { taskId: task.pk });
    await notifyTaskWarning(task, "Chunked task missing chunk definitions");
    await markTaskSucceeded(docClient, repoConfig, task);
    return;
  }

  const nextChunk = task.chunks.find((chunk) => chunk.status !== "completed");
  if (nextChunk) {
    console.log(`[TaskProcessor] Processing chunk ${nextChunk.id} for ${task.pk}`);
    try {
      const promptText = await loadPromptText(s3Client, nextChunk.prompt_url, task);
      console.log(`[TaskProcessor] Fetched chunk prompt (${promptText.length} chars). Preview: ${promptText.slice(0, 100)}...`);
      
      const llmResult = await llmClient.generate({
        messages: [{ role: "user", content: promptText }],
        maxOutputTokens: appConfig.geminiMaxOutputToken,
      });
      console.log(`[TaskProcessor] Chunk LLM response (${llmResult.text.length} chars). Preview: ${llmResult.text.slice(0, 100)}...`);

      await writeS3Text(s3Client, nextChunk.result_url, llmResult.text);
      console.log(`[TaskProcessor] Uploaded chunk result to ${nextChunk.result_url}`);
      
      await markChunkReady(docClient, repoConfig, task, nextChunk.id);
      console.log(`[TaskProcessor] Marked chunk ${nextChunk.id} completed`);
    } catch (err) {
      console.error(`[TaskProcessor] Chunk processing failed for ${nextChunk.id}`, err);
      throw err;
    }
    return;
  }

  console.log(`[TaskProcessor] All chunks completed for ${task.pk}. Running REDUCE phase.`);
  try {
    const promptUrl = requireTaskUrl(task, "prompt_url");
    const resultUrl = requireTaskUrl(task, "result_url");
    const reducePrompt = await loadPromptText(s3Client, promptUrl, task);
    console.log(`[TaskProcessor] Fetched reduce prompt (${reducePrompt.length} chars). Preview: ${reducePrompt.slice(0, 100)}...`);
    
    const attachedMap = await loadSpeakerMapFromAttachedAssets(s3Client, task.attachedAssets.speakerMetadataUrl);
    assertNonEmptySpeakerMap(attachedMap, "attached assets");
    const speakerMap = attachedMap;

    const reduceResult = await llmClient.generate({
      messages: [{ role: "user", content: reducePrompt }],
      maxOutputTokens: appConfig.geminiMaxOutputToken,
    });
    console.log(`[TaskProcessor] Reduce LLM response (${reduceResult.text.length} chars). Preview: ${reduceResult.text.slice(0, 100)}...`);

    await writeS3Text(s3Client, resultUrl, reduceResult.text);
    console.log(`[TaskProcessor] Uploaded reduce result to ${resultUrl}`);

    const persistResult = await persistArticleIfPossible(
      docClient,
      articleTableName,
      reduceResult.text,
      articleAssets,
      meeting,
      speakerMap,
      task,
      llmClient,
    );

    if (!persistResult.persisted) {
      await notifyArticlePersistenceSkipped(task, persistResult.reason, persistResult.payloadDumpUri);
      throw new Error(`Failed to persist final article for ${task.pk}: ${persistResult.reason}`);
    }

    await notifyArticlePersisted(task, persistResult.article);
    console.log(`[TaskProcessor] Persisted final article for ${task.pk}`);
    await markTaskSucceeded(docClient, repoConfig, task);
    console.log(`[TaskProcessor] CHUNKED: Completed task ${task.pk}`);
  } catch (err) {
    console.error(`[TaskProcessor] Reduce phase failed for ${task.pk}`, err);
    throw err;
  }
}

async function readS3Text(client: S3Client, uri: string): Promise<string> {
  const { bucket, key } = parseS3Uri(uri);
  return fetchObjectText(client, bucket, key);
}

async function writeS3Text(client: S3Client, uri: string, body: string): Promise<void> {
  const { bucket, key } = parseS3Uri(uri);
  await uploadObject({
    client,
    bucket,
    key,
    body,
    opts: {
      contentType: "application/json; charset=utf-8",
    },
  });
}

type PersistResult =
  | { persisted: true; article: Article }
  | { persisted: false; reason: string; payloadDumpUri?: string };

const DIALOG_RECOVERY_MAX_ATTEMPTS = 2;
const DIALOG_RECOVERY_BATCH_SIZE = 25;

async function persistArticleIfPossible(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  payloadText: string,
  assets: ArticleAssetStorage,
  meeting: TaskItem["meeting"],
  speakerMap: SpeakerMap,
  task: TaskItem,
  llmClient: LlmClient,
): Promise<PersistResult> {
  try {
    const jsonText = sanitizeJsonPayload(payloadText);
    type ArticlePayload = Article & { prompt_version?: string };
    const rawArticle = JSON.parse(jsonText) as ArticlePayload;
    if (typeof rawArticle !== "object" || rawArticle === null) {
      throw new Error("Reduced payload is not an object");
    }
    if (!rawArticle.summary) {
      throw new Error("Reduced payload is missing summary");
    }
    if (!rawArticle.soft_language_summary) {
      throw new Error("Reduced payload is missing soft_language_summary");
    }
    const { prompt_version: _promptVersion, ...articlePayload } = rawArticle;
    const dialogsWithPlaceholders = fillMissingDialogOrders(
      Array.isArray(articlePayload.dialogs) ? articlePayload.dialogs : [],
      speakerMap,
    );
    const dialogsWithRecovery = await recoverMissingDialogOrders({
      dialogs: dialogsWithPlaceholders,
      speakerMap,
      llmClient,
      meeting,
      taskId: task.pk,
    });
    assertDialogOrdersComplete(dialogsWithRecovery, speakerMap, meeting);
    const issueID = meeting?.issueID ?? (articlePayload as { issueID?: string }).issueID ?? rawArticle.id;
    const normalizedKeyPoints = Array.isArray(articlePayload.key_points)
      ? articlePayload.key_points.map((point) => (typeof point === "string" ? point.trim() : "")).filter(Boolean)
      : [];
    const withFallbacks: Article = {
      ...articlePayload,
      id: task.pk,
      issueID,
      key_points: normalizedKeyPoints,
      dialogs: attachSpeakerMetadata(dialogsWithRecovery, speakerMap),
      date: articlePayload.date ?? meeting?.date,
      month: articlePayload.month ?? (meeting?.date ? meeting.date.slice(0, 7) : articlePayload.month),
      nameOfMeeting: articlePayload.nameOfMeeting ?? meeting?.nameOfMeeting ?? "",
      nameOfHouse: articlePayload.nameOfHouse ?? meeting?.nameOfHouse ?? "",
      session: articlePayload.session ?? meeting?.session ?? articlePayload.session,
    };
    await storeData({ doc: docClient, table_name: tableName, assets }, withFallbacks);
    console.log("[taskProcessor] article persisted", { tableName, meetingDate: withFallbacks.date });
    return { persisted: true, article: withFallbacks };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    let payloadDumpUri: string | undefined;
    try {
      payloadDumpUri = await storeInvalidPayload(assets, task.pk, payloadText, reason);
      console.warn("[handler] Skipping article persistence", { error: reason, payloadDumpUri, taskId: task.pk });
    } catch (uploadError) {
      const uploadReason = uploadError instanceof Error ? uploadError.message : String(uploadError);
      console.warn("[handler] Skipping article persistence (payload dump failed)", {
        error: reason,
        uploadError: uploadReason,
        taskId: task.pk,
        bucket: assets.bucket,
        environment: appConfig.environment,
        r2Configured: !!appConfig.r2,
        r2Endpoint: appConfig.r2?.endpoint,
      });
    }
    return { persisted: false, reason, payloadDumpUri };
  }
}

type RecoverMissingDialogOrdersArgs = {
  dialogs: Article["dialogs"];
  speakerMap: SpeakerMap;
  llmClient: LlmClient;
  meeting?: TaskItem["meeting"];
  taskId: string;
};

async function recoverMissingDialogOrders(args: RecoverMissingDialogOrdersArgs): Promise<Article["dialogs"]> {
  const { speakerMap, llmClient, meeting, taskId } = args;
  if (!(speakerMap instanceof Map) || speakerMap.size === 0) {
    return args.dialogs;
  }

  let currentDialogs = Array.isArray(args.dialogs) ? args.dialogs : [];
  for (let attempt = 1; attempt <= DIALOG_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
    const check = inspectDialogOrders(currentDialogs, speakerMap);
    if (check.missing.length === 0 || check.duplicates.length > 0 || check.extras.length > 0) {
      return currentDialogs;
    }
    if (isAllowedDialogOrderGap(check, meeting)) {
      return currentDialogs;
    }

    const batches = chunkNumbers(check.missing, DIALOG_RECOVERY_BATCH_SIZE);
    let recoveredAny = false;
    for (const missingBatch of batches) {
      const recovered = await generateMissingDialogsFromLlm({
        missingOrders: missingBatch,
        speakerMap,
        llmClient,
        meeting,
      });
      if (recovered.length === 0) {
        continue;
      }
      currentDialogs = mergeDialogsByOrder(currentDialogs, recovered);
      recoveredAny = true;
    }

    const postCheck = inspectDialogOrders(currentDialogs, speakerMap);
    console.warn("[taskProcessor] Missing dialog recovery attempt result", {
      taskId,
      issueID: meeting?.issueID ?? "unknown",
      attempt,
      remainingMissing: postCheck.missing,
      recoveredAny,
    });

    if (postCheck.missing.length === 0 || !recoveredAny) {
      return currentDialogs;
    }
  }
  return currentDialogs;
}

type GenerateMissingDialogsArgs = {
  missingOrders: number[];
  speakerMap: SpeakerMap;
  llmClient: LlmClient;
  meeting?: TaskItem["meeting"];
};

async function generateMissingDialogsFromLlm(args: GenerateMissingDialogsArgs): Promise<Article["dialogs"]> {
  const { missingOrders, speakerMap, llmClient, meeting } = args;
  if (!missingOrders.length) return [];

  const prompt = buildDialogRecoveryPrompt(missingOrders, speakerMap, meeting);
  const llmResult = await llmClient.generate({
    messages: [{ role: "user", content: prompt }],
    maxOutputTokens: Math.min(appConfig.geminiMaxOutputToken, 3000),
  });
  const parsed = tryParseJson(sanitizeJsonPayload(llmResult.text));
  const dialogCandidate = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray((parsed as { dialogs?: unknown[] }).dialogs)
      ? (parsed as { dialogs: unknown[] }).dialogs
      : [];

  return normalizeRecoveredDialogs(dialogCandidate, missingOrders);
}

function buildDialogRecoveryPrompt(
  missingOrders: number[],
  speakerMap: SpeakerMap,
  meeting?: TaskItem["meeting"],
): string {
  const lines = missingOrders
    .map((order) => {
      const meta = speakerMap.get(order);
      const speaker = meta?.speaker?.trim() || "不明";
      const text = (meta?.originalText ?? "").trim();
      return `[order ${order}] speaker=${speaker}\n${text}`;
    })
    .join("\n\n");

  const issue = meeting?.issueID ?? "unknown";
  return `次の発言だけを補填してください。missing dialog order を埋めるための再生成タスクです。

制約:
- 出力は JSON のみ。コードフェンス禁止。
- 形式: {"dialogs":[...]} のみ。
- dialogs は指定された order を1件ずつ、重複なしで出力。
- order / summary_sections / reaction のみを出力（speakerやoriginal_textは不要）。
- summary_sections は最低1要素、bullets も最低1要素。
- bullets の point/quote/detail は空文字禁止。
- reaction は "賛成" | "反対" | "質問" | "回答" | "中立" のいずれか。

対象 issueID: ${issue}
対象 order: ${missingOrders.join(",")}

入力:
${lines}
`;
}

function normalizeRecoveredDialogs(rawDialogs: unknown[], missingOrders: number[]): Article["dialogs"] {
  const missingSet = new Set(missingOrders);
  const out: Article["dialogs"] = [];
  for (const raw of rawDialogs) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Record<string, unknown>;
    const order = Number(candidate.order);
    if (!Number.isFinite(order) || !missingSet.has(order)) continue;
    const summary_sections = normalizeSummarySections(candidate.summary_sections);
    if (summary_sections.length === 0) continue;
    const reaction = normalizeReaction(candidate.reaction);
    out.push({
      order,
      summary_sections,
      reaction,
      original_text: "",
      speaker: "",
    });
  }
  return out;
}

function normalizeSummarySections(value: unknown): Article["dialogs"][number]["summary_sections"] {
  if (!Array.isArray(value)) return [];
  const sections: Article["dialogs"][number]["summary_sections"] = [];
  for (const section of value) {
    if (typeof section !== "object" || section === null) continue;
    const candidate = section as Record<string, unknown>;
    const title = typeof candidate.title === "string" ? candidate.title : "";
    if (!isDialogSectionTitle(title)) continue;
    if (!Array.isArray(candidate.bullets)) continue;
    const bullets = candidate.bullets
      .map((bullet) => {
        if (typeof bullet !== "object" || bullet === null) return null;
        const entry = bullet as Record<string, unknown>;
        const point = typeof entry.point === "string" ? entry.point.trim() : "";
        const quote = typeof entry.quote === "string" ? entry.quote.trim() : "";
        const detail = typeof entry.detail === "string" ? entry.detail.trim() : "";
        if (!point || !quote || !detail) return null;
        return { point, quote, detail };
      })
      .filter((bullet): bullet is NonNullable<typeof bullet> => bullet !== null);
    if (!bullets.length) continue;
    sections.push({ title, bullets });
  }
  return sections;
}

function normalizeReaction(value: unknown): Article["dialogs"][number]["reaction"] | undefined {
  if (value !== "賛成" && value !== "反対" && value !== "質問" && value !== "回答" && value !== "中立") {
    return undefined;
  }
  return value;
}

function isDialogSectionTitle(value: string): value is NonNullable<Article["dialogs"][number]["summary_sections"]>[number]["title"] {
  return (
    value === "主張" ||
    value === "説明" ||
    value === "質問" ||
    value === "回答" ||
    value === "根拠" ||
    value === "影響" ||
    value === "次の対応" ||
    value === "決定"
  );
}

function mergeDialogsByOrder(dialogs: Article["dialogs"], recovered: Article["dialogs"]): Article["dialogs"] {
  if (!recovered.length) return dialogs;
  const existing = new Set<number>();
  for (const dialog of dialogs) {
    if (typeof dialog.order === "number" && Number.isFinite(dialog.order)) {
      existing.add(dialog.order);
    }
  }
  const additions = recovered.filter((dialog) => !existing.has(dialog.order));
  if (!additions.length) return dialogs;
  return [...dialogs, ...additions].sort((a, b) => a.order - b.order);
}

function chunkNumbers(values: number[], size: number): number[][] {
  if (size <= 0 || values.length === 0) return [values];
  const out: number[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function assertDialogOrdersComplete(
  dialogs: Article["dialogs"] | undefined,
  speakerMap: SpeakerMap,
  meeting?: TaskItem["meeting"],
): void {
  const check = inspectDialogOrders(dialogs, speakerMap);
  if (check.missing.length === 0 && check.duplicates.length === 0 && check.extras.length === 0) {
    return;
  }

  if (isAllowedDialogOrderGap(check, meeting)) return;

  const issue = meeting?.issueID ?? "unknown";
  const parts = [
    `Dialog orders incomplete for ${issue}`,
    check.missing.length ? `missing=${check.missing.join(",")}` : null,
    check.duplicates.length ? `duplicates=${check.duplicates.join(",")}` : null,
    check.extras.length ? `extras=${check.extras.join(",")}` : null,
  ].filter(Boolean);
  throw new Error(parts.join(" "));
}

type DialogOrderInspection = {
  missing: number[];
  duplicates: string[];
  extras: number[];
  maxExpected: number | null;
};

function inspectDialogOrders(dialogs: Article["dialogs"] | undefined, speakerMap: SpeakerMap): DialogOrderInspection {
  if (!(speakerMap instanceof Map) || speakerMap.size === 0) {
    return { missing: [], duplicates: [], extras: [], maxExpected: null };
  }
  if (!Array.isArray(dialogs)) {
    throw new Error(`Dialogs must be an array to validate orders (expected ${speakerMap.size})`);
  }

  const expectedOrders = Array.from(speakerMap.keys());
  const expectedSet = new Set(expectedOrders);
  const counts = new Map<number, number>();
  for (const dialog of dialogs) {
    const order = (dialog as { order?: number }).order;
    if (typeof order !== "number" || !Number.isFinite(order)) {
      continue;
    }
    counts.set(order, (counts.get(order) ?? 0) + 1);
  }

  const missing = expectedOrders.filter((order) => !counts.has(order));
  const duplicates = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([order, count]) => `${order}(${count})`);
  const extras = Array.from(counts.keys()).filter((order) => !expectedSet.has(order));
  const maxExpected = expectedOrders.length > 0 ? Math.max(...expectedOrders) : null;

  return { missing, duplicates, extras, maxExpected };
}

function isAllowedDialogOrderGap(check: DialogOrderInspection, meeting?: TaskItem["meeting"]): boolean {
  if (
    check.missing.length === 1 &&
    check.duplicates.length === 0 &&
    check.extras.length === 0 &&
    check.maxExpected !== null &&
    check.missing[0] === check.maxExpected
  ) {
    console.warn(
      `[taskProcessor] Allowing missing last dialog order ${check.maxExpected} for ${meeting?.issueID ?? "unknown"}`
    );
    return true;
  }

  if (
    check.duplicates.length === 0 &&
    check.extras.length === 0 &&
    check.missing.length > 0 &&
    check.missing.every((order) => order === 0 || order === 1)
  ) {
    console.warn(
      `[taskProcessor] Allowing missing dialog orders ${check.missing.join(",")} for ${meeting?.issueID ?? "unknown"}`
    );
    return true;
  }
  return false;
}

function fillMissingDialogOrders(
  dialogs: Article["dialogs"],
  speakerMap: SpeakerMap,
): Article["dialogs"] {
  if (!Array.isArray(dialogs)) return [];
  if (!(speakerMap instanceof Map) || speakerMap.size === 0) return dialogs;

  const existingOrders = new Set<number>();
  for (const dialog of dialogs) {
    if (typeof dialog.order === "number" && Number.isFinite(dialog.order)) {
      existingOrders.add(dialog.order);
    }
  }

  const placeholders: Article["dialogs"] = [];
  for (const order of speakerMap.keys()) {
    if (existingOrders.has(order)) continue;
    if (order !== 0 && order !== 1) continue;
    const meta = speakerMap.get(order);
    placeholders.push({
      order,
      summary_sections: [{ title: "説明", bullets: [{ point: "" }] }],
      original_text: meta?.originalText ?? "",
      speaker: meta?.speaker ?? "",
      speakerYomi: meta?.speakerYomi ?? undefined,
      speakerGroup: meta?.speakerGroup ?? undefined,
      speakerPosition: meta?.speakerPosition ?? undefined,
    });
  }

  if (placeholders.length === 0) return dialogs;
  return [...dialogs, ...placeholders].sort((a, b) => a.order - b.order);
}

function sanitizeJsonPayload(payloadText: string): string {
  return stripCodeFence(payloadText);
}

function requireTaskUrl(task: TaskItem, field: "prompt_url" | "result_url"): string {
  const value = task[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Task ${task.pk} missing required ${field}`);
  }
  return value;
}

async function loadPromptText(
  client: S3Client,
  uri: string,
  task: TaskItem,
): Promise<string> {
  const rawText = await readS3Text(client, uri);
  const payload = tryParseJson(rawText);
  if (!payload) return rawText;

  if (
    payload.mode === "single_chunk" &&
    typeof payload.singleChunkPromptTemplate === "string" &&
    Array.isArray(payload.speeches)
  ) {
    const input = buildSpeechInput({
      speeches: payload.speeches,
      meeting: payload.meeting ?? task.meeting,
      taskId: task.pk,
    });
    return appendInput(payload.singleChunkPromptTemplate, input);
  }

  if (payload.mode === "chunked" && typeof payload.reducePromptTemplate === "string") {
    const chunkUrls: string[] =
      (Array.isArray(payload.chunkResultUrls) ? payload.chunkResultUrls : undefined) ??
      (Array.isArray(payload.chunks) ? payload.chunks.map((chunk: any) => chunk.result_url).filter(Boolean) : undefined) ??
      (Array.isArray(task.chunks) ? task.chunks.map((chunk) => chunk.result_url).filter(Boolean) : []);

    if (!chunkUrls.length) {
      console.warn(`[TaskProcessor] Reduce prompt payload missing chunk results for ${task.pk}`);
      return rawText;
    }

    const chunkResults = await Promise.all(
      chunkUrls.map(async (chunkUrl, index) => ({
        id: payload.chunks?.[index]?.id ?? task.chunks?.[index]?.id,
        text: await readS3Text(client, chunkUrl),
      })),
    );

    const input = buildReduceInput({
      chunkResults,
      meeting: payload.meeting ?? task.meeting,
      taskId: task.pk,
    });
    return appendInput(payload.reducePromptTemplate, input);
  }

  if (typeof payload.prompt === "string" && Array.isArray(payload.speeches)) {
    const input = buildSpeechInput({
      speeches: payload.speeches,
      contextBefore: Array.isArray(payload.contextBefore) ? payload.contextBefore : undefined,
      contextAfter: Array.isArray(payload.contextAfter) ? payload.contextAfter : undefined,
      meeting: payload.meeting ?? task.meeting,
      taskId: task.pk,
    });
    return appendInput(payload.prompt, input);
  }

  return rawText;
}

function appendInput(prompt: string, input: string): string {
  if (!input) return prompt;
  if (prompt.endsWith("\n") || input.startsWith("\n")) {
    return `${prompt}${input}`;
  }
  return `${prompt}\n${input}`;
}

function tryParseJson(text: string): any | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

// NOTE: This function uses 'assets' which is R2Client, to store invalid payloads.
// Since this is related to the Final Article persistence (or failure thereof), using R2 (assets) is appropriate here.
async function storeInvalidPayload(
  assets: ArticleAssetStorage,
  taskId: string,
  payloadText: string,
  reason: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `invalid-payloads/${appConfig.environment}/${taskId}/${timestamp}.txt`;
  await uploadObject({
    client: assets.client as unknown as S3Client,
    bucket: assets.bucket,
    key,
    body: payloadText,
    opts: {
      contentType: "text/plain; charset=utf-8",
      metadata: {
        error: reason.slice(0, 200),
      },
    },
  });
  return `s3://${assets.bucket}/${key}`;
}

export {
  attachSpeakerMetadata,
  extractSpeakerMapFromAttachedAssetsPayload,
  extractSpeakerMapFromPrompt,
} from "./speakerMetadata";

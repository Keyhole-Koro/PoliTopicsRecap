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
  console.log("[taskProcessor] single_chunk task start", { taskId: task.pk });
  const promptText = await readS3Text(s3Client, task.prompt_url);
  const speakerMap = extractSpeakerMapFromPrompt(promptText);
  console.log("[taskProcessor] prompt fetched", { taskId: task.pk, promptUrl: task.prompt_url });
  const llmResult = await llmClient.generate({
    messages: [{ role: "user", content: promptText }],
  });
  console.log("[taskProcessor] llm response received", { taskId: task.pk, llm: task.llm, model: task.llmModel });
  await writeS3Text(s3Client, task.result_url, llmResult.text);
  console.log("[taskProcessor] result uploaded", { taskId: task.pk, resultUrl: task.result_url });
  await persistArticleIfPossible(
    docClient,
    articleTableName,
    llmResult.text,
    articleAssets,
    meeting,
    speakerMap,
  );
  await markTaskSucceeded(docClient, repoConfig, task);
  console.log("[taskProcessor] single_chunk task done", { taskId: task.pk });
}

export async function handleChunkedTask(args: TaskProcessorArgs): Promise<void> {
  const { task, s3Client, llmClient, docClient, repoConfig, articleTableName, articleAssets, meeting } = args;
  console.log("[taskProcessor] chunked task start", { taskId: task.pk });
  if (!task.chunks || task.chunks.length === 0) {
    console.warn("Chunked task missing chunk definitions", { taskId: task.pk });
    await markTaskSucceeded(docClient, repoConfig, task);
    return;
  }

  const nextChunk = task.chunks.find((chunk) => chunk.status !== "ready");
  if (nextChunk) {
    console.log("[taskProcessor] processing chunk", { taskId: task.pk, chunkId: nextChunk.id, status: nextChunk.status });
    const promptText = await readS3Text(s3Client, nextChunk.prompt_url);
    console.log("[taskProcessor] chunk prompt fetched", { taskId: task.pk, chunkId: nextChunk.id, promptUrl: nextChunk.prompt_url });
    const llmResult = await llmClient.generate({
      messages: [{ role: "user", content: promptText }],
    });

    await writeS3Text(s3Client, nextChunk.result_url, llmResult.text);
    console.log("[taskProcessor] chunk result uploaded", { taskId: task.pk, chunkId: nextChunk.id, resultUrl: nextChunk.result_url });
    await markChunkReady(docClient, repoConfig, task, nextChunk.id);
    return;
  }

  console.log("[taskProcessor] all chunks ready, running reduce", { taskId: task.pk });
  const reducePrompt = await readS3Text(s3Client, task.prompt_url);
  console.log("[taskProcessor] reduce prompt fetched", { taskId: task.pk, promptUrl: task.prompt_url });
  const reduceResult = await llmClient.generate({
    messages: [{ role: "user", content: reducePrompt }],
  });

  await writeS3Text(s3Client, task.result_url, reduceResult.text);
  console.log("[taskProcessor] reduce result uploaded", { taskId: task.pk, resultUrl: task.result_url });
  const speakerMap = await loadSpeakerMapFromChunks(s3Client, task.chunks);
  await persistArticleIfPossible(
    docClient,
    articleTableName,
    reduceResult.text,
    articleAssets,
    meeting,
    speakerMap,
  );
  await markTaskSucceeded(docClient, repoConfig, task);
  console.log("[taskProcessor] chunked task done", { taskId: task.pk });
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

async function persistArticleIfPossible(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  payloadText: string,
  assets: ArticleAssetStorage,
  meeting: TaskItem["meeting"],
  speakerMap: SpeakerMap,
): Promise<void> {
  try {
    const jsonText = sanitizeJsonPayload(payloadText);
    const rawArticle = JSON.parse(jsonText) as Article;
    if (typeof rawArticle !== "object" || rawArticle === null) {
      throw new Error("Reduced payload is not an object");
    }
    if (!rawArticle.summary) {
      throw new Error("Reduced payload is missing summary");
    }
    if (!rawArticle.soft_language_summary) {
      throw new Error("Reduced payload is missing soft_language_summary");
    }
    const withFallbacks: Article = {
      ...rawArticle,
      dialogs: attachSpeakerMetadata(rawArticle.dialogs ?? [], speakerMap),
      date: rawArticle.date ?? meeting?.date,
      month: rawArticle.month ?? (meeting?.date ? meeting.date.slice(0, 7) : rawArticle.month),
      nameOfMeeting: rawArticle.nameOfMeeting ?? meeting?.nameOfMeeting ?? "",
      nameOfHouse: rawArticle.nameOfHouse ?? meeting?.nameOfHouse ?? "",
      session: rawArticle.session ?? meeting?.session ?? rawArticle.session,
    };
    await storeData({ doc: docClient, table_name: tableName, assets }, withFallbacks);
    console.log("[taskProcessor] article persisted", { tableName, meetingDate: withFallbacks.date });
  } catch (error) {
    console.warn("[handler] Skipping article persistence", { error });
  }
}

function sanitizeJsonPayload(payloadText: string): string {
  const trimmed = payloadText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

type SpeakerMeta = {
  speaker?: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  originalText?: string;
};

type SpeakerMap = Map<number, SpeakerMeta>;

type PromptSpeech = {
  speechOrder?: number;
  speaker?: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  speech?: string;
};

type PromptPayload = {
  speeches?: PromptSpeech[];
};

function extractSpeakerMapFromPrompt(promptText: string): SpeakerMap {
  const map: SpeakerMap = new Map();
  let payload: PromptPayload | null = null;
  try {
    payload = JSON.parse(promptText) as PromptPayload;
  } catch (error) {
    console.warn("[taskProcessor] Failed to parse prompt JSON for speakers", { error });
    return map;
  }

  if (!payload?.speeches || !Array.isArray(payload.speeches)) {
    return map;
  }

  for (const speech of payload.speeches) {
    if (!speech || typeof speech !== "object") continue;
    const order = typeof speech.speechOrder === "number" ? speech.speechOrder : Number(speech.speechOrder);
    if (!Number.isFinite(order)) continue;
    const speaker = typeof speech.speaker === "string" ? speech.speaker.trim() : "";
    const hasSpeechText = "speech" in speech;
    const rawSpeechText = hasSpeechText && typeof speech.speech === "string" ? speech.speech.trim() : "";
    const meta: SpeakerMeta = {
      speaker: speaker,
      speakerYomi: "speakerYomi" in speech ? (speech.speakerYomi ?? null) : undefined,
      speakerGroup: "speakerGroup" in speech ? (speech.speakerGroup ?? null) : undefined,
      speakerPosition: "speakerPosition" in speech ? (speech.speakerPosition ?? null) : undefined,
      originalText: hasSpeechText && rawSpeechText.length > 0 ? rawSpeechText : undefined,
    };
    map.set(order, meta);
  }
  return map;
}

async function loadSpeakerMapFromChunks(s3Client: S3Client, chunks: TaskItem["chunks"]): Promise<SpeakerMap> {
  const merged: SpeakerMap = new Map();
  if (!chunks?.length) return merged;

  for (const chunk of chunks) {
    if (!chunk?.prompt_url) continue;
    const chunkPrompt = await readS3Text(s3Client, chunk.prompt_url);
    const chunkMap = extractSpeakerMapFromPrompt(chunkPrompt);
    for (const [order, meta] of chunkMap.entries()) {
      if (!merged.has(order)) {
        merged.set(order, meta);
      }
    }
  }
  return merged;
}

function attachSpeakerMetadata(dialogs: Article["dialogs"], speakerMap: SpeakerMap): Article["dialogs"] {
  if (!Array.isArray(dialogs) || speakerMap.size === 0) {
    return dialogs ?? [];
  }

  return dialogs.map((dialog) => {
    const order = dialog?.order;
    const meta = typeof order === "number" ? speakerMap.get(order) : undefined;
    if (!meta) return dialog;
    const speaker = dialog.speaker?.trim() || meta.speaker;
    return {
      ...dialog,
      speaker: speaker || dialog.speaker,
      original_text: meta.originalText ?? dialog.original_text ?? dialog.summary,
      speakerYomi: meta.speakerYomi !== undefined ? meta.speakerYomi : dialog.speakerYomi,
      speakerGroup: meta.speakerGroup !== undefined ? meta.speakerGroup : dialog.speakerGroup,
      speakerPosition: meta.speakerPosition !== undefined ? meta.speakerPosition : dialog.speakerPosition,
      position:
        dialog.position ??
        (typeof meta.speakerPosition === "string" ? meta.speakerPosition : dialog.position),
    };
  });
}

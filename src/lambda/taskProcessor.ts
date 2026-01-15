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
    const promptText = await readS3Text(s3Client, task.prompt_url);
    const attachedMap = await loadSpeakerMapFromAttachedAssets(s3Client, task.attachedAssets.speakerMetadataUrl);
    assertNonEmptySpeakerMap(attachedMap, "attached assets");
    
    console.log(`[TaskProcessor] Fetched prompt for ${task.pk} (${promptText.length} chars). Preview: ${promptText.slice(0, 100)}...`);

    const llmResult = await llmClient.generate({
      messages: [{ role: "user", content: promptText }],
    });
    console.log(`[TaskProcessor] LLM response for ${task.pk} (${llmResult.text.length} chars). Preview: ${llmResult.text.slice(0, 100)}...`);

    await writeS3Text(s3Client, task.result_url, llmResult.text);
    console.log(`[TaskProcessor] Uploaded result to ${task.result_url}`);

    const persistResult = await persistArticleIfPossible(
      docClient,
      articleTableName,
      llmResult.text,
      articleAssets,
      meeting,
      attachedMap,
      task,
    );
    if (persistResult.persisted) {
      await notifyArticlePersisted(task, persistResult.article);
      console.log(`[TaskProcessor] Persisted article for ${task.pk}`);
    } else {
      await notifyArticlePersistenceSkipped(task, persistResult.reason, persistResult.payloadDumpUri);
      console.warn(`[TaskProcessor] Skipped article persistence for ${task.pk}: ${persistResult.reason}`);
    }
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

  const nextChunk = task.chunks.find((chunk) => chunk.status !== "ready");
  if (nextChunk) {
    console.log(`[TaskProcessor] Processing chunk ${nextChunk.id} for ${task.pk}`);
    try {
      const promptText = await readS3Text(s3Client, nextChunk.prompt_url);
      console.log(`[TaskProcessor] Fetched chunk prompt (${promptText.length} chars). Preview: ${promptText.slice(0, 100)}...`);
      
      const llmResult = await llmClient.generate({
        messages: [{ role: "user", content: promptText }],
      });
      console.log(`[TaskProcessor] Chunk LLM response (${llmResult.text.length} chars). Preview: ${llmResult.text.slice(0, 100)}...`);

      await writeS3Text(s3Client, nextChunk.result_url, llmResult.text);
      console.log(`[TaskProcessor] Uploaded chunk result to ${nextChunk.result_url}`);
      
      await markChunkReady(docClient, repoConfig, task, nextChunk.id);
      console.log(`[TaskProcessor] Marked chunk ${nextChunk.id} ready`);
    } catch (err) {
      console.error(`[TaskProcessor] Chunk processing failed for ${nextChunk.id}`, err);
      throw err;
    }
    return;
  }

  console.log(`[TaskProcessor] All chunks ready for ${task.pk}. Running REDUCE phase.`);
  try {
    const reducePrompt = await readS3Text(s3Client, task.prompt_url);
    console.log(`[TaskProcessor] Fetched reduce prompt (${reducePrompt.length} chars). Preview: ${reducePrompt.slice(0, 100)}...`);
    
    const attachedMap = await loadSpeakerMapFromAttachedAssets(s3Client, task.attachedAssets.speakerMetadataUrl);
    assertNonEmptySpeakerMap(attachedMap, "attached assets");
    const speakerMap = attachedMap;

    const reduceResult = await llmClient.generate({
      messages: [{ role: "user", content: reducePrompt }],
    });
    console.log(`[TaskProcessor] Reduce LLM response (${reduceResult.text.length} chars). Preview: ${reduceResult.text.slice(0, 100)}...`);

    await writeS3Text(s3Client, task.result_url, reduceResult.text);
    console.log(`[TaskProcessor] Uploaded reduce result to ${task.result_url}`);

    const persistResult = await persistArticleIfPossible(
      docClient,
      articleTableName,
      reduceResult.text,
      articleAssets,
      meeting,
      speakerMap,
      task,
    );
    if (persistResult.persisted) {
      await notifyArticlePersisted(task, persistResult.article);
      console.log(`[TaskProcessor] Persisted final article for ${task.pk}`);
    } else {
      await notifyArticlePersistenceSkipped(task, persistResult.reason, persistResult.payloadDumpUri);
      console.warn(`[TaskProcessor] Skipped final article persistence for ${task.pk}: ${persistResult.reason}`);
    }
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

async function persistArticleIfPossible(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  payloadText: string,
  assets: ArticleAssetStorage,
  meeting: TaskItem["meeting"],
  speakerMap: SpeakerMap,
  task: TaskItem,
): Promise<PersistResult> {
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
      });
    }
    return { persisted: false, reason, payloadDumpUri };
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

async function storeInvalidPayload(
  assets: ArticleAssetStorage,
  taskId: string,
  payloadText: string,
  reason: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `invalid-payloads/${appConfig.environment}/${taskId}/${timestamp}.txt`;
  await uploadObject({
    client: assets.client,
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

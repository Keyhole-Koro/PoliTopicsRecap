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
  console.log("[taskProcessor] direct task start", { taskId: task.pk });
  const promptText = await readS3Text(s3Client, task.prompt_url);
  console.log("[taskProcessor] prompt fetched", { taskId: task.pk, promptUrl: task.prompt_url });
  const llmResult = await llmClient.generate({
    messages: [{ role: "user", content: promptText }],
  });
  console.log("[taskProcessor] llm response received", { taskId: task.pk, llm: task.llm, model: task.llmModel });
  await writeS3Text(s3Client, task.result_url, llmResult.text);
  console.log("[taskProcessor] result uploaded", { taskId: task.pk, resultUrl: task.result_url });
  await persistArticleIfPossible(docClient, articleTableName, llmResult.text, articleAssets, meeting);
  await markTaskSucceeded(docClient, repoConfig, task);
  console.log("[taskProcessor] direct task done", { taskId: task.pk });
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
  await persistArticleIfPossible(docClient, articleTableName, reduceResult.text, articleAssets, meeting);
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
): Promise<void> {
  try {
    const jsonText = sanitizeJsonPayload(payloadText);
    const article = JSON.parse(jsonText) as Article;
    if (typeof article !== "object" || article === null) {
      throw new Error("Reduced payload is not an object");
    }
    const withFallbacks: Article = {
      ...article,
      date: article.date ?? meeting?.date,
      month: article.month ?? (meeting?.date ? meeting.date.slice(0, 7) : article.month),
      nameOfMeeting: article.nameOfMeeting ?? meeting?.nameOfMeeting ?? "",
      nameOfHouse: article.nameOfHouse ?? meeting?.nameOfHouse ?? "",
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

import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { GeminiClient } from "@llm/geminiClient";
import { FakeLlmClient } from "@llm/fakeLlmClient";
import { LlmClient } from "@llm/llmClient";
import {
  bumpRetryAttempts,
  fetchOldestPendingTask,
  markChunkReady,
  markTaskSucceeded,
  type TaskRepositoryConfig,
} from "./tasks/taskRepository";
import type { TaskItem } from "./tasks/types";
import type Article from "./dynamoDB/article";
import storeData from "./dynamoDB/storeData";
import { resolveConfig } from "@utils/config";
import { getS3ClientConfig } from "@utils/aws";
import { createDocumentClient } from "@utils/dynamo";
import { fetchObjectText, parseS3Uri, uploadObject } from "@utils/s3";

export async function handler(): Promise<void> {
  const config = resolveConfig();
  const s3Client = new S3Client(getS3ClientConfig());
  const docClient = createDocumentClient();

  const repoConfig: TaskRepositoryConfig = {
    tableName: config.taskTableName,
    statusIndexName: config.taskStatusIndexName,
  };

  let task: TaskItem | null = null;
  try {
    task = await fetchOldestPendingTask(docClient, repoConfig);
    if (!task) {
      console.log("[handler] No pending tasks to process");
      return;
    }

    const llmClient = createLlmClient(task, config.geminiApiKey);
    if (!llmClient) {
      console.error("Unsupported LLM provider", { taskId: task.pk, llm: task.llm });
      await bumpRetryAttempts(docClient, repoConfig, task);
      return;
    }

    if (task.processingMode === "direct") {
      await handleDirectTask({
        task,
        docClient,
        repoConfig,
        s3Client,
        llmClient,
        articleTableName: config.articleTableName,
      });
      return;
    }

    await handleChunkedTask({
      task,
      docClient,
      repoConfig,
      s3Client,
      llmClient,
      articleTableName: config.articleTableName,
    });
  } catch (error) {
    console.error("[handler] Failed to process task", {
      taskId: task?.pk,
      error,
    });
    if (task) {
      await bumpRetryAttempts(docClient, repoConfig, task);
    }
  }
}

function createLlmClient(task: TaskItem, apiKey: string): LlmClient | null {
  if (task.llm === "gemini") {
    return new GeminiClient({ apiKey, model: task.llmModel });
  }
  if (task.llm === "fake") {
    return new FakeLlmClient({ mode: "echo" });
  }
  return null;
}

type TaskArgs = {
  task: TaskItem;
  docClient: DynamoDBDocumentClient;
  repoConfig: TaskRepositoryConfig;
  s3Client: S3Client;
  llmClient: LlmClient;
  articleTableName: string;
};

async function handleDirectTask(args: TaskArgs): Promise<void> {
  const { task, s3Client, llmClient, docClient, repoConfig, articleTableName } = args;
  const promptText = await readS3Text(s3Client, task.prompt_url);
  const llmResult = await llmClient.generate({
    messages: [{ role: "user", content: promptText }],
  });
  await writeS3Text(s3Client, task.result_url, llmResult.text);
  await persistArticleIfPossible(docClient, articleTableName, llmResult.text);
  await markTaskSucceeded(docClient, repoConfig, task);
}

async function handleChunkedTask(args: TaskArgs): Promise<void> {
  const { task, s3Client, llmClient, docClient, repoConfig, articleTableName } = args;
  if (!task.chunks || task.chunks.length === 0) {
    console.warn("Chunked task missing chunk definitions", { taskId: task.pk });
    await markTaskSucceeded(docClient, repoConfig, task);
    return;
  }

  const nextChunk = task.chunks.find((chunk) => chunk.status !== "ready");
  if (nextChunk) {
    const promptText = await readS3Text(s3Client, nextChunk.prompt_url);
    const llmResult = await llmClient.generate({
      messages: [{ role: "user", content: promptText }],
    });

    await writeS3Text(s3Client, nextChunk.result_url, llmResult.text);
    await markChunkReady(docClient, repoConfig, task, nextChunk.id);
    return;
  }

  const reducePrompt = await readS3Text(s3Client, task.prompt_url);
  const reduceResult = await llmClient.generate({
    messages: [{ role: "user", content: reducePrompt }],
  });

  await writeS3Text(s3Client, task.result_url, reduceResult.text);
  await persistArticleIfPossible(docClient, articleTableName, reduceResult.text);
  await markTaskSucceeded(docClient, repoConfig, task);
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
): Promise<void> {
  try {
    const article = JSON.parse(payloadText) as Article;
    if (typeof article !== "object" || article === null) {
      throw new Error("Reduced payload is not an object");
    }
    await storeData({ doc: docClient, table_name: tableName }, article);
  } catch (error) {
    console.warn("[handler] Skipping article persistence", { error });
  }
}

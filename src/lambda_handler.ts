import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { LlmClient } from "@llm/llmClient";
import {
  bumpRetryAttempts,
  fetchOldestPendingTask,
  type TaskRepositoryConfig,
} from "./tasks/taskRepository";
import type { TaskItem } from "./tasks/types";
import { assertTaskReadyForProcessing } from "./tasks/taskValidator";
import { resolveConfig } from "@utils/config";
import { getS3ClientConfig } from "@utils/aws";
import { createDocumentClient } from "@utils/dynamo";
import { createLlmClient } from "./lambda/llmFactory";
import { notifyTaskError, notifyTaskWarning } from "./lambda/notifications";
import {
  handleDirectTask,
  handleChunkedTask,
  type TaskProcessorArgs,
} from "./lambda/taskProcessor";

export async function handler(): Promise<void> {
  console.log("[handler] start");
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
    console.log(`[Recap] Fetched task ${task.pk} (mode: ${task.processingMode}, llm: ${task.llm})`);
    if (task.retryAttempts >= 3) {
      console.log(`[Recap] Skipping task ${task.pk} - max retries reached (${task.retryAttempts})`);
      return;
    }
    assertTaskReadyForProcessing(task);

    const llmClient = createLlmClient(task, config.geminiApiKey);
    if (!llmClient) {
      console.error(`[Recap] Unsupported LLM provider for task ${task.pk}: ${task.llm}`);
      await bumpRetryAttempts(docClient, repoConfig, task);
      await notifyTaskWarning(task, "Unsupported LLM provider");
      return;
    }
    console.log(`[Recap] Initialized LLM client for ${task.pk} using model ${task.llmModel}`);

    if (task.processingMode === "single_chunk") {
      console.log(`[Recap] Starting DIRECT (single_chunk) processing for ${task.pk}`);
      await handleDirectTask(buildTaskArgs({
        task,
        docClient,
        repoConfig,
        s3Client,
        llmClient,
        articleTableName: config.articleTableName,
        articleAssetBucketName: config.articleAssetBucketName,
        meeting: task.meeting,
      }));
      console.log(`[Recap] Completed DIRECT processing for ${task.pk}`);
      return;
    }

    console.log(`[Recap] Starting CHUNKED processing for ${task.pk}`);
    await handleChunkedTask(buildTaskArgs({
      task,
      docClient,
      repoConfig,
      s3Client,
      llmClient,
      articleTableName: config.articleTableName,
      articleAssetBucketName: config.articleAssetBucketName,
      meeting: task.meeting,
    }));
    console.log(`[Recap] Completed CHUNKED processing step for ${task.pk}`);
  } catch (error) {
    console.error("[handler] Failed to process task", {
      taskId: task?.pk,
      error,
    });
    if (task) {
      const [notifyResult, retryResult] = await Promise.allSettled([
        notifyTaskError(task, error),
        bumpRetryAttempts(docClient, repoConfig, task),
      ]);
      if (notifyResult.status === "rejected") {
        console.error("[handler] Failed to notify task error", {
          taskId: task.pk,
          error: notifyResult.reason,
        });
      }
      if (retryResult.status === "rejected") {
        console.error("[handler] Failed to bump retry attempts", {
          taskId: task.pk,
          error: retryResult.reason,
        });
      }
    }
  }
}

type BuildArgsInput = {
  task: TaskItem;
  docClient: DynamoDBDocumentClient;
  repoConfig: TaskRepositoryConfig;
  s3Client: S3Client;
  llmClient: LlmClient;
  articleTableName: string;
  articleAssetBucketName: string;
  meeting?: TaskItem["meeting"];
};

function buildTaskArgs(input: BuildArgsInput): TaskProcessorArgs {
  const { task, docClient, repoConfig, s3Client, llmClient, articleTableName, articleAssetBucketName, meeting } = input;
  return {
    task,
    docClient,
    repoConfig,
    s3Client,
    llmClient,
    articleTableName,
    articleAssets: {
      client: s3Client,
      bucket: articleAssetBucketName,
    },
    meeting: meeting ?? task.meeting,
  };
}

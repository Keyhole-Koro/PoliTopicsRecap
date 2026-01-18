import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AppConfig } from "../config";
import { buildAssetUrl } from "@utils/aws";
import { createLlmClient } from "./llmFactory";
import { notifyTaskError, notifyTaskWarning } from "./notifications";
import {
  handleDirectTask,
  handleChunkedTask,
  type TaskProcessorArgs,
} from "./taskProcessor";
import {
  bumpRetryAttempts,
  fetchOldestPendingTask,
  type TaskRepositoryConfig,
} from "../tasks/taskRepository";
import type { TaskItem } from "../tasks/types";
import { assertTaskReadyForProcessing } from "../tasks/taskValidator";

export type TaskRunnerContext = {
  config: AppConfig;
  docClient: DynamoDBDocumentClient;
  s3Client: S3Client;
  articleAssetClient: S3Client;
  articleAssetBucket: string;
  repoConfig: TaskRepositoryConfig;
};

export type TaskRunnerResultStatus = "succeeded" | "skipped" | "failed";

export type TaskRunnerResult = {
  task: TaskItem;
  status: TaskRunnerResultStatus;
};

export async function processNextPendingTask(
  ctx: TaskRunnerContext,
): Promise<TaskRunnerResult | null> {
  const task = await fetchOldestPendingTask(ctx.docClient, ctx.repoConfig);
  if (!task) {
    console.log("[TaskRunner] No pending tasks to process");
    return null;
  }
  return processTask(ctx, task);
}

export async function processTask(
  ctx: TaskRunnerContext,
  task: TaskItem,
): Promise<TaskRunnerResult> {
  if (task.retryAttempts >= 3) {
    console.log(`[TaskRunner] Skipping task ${task.pk} - max retries reached`);
    return { task, status: "skipped" };
  }

  try {
    assertTaskReadyForProcessing(task);
  } catch (error) {
    console.log(`[TaskRunner] Skipping task ${task.pk} - not ready:`, error);
    return { task, status: "skipped" };
  }

  const llmClient = createLlmClient(task, ctx.config.geminiApiKey);
  if (!llmClient) {
    console.error(`[TaskRunner] Unsupported LLM provider for task ${task.pk}: ${task.llm}`);
    await bumpRetryAttempts(ctx.docClient, ctx.repoConfig, task);
    await notifyTaskWarning(task, "Unsupported LLM provider");
    return { task, status: "skipped" };
  }

  const args = buildTaskArgs({
    task,
    docClient: ctx.docClient,
    repoConfig: ctx.repoConfig,
    s3Client: ctx.s3Client,
    articleAssetClient: ctx.articleAssetClient,
    articleAssetBucket: ctx.articleAssetBucket,
    llmClient,
    articleTableName: ctx.config.articleTableName,
    meeting: task.meeting,
  });

  try {
    if (task.processingMode === "single_chunk") {
      await handleDirectTask(args);
    } else {
      await handleChunkedTask(args);
    }
    return { task, status: "succeeded" };
  } catch (error) {
    console.error("[TaskRunner] Failed to process task", {
      taskId: task.pk,
      error,
    });
    await handleTaskFailure(ctx, task, error);
    return { task, status: "failed" };
  }
}

type BuildArgsInput = {
  task: TaskItem;
  docClient: DynamoDBDocumentClient;
  repoConfig: TaskRepositoryConfig;
  s3Client: S3Client;
  articleAssetClient: S3Client;
  articleAssetBucket: string;
  llmClient: TaskProcessorArgs["llmClient"];
  articleTableName: string;
  meeting?: TaskItem["meeting"];
};

function buildTaskArgs(input: BuildArgsInput): TaskProcessorArgs {
  const {
    task,
    docClient,
    repoConfig,
    s3Client,
    articleAssetClient,
    articleAssetBucket,
    llmClient,
    articleTableName,
    meeting,
  } = input;
  return {
    task,
    docClient,
    repoConfig,
    s3Client,
    llmClient,
    articleTableName,
    articleAssets: {
      client: articleAssetClient,
      bucket: articleAssetBucket,
      makeUrl: buildAssetUrl,
    },
    meeting: meeting ?? task.meeting,
  };
}

async function handleTaskFailure(
  ctx: TaskRunnerContext,
  task: TaskItem,
  error: unknown,
): Promise<void> {
  const [notifyResult, retryResult] = await Promise.allSettled([
    notifyTaskError(task, error),
    bumpRetryAttempts(ctx.docClient, ctx.repoConfig, task),
  ]);
  if (notifyResult.status === "rejected") {
    console.error("[TaskRunner] Failed to notify task error", {
      taskId: task.pk,
      error: notifyResult.reason,
    });
  }
  if (retryResult.status === "rejected") {
    console.error("[TaskRunner] Failed to bump retry attempts", {
      taskId: task.pk,
      error: retryResult.reason,
    });
  }
}

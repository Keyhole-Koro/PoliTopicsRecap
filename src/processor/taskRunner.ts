import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { type AppConfig } from "../config";
import { createLlmClient } from "./llmFactory";
import { notifyTaskError, notifyTaskWarning } from "./notifications";
import {
  handleDirectTask,
  handleChunkedTask,
  type TaskProcessorArgs,
} from "./taskProcessor";
import {
  bumpRetryAttempts,
  fetchOldestReadyTask,
  fetchTasksByStatusPage,
  type TaskRepositoryConfig,
} from "../tasks/taskRepository";
import type { TaskItem } from "../tasks/types";
import { assertTaskReadyForProcessing } from "../tasks/taskValidator";
import { prepareTaskFromRaw } from "./taskPreparation";
import { PROMPT_VERSION } from "../prompts/prompts";
import { isMajorMismatch } from "../prompts/versioning";

const TOKEN_REDUCTION_RATIO = 0.7;
const MIN_INPUT_TOKENS = 1024;

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
  const task = await fetchOldestReadyTask(ctx.docClient, ctx.repoConfig);
  if (!task) {
    console.log("[TaskRunner] No ready tasks to process");
    return null;
  }
  return processTask(ctx, task);
}

export async function requeueCompletedTasksWithMajorMismatch(
  ctx: TaskRunnerContext,
  limit: number,
): Promise<number> {
  if (limit <= 0) return 0;

  let requeued = 0;
  let startKey: Record<string, any> | undefined = undefined;

  while (requeued < limit) {
    const pageLimit = Math.min(25, limit - requeued);
    const { tasks, lastKey } = await fetchTasksByStatusPage(
      ctx.docClient,
      ctx.repoConfig,
      "completed",
      {
        startKey,
        limit: pageLimit,
      },
    );

    if (tasks.length === 0) break;

    for (const task of tasks) {
      if (requeued >= limit) break;
      if (!isMajorMismatch(PROMPT_VERSION, task.prompt_version)) {
        continue;
      }
      if (!task.raw_url) {
        console.warn(
          `[TaskRunner] Completed task ${task.pk} has major prompt mismatch but no raw_url; skipping requeue`,
        );
        continue;
      }
      try {
        const maxInputToken = computeMaxInputTokenForTask(task, ctx.config.geminiMaxInputToken);
        await prepareTaskFromRaw({
          task,
          s3Client: ctx.s3Client,
          docClient: ctx.docClient,
          repoConfig: ctx.repoConfig,
          status: "remake",
          maxInputToken,
        });
        requeued += 1;
      } catch (error) {
        console.error("[TaskRunner] Failed to remake completed task", {
          taskId: task.pk,
          error: serializeError(error),
        });
      }
    }

    if (!lastKey) break;
    startKey = lastKey;
  }

  return requeued;
}

export async function processTask(
  ctx: TaskRunnerContext,
  task: TaskItem,
): Promise<TaskRunnerResult> {
  let workingTask = task;
  if ((task.retryAttempts ?? 0) >= 3) {
    console.log(`[TaskRunner] Skipping task ${task.pk} - max retries reached`);
    return { task, status: "skipped" };
  }

  if (workingTask.status === "ingested") {
    try {
      const maxInputToken = computeMaxInputTokenForTask(workingTask, ctx.config.geminiMaxInputToken);
      workingTask = await prepareTaskFromRaw({
        task: workingTask,
        s3Client: ctx.s3Client,
        docClient: ctx.docClient,
        repoConfig: ctx.repoConfig,
        status: "pending",
        maxInputToken,
      });
    } catch (error) {
      console.error(`[TaskRunner] Failed to prepare ingested task ${workingTask.pk}`, {
        taskId: workingTask.pk,
        error: serializeError(error),
      });
      await handleTaskFailure(ctx, workingTask, error);
      return { task: workingTask, status: "failed" };
    }
  } else if (isMajorMismatch(PROMPT_VERSION, workingTask.prompt_version)) {
    if (workingTask.raw_url) {
      try {
        const maxInputToken = computeMaxInputTokenForTask(workingTask, ctx.config.geminiMaxInputToken);
        workingTask = await prepareTaskFromRaw({
          task: workingTask,
          s3Client: ctx.s3Client,
          docClient: ctx.docClient,
          repoConfig: ctx.repoConfig,
          status: "remake",
          maxInputToken,
        });
      } catch (error) {
        console.error(`[TaskRunner] Failed to remake task ${workingTask.pk}`, {
          taskId: workingTask.pk,
          error: serializeError(error),
        });
        await handleTaskFailure(ctx, workingTask, error);
        return { task: workingTask, status: "failed" };
      }
    } else {
      console.warn(
        `[TaskRunner] Prompt version mismatch for ${workingTask.pk} but raw_url missing; proceeding with existing prompt`,
      );
    }
  }

  try {
    assertTaskReadyForProcessing(workingTask);
  } catch (error) {
    console.log(`[TaskRunner] Skipping task ${workingTask.pk} - not ready:`, error);
    return { task: workingTask, status: "skipped" };
  }

  const llmClient = createLlmClient(workingTask, ctx.config.geminiApiKey);
  if (!llmClient) {
    console.error(
      `[TaskRunner] Unsupported LLM provider for task ${workingTask.pk}: ${workingTask.llm}`,
    );
    await bumpRetryAttempts(ctx.docClient, ctx.repoConfig, workingTask);
    await notifyTaskWarning(workingTask, "Unsupported LLM provider");
    return { task: workingTask, status: "skipped" };
  }

  const args = buildTaskArgs({
    task: workingTask,
    docClient: ctx.docClient,
    repoConfig: ctx.repoConfig,
    s3Client: ctx.s3Client,
    articleAssetClient: ctx.articleAssetClient,
    articleAssetBucket: ctx.articleAssetBucket,
    llmClient,
    articleTableName: ctx.config.articleTableName,
    meeting: workingTask.meeting,
  });

  try {
    if (workingTask.processingMode === "single_chunk") {
      await handleDirectTask(args);
    } else {
      await handleChunkedTask(args);
    }
    return { task: workingTask, status: "succeeded" };
  } catch (error) {
    const errorInfo = serializeError(error);
    const taskContext = buildTaskLogContext(workingTask);
    console.error("[TaskRunner] Failed to process task", {
      ...taskContext,
      error: errorInfo,
    });

    const remadeTask = await tryRemakeWithSmallerChunks(ctx, workingTask, error);
    if (remadeTask) {
      return { task: remadeTask, status: "skipped" };
    }
    await handleTaskFailure(ctx, workingTask, error);
    return { task: workingTask, status: "failed" };
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
    },
    meeting: meeting ?? task.meeting,
  };
}

async function tryRemakeWithSmallerChunks(
  ctx: TaskRunnerContext,
  task: TaskItem,
  error: unknown,
): Promise<TaskItem | null> {
  if (!task.raw_url) return null;
  if (!isTokenLimitError(error)) return null;

  const currentMax = resolveBaseMaxInputToken(task, ctx.config.geminiMaxInputToken);
  const reductionAttempts = (task.retryAttempts ?? 0) + 1;
  const nextMax = applyRetryReduction(currentMax, reductionAttempts);
  if (!nextMax) {
    console.warn("[TaskRunner] Token limit error but cannot reduce maxInputToken further", {
      taskId: task.pk,
      currentMaxInputToken: currentMax,
      minInputToken: MIN_INPUT_TOKENS,
    });
    return null;
  }

  console.warn("[TaskRunner] Token limit detected. Remaking task with smaller chunks", {
    taskId: task.pk,
    currentMaxInputToken: currentMax,
    nextMaxInputToken: nextMax,
    reductionAttempts,
  });

  try {
    const remadeTask = await prepareTaskFromRaw({
      task,
      s3Client: ctx.s3Client,
      docClient: ctx.docClient,
      repoConfig: ctx.repoConfig,
      status: "remake",
      maxInputToken: nextMax,
    });
    return remadeTask;
  } catch (prepError) {
    console.error("[TaskRunner] Failed to remake task after token limit error", {
      taskId: task.pk,
      error: serializeError(prepError),
    });
    return null;
  }
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
      error: serializeError(notifyResult.reason),
    });
  }
  if (retryResult.status === "rejected") {
    console.error("[TaskRunner] Failed to bump retry attempts", {
      taskId: task.pk,
      error: serializeError(retryResult.reason),
    });
  }
}

function buildTaskLogContext(task: TaskItem): Record<string, unknown> {
  const chunks = task.chunks ?? [];
  const readyCount = chunks.filter((chunk) => chunk.status === "completed").length;
  const nextChunk = chunks.find((chunk) => chunk.status !== "completed");

  return {
    taskId: task.pk,
    status: task.status,
    processingMode: task.processingMode,
    promptVersion: task.prompt_version,
    llm: task.llm,
    llmModel: task.llmModel,
    maxInputToken: task.maxInputToken,
    retryAttempts: task.retryAttempts ?? 0,
    promptUrl: task.prompt_url,
    resultUrl: task.result_url,
    rawUrl: task.raw_url,
    rawHash: task.raw_hash,
    attachedAssets: task.attachedAssets,
    meeting: task.meeting
      ? {
          issueID: task.meeting.issueID,
          date: task.meeting.date,
          nameOfMeeting: task.meeting.nameOfMeeting,
          nameOfHouse: task.meeting.nameOfHouse,
          session: task.meeting.session,
        }
      : undefined,
    chunkSummary: task.processingMode === "chunked"
      ? {
          total: chunks.length,
          ready: readyCount,
          nextChunkId: nextChunk?.id,
        }
      : undefined,
  };
}

function resolveBaseMaxInputToken(task: TaskItem, fallback: number): number {
  if (typeof task.maxInputToken === "number" && Number.isFinite(task.maxInputToken)) {
    return task.maxInputToken;
  }
  return fallback;
}

function applyRetryReduction(base: number, attempts: number): number | null {
  if (!Number.isFinite(base) || base <= MIN_INPUT_TOKENS) return null;
  if (!attempts || attempts <= 0) return base;
  const reduced = Math.floor(base * Math.pow(TOKEN_REDUCTION_RATIO, attempts));
  const next = Math.max(MIN_INPUT_TOKENS, reduced);
  if (next >= base) return null;
  return next;
}

function computeMaxInputTokenForTask(task: TaskItem, fallback: number): number {
  const base = resolveBaseMaxInputToken(task, fallback);
  const attempts = task.retryAttempts ?? 0;
  const reduced = applyRetryReduction(base, attempts);
  return reduced ?? base;
}

function isTokenLimitError(error: unknown): boolean {
  const text = extractErrorText(error).toLowerCase();
  if (!text) return false;
  if (/(rate limit|quota|too many requests|429)/i.test(text)) return false;
  if (/(maxoutputtokens|output tokens|response too large)/i.test(text)) return false;
  if (/(token|context length|context|input length|prompt)/i.test(text) &&
      /(limit|maximum|exceed|too large|too long|length)/i.test(text)) {
    return true;
  }
  if (/(request too large|payload too large|entity too large)/i.test(text)) return true;

  const status = extractErrorStatus(error);
  if (status === 413) return true;
  return false;
}

function extractErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const parts = [error.name, error.message];
    const anyErr = error as unknown as Record<string, unknown>;
    if (anyErr.status) parts.push(String(anyErr.status));
    if (anyErr.statusText) parts.push(String(anyErr.statusText));
    if (anyErr.errorDetails) {
      try {
        parts.push(JSON.stringify(anyErr.errorDetails));
      } catch {
        parts.push(String(anyErr.errorDetails));
      }
    }
    return parts.filter(Boolean).join(" ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function extractErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const maybeStatus = (error as Record<string, unknown>).status;
  return typeof maybeStatus === "number" ? maybeStatus : null;
}

function serializeError(error: unknown): Record<string, unknown> | string {
  if (error instanceof Error) {
    const anyErr = error as unknown as Record<string, unknown>;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      status: anyErr.status,
      statusText: anyErr.statusText,
      errorDetails: anyErr.errorDetails,
      cause: anyErr.cause,
    };
  }
  if (typeof error === "string") return error;
  try {
    return JSON.parse(JSON.stringify(error));
  } catch {
    return String(error);
  }
}

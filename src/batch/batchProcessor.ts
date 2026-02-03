import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AppConfig } from "../config";
import { RateLimiter } from "@utils/rateLimiter";
import {
  fetchOldestReadyTask,
  fetchOldestIngestedTask,
  countReadyTasks,
  getTaskById,
  type TaskRepositoryConfig,
} from "../tasks/taskRepository";
import { notifyBatchComplete } from "../processor/notifications";
import { processTask, requeueCompletedTasksWithMajorMismatch, type TaskRunnerResult } from "../processor/taskRunner";
import type { TaskItem } from "../tasks/types";

export interface BatchStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startTime: number;
}

export interface BatchContext {
  config: AppConfig;
  docClient: DynamoDBDocumentClient;
  s3Client: S3Client;
  articleAssetClient: S3Client;
  articleAssetBucket: string;
  repoConfig: TaskRepositoryConfig;
  rateLimiter: RateLimiter;
  stats: BatchStats;
}

const MAX_REQUEUE_COMPLETED = 50;

export class BatchProcessor {
  constructor(private ctx: BatchContext) {}

  async run(): Promise<void> {
    const { config, docClient, repoConfig, stats } = this.ctx;

    // Calculate max tasks to process
    let readyCount = await countReadyTasks(docClient, repoConfig);
    const maxTasks = this.calculateMaxTasks(config, readyCount);
    const requeueTarget = Math.max(0, maxTasks - readyCount);
    const requeueLimit = Math.min(requeueTarget, MAX_REQUEUE_COMPLETED);
    if (requeueLimit > 0) {
      if (requeueTarget > MAX_REQUEUE_COMPLETED) {
        console.log(
          `[BatchProcessor] Requeue target capped at ${MAX_REQUEUE_COMPLETED} (requested ${requeueTarget})`,
        );
      }
      const requeued = await requeueCompletedTasksWithMajorMismatch(this.ctx, requeueLimit);
      if (requeued > 0) {
        readyCount = await countReadyTasks(docClient, repoConfig);
        console.log(`[BatchProcessor] Requeued ${requeued} completed tasks (major prompt mismatch)`);
      }
    }
    console.log(`[BatchProcessor] Found ${readyCount} ready tasks, will process up to ${maxTasks}`);

    let consecutiveErrors = 0;

    while (stats.processed < maxTasks) {
      // Fetch next ready task (pending/remake) first
      const task =
        (await fetchOldestReadyTask(docClient, repoConfig)) ??
        (await fetchOldestIngestedTask(docClient, repoConfig));
      if (!task) {
        console.log("[BatchProcessor] No more tasks");
        break;
      }

      console.log(`[BatchProcessor] Processing task ${task.pk} (${stats.processed + 1}/${maxTasks})`);
      const loopResult = await this.processTaskWithChunkLoop(task);
      if (loopResult.processed) {
        if (loopResult.result.status === "succeeded") {
          stats.succeeded++;
          consecutiveErrors = 0;
        } else if (loopResult.result.status === "failed") {
          stats.failed++;
          consecutiveErrors++;

          if (consecutiveErrors >= config.rateLimit.maxConsecutiveErrors) {
            console.error(
              `[BatchProcessor] Max consecutive errors (${config.rateLimit.maxConsecutiveErrors}) reached, exiting`
            );
            await notifyBatchComplete(stats, "error");
            throw new Error("Max consecutive errors reached");
          }

          // Cooldown before next attempt
          await this.sleep(config.rateLimit.cooldownOnErrorMs);
        } else {
          stats.skipped++;
        }

        stats.processed++;
      }

      if (loopResult.stopBatch) {
        console.log("[BatchProcessor] Daily rate limit reached, stopping");
        break;
      }
    }

    // Batch complete
    this.logSummary(stats, config.environment);
    
    await notifyBatchComplete(stats, "success");
  }

  private calculateMaxTasks(config: AppConfig, readyCount: number): number {
    const { batch, rateLimit } = config;
    if (batch.maxTasksPerRun === "auto") {
      return Math.max(rateLimit.requestsPerDay, readyCount);
    }
    return batch.maxTasksPerRun;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async processTaskWithChunkLoop(
    task: TaskItem,
  ): Promise<{ result: TaskRunnerResult; stopBatch: boolean; processed: boolean }> {
    let currentTask = task;
    let lastResult: TaskRunnerResult = { task: currentTask, status: "skipped" };
    let processed = false;
    let maxPasses = this.computeChunkPassLimit(currentTask);
    let pass = 0;

    while (pass < maxPasses) {
      if (this.ctx.rateLimiter.isDayLimitReached()) {
        return { result: lastResult, stopBatch: true, processed };
      }

      const waitTime = await this.ctx.rateLimiter.waitIfNeeded();
      if (waitTime > 0) {
        console.log(`[BatchProcessor] Rate limited, waited ${waitTime}ms`);
      }

      lastResult = await processTask(this.ctx, currentTask);
      processed = true;

      if (lastResult.status !== "succeeded") {
        return { result: lastResult, stopBatch: false, processed };
      }

      const updatedTask = await getTaskById(
        this.ctx.docClient,
        this.ctx.repoConfig,
        currentTask.pk,
      );
      if (!updatedTask) {
        return { result: lastResult, stopBatch: false, processed };
      }

      currentTask = updatedTask;
      maxPasses = Math.max(maxPasses, this.computeChunkPassLimit(currentTask));

      if (currentTask.status === "completed") {
        return { result: lastResult, stopBatch: false, processed };
      }

      if (currentTask.processingMode !== "chunked") {
        return { result: lastResult, stopBatch: false, processed };
      }

      pass++;
    }

    console.warn(
      `[BatchProcessor] Chunk loop exceeded limit for ${task.pk} (passes=${pass}, max=${maxPasses})`,
    );
    if (lastResult.status === "succeeded") {
      lastResult = { ...lastResult, status: "skipped" };
    }
    return { result: lastResult, stopBatch: false, processed };
  }

  private computeChunkPassLimit(task: TaskItem): number {
    const chunkCount = Array.isArray(task.chunks) ? task.chunks.length : 0;
    return Math.max(1, chunkCount + 2);
  }

  private logSummary(stats: BatchStats, environment: string): void {
    const duration = Date.now() - stats.startTime;
    console.log("\n============================================");
    console.log("          Batch Execution Summary           ");
    console.log("============================================");
    console.log(`Environment: ${environment}`);
    console.log(`Duration   : ${duration}ms`);
    console.log("--------------------------------------------");
    console.log(`Processed  : ${stats.processed}`);
    console.log(`Succeeded  : ${stats.succeeded}`);
    console.log(`Failed     : ${stats.failed}`);
    console.log(`Skipped    : ${stats.skipped}`);
    console.log("============================================\n");
  }
}

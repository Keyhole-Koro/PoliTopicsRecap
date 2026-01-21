import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AppConfig } from "../config";
import { RateLimiter } from "@utils/rateLimiter";
import {
  fetchOldestPendingTask,
  countPendingTasks,
  type TaskRepositoryConfig,
} from "../tasks/taskRepository";
import { notifyBatchComplete } from "../processor/notifications";
import { processTask } from "../processor/taskRunner";

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

export class BatchProcessor {
  constructor(private ctx: BatchContext) {}

  async run(): Promise<void> {
    const { config, docClient, repoConfig, rateLimiter, stats } = this.ctx;

    // Calculate max tasks to process
    const pendingCount = await countPendingTasks(docClient, repoConfig);
    const maxTasks = this.calculateMaxTasks(config, pendingCount);
    console.log(`[BatchProcessor] Found ${pendingCount} pending tasks, will process up to ${maxTasks}`);

    let consecutiveErrors = 0;

    while (stats.processed < maxTasks) {
      // Check day limit
      if (rateLimiter.isDayLimitReached()) {
        console.log("[BatchProcessor] Daily rate limit reached, stopping");
        break;
      }

      // Wait for rate limit
      const waitTime = await rateLimiter.waitIfNeeded();
      if (waitTime > 0) {
        console.log(`[BatchProcessor] Rate limited, waited ${waitTime}ms`);
      }

      // Fetch next task
      const task = await fetchOldestPendingTask(docClient, repoConfig);
      if (!task) {
        console.log("[BatchProcessor] No more pending tasks");
        break;
      }

      console.log(`[BatchProcessor] Processing task ${task.pk} (${stats.processed + 1}/${maxTasks})`);

      const result = await processTask(this.ctx, task);
      if (result.status === "succeeded") {
        stats.succeeded++;
        consecutiveErrors = 0;
      } else if (result.status === "failed") {
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

    // Batch complete
    this.logSummary(stats, config.environment);
    
    await notifyBatchComplete(stats, "success");
  }

  private calculateMaxTasks(config: AppConfig, pendingCount: number): number {
    const { batch, rateLimit } = config;
    if (batch.maxTasksPerRun === "auto") {
      return Math.max(rateLimit.requestsPerDay, pendingCount);
    }
    return batch.maxTasksPerRun;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

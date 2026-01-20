/**
 * Container entry point for Fargate batch processing.
 * Processes pending tasks with rate limiting and exits when complete.
 */

import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { appConfig, type AppConfig } from "./config";
import { createDocumentClient } from "@utils/dynamo";
import { getS3ClientConfig, getR2ClientConfig, getR2Bucket } from "@utils/aws";
import { RateLimiter } from "@utils/rateLimiter";
import {
  fetchOldestPendingTask,
  countPendingTasks,
  type TaskRepositoryConfig,
} from "./tasks/taskRepository";
import { notifyBatchComplete } from "./processor/notifications";
import { processTask } from "./processor/taskRunner";

interface BatchStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startTime: number;
}

interface BatchContext {
  config: AppConfig;
  docClient: DynamoDBDocumentClient;
  s3Client: S3Client;
  articleAssetClient: S3Client;
  articleAssetBucket: string;
  repoConfig: TaskRepositoryConfig;
  rateLimiter: RateLimiter;
  stats: BatchStats;
}

async function main(): Promise<void> {
  const config = appConfig;
  console.log(`[BatchProcessor] Starting in ${config.environment} environment`);

  const docClient = createDocumentClient();
  const s3Client = new S3Client(getS3ClientConfig());
  
  // Use R2 for article assets if configured, otherwise fall back to S3
  const r2Config = getR2ClientConfig();
  const articleAssetClient = r2Config ? new S3Client(r2Config) : s3Client;
  const articleAssetBucket = getR2Bucket() ?? config.articleAssetBucketName;
  
  if (r2Config) {
    console.log(`[BatchProcessor] Using R2 for article assets (bucket: ${articleAssetBucket})`);
  } else {
    console.log(`[BatchProcessor] Using S3 for article assets (bucket: ${articleAssetBucket})`);
  }
  
  const rateLimiter = new RateLimiter(config.rateLimit);

  const repoConfig: TaskRepositoryConfig = {
    tableName: config.taskTableName,
    statusIndexName: config.taskStatusIndexName,
  };

  const stats: BatchStats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    startTime: Date.now(),
  };

  const ctx: BatchContext = {
    config,
    docClient,
    s3Client,
    articleAssetClient,
    articleAssetBucket,
    repoConfig,
    rateLimiter,
    stats,
  };

  // Calculate max tasks to process
  const pendingCount = await countPendingTasks(docClient, repoConfig);
  const maxTasks = calculateMaxTasks(config, pendingCount);
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

    const result = await processTask(ctx, task);
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
        process.exit(1);
      }

      // Cooldown before next attempt
      await sleep(config.rateLimit.cooldownOnErrorMs);
    } else {
      stats.skipped++;
    }

    stats.processed++;
  }

  // Batch complete
  const duration = Date.now() - stats.startTime;
  console.log("\n============================================");
  console.log("          Batch Execution Summary           ");
  console.log("============================================");
  console.log(`Environment: ${config.environment}`);
  console.log(`Duration   : ${duration}ms`);
  console.log("--------------------------------------------");
  console.log(`Processed  : ${stats.processed}`);
  console.log(`Succeeded  : ${stats.succeeded}`);
  console.log(`Failed     : ${stats.failed}`);
  console.log(`Skipped    : ${stats.skipped}`);
  console.log("============================================\n");
  
  await notifyBatchComplete(stats, "success");
  process.exit(0);
}

function calculateMaxTasks(config: AppConfig, pendingCount: number): number {
  const { batch, rateLimit } = config;
  if (batch.maxTasksPerRun === "auto") {
    return Math.max(rateLimit.requestsPerDay, pendingCount);
  }
  return batch.maxTasksPerRun;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[BatchProcessor] Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[BatchProcessor] Received SIGINT, shutting down gracefully");
  process.exit(0);
});

// Run main
main().catch((error) => {
  console.error("[BatchProcessor] Fatal error:", error);
  process.exit(1);
});

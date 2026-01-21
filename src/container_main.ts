/**
 * Container entry point for Fargate batch processing.
 * Processes pending tasks with rate limiting and exits when complete.
 */

import { S3Client } from "@aws-sdk/client-s3";
import { appConfig } from "./config";
import { createDocumentClient } from "@utils/dynamo";
import { getS3ClientConfig, getR2ClientConfig, getR2Bucket } from "@utils/aws";
import { RateLimiter } from "@utils/rateLimiter";
import type { TaskRepositoryConfig } from "./tasks/taskRepository";
import { BatchProcessor, type BatchContext, type BatchStats } from "./batch/batchProcessor";

async function main(): Promise<void> {
  const config = appConfig;
  console.log(`[BatchProcessor] Starting in ${config.environment} environment`);

  const docClient = createDocumentClient();
  const s3Client = new S3Client(getS3ClientConfig());
  
  // Use R2 for article assets if configured, otherwise fall back to S3
  let articleAssetClient: S3Client;
  let articleAssetBucket: string;

  if (config.r2) {
    const r2Config = getR2ClientConfig();
    articleAssetClient = new S3Client(r2Config);
    articleAssetBucket = getR2Bucket();
    console.log(`[BatchProcessor] Using R2 for article assets (bucket: ${articleAssetBucket})`);
  } else {
    articleAssetClient = s3Client;
    articleAssetBucket = config.articleAssetBucketName;
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

  const processor = new BatchProcessor(ctx);
  await processor.run();
  
  process.exit(0);
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
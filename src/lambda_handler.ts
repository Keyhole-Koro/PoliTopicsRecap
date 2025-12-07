import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { LlmClient } from "@llm/llmClient";
import {
  bumpRetryAttempts,
  fetchOldestPendingTask,
  type TaskRepositoryConfig,
} from "./tasks/taskRepository";
import type { TaskItem } from "./tasks/types";
import { resolveConfig } from "@utils/config";
import { getS3ClientConfig } from "@utils/aws";
import { createDocumentClient } from "@utils/dynamo";
import { createLlmClient } from "./lambda/llmFactory";
import {
  handleDirectTask,
  handleChunkedTask,
  type TaskProcessorArgs,
} from "./lambda/taskProcessor";

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
      await handleDirectTask(buildTaskArgs({
        task,
        docClient,
        repoConfig,
        s3Client,
        llmClient,
        articleTableName: config.articleTableName,
        articleAssetBucketName: config.articleAssetBucketName,
      }));
      return;
    }

    await handleChunkedTask(buildTaskArgs({
      task,
      docClient,
      repoConfig,
      s3Client,
      llmClient,
      articleTableName: config.articleTableName,
      articleAssetBucketName: config.articleAssetBucketName,
    }));
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

type BuildArgsInput = {
  task: TaskItem;
  docClient: DynamoDBDocumentClient;
  repoConfig: TaskRepositoryConfig;
  s3Client: S3Client;
  llmClient: LlmClient;
  articleTableName: string;
  articleAssetBucketName: string;
};

function buildTaskArgs(input: BuildArgsInput): TaskProcessorArgs {
  const { task, docClient, repoConfig, s3Client, llmClient, articleTableName, articleAssetBucketName } = input;
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
    meeting: task.meeting,
  };
}

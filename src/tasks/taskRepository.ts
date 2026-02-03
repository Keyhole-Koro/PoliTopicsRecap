import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  type QueryCommandOutput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { TaskItem, ChunkItem, ProcessingMode, TaskStatus } from "./types";
import { asTaskItem } from "./validators";

export type TaskRepositoryConfig = {
  tableName: string;
  statusIndexName: string;
};

async function fetchOldestTaskByStatus(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  status: string,
): Promise<TaskItem | null> {
  let startKey: Record<string, any> | undefined = undefined;
  const exprNames = { "#status": "status" };
  const exprValues = { ":status": status, ":maxAttempts": 3 };

  while (true) {
    const res: QueryCommandOutput = await doc.send(
      new QueryCommand({
        TableName: cfg.tableName,
        IndexName: cfg.statusIndexName,
        KeyConditionExpression: "#status = :status",
        FilterExpression: "attribute_not_exists(retryAttempts) OR retryAttempts < :maxAttempts",
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ScanIndexForward: true,
        Limit: 25,
        ExclusiveStartKey: startKey,
      }),
    );

    const [raw] = res.Items ?? [];
    if (raw) {
      const task = asTaskItem(raw);
      if (task) return task;
    }

    if (!res.LastEvaluatedKey) return null;
    startKey = res.LastEvaluatedKey;
  }
}

export async function fetchOldestReadyTask(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
): Promise<TaskItem | null> {
  const [pending, remake] = await Promise.all([
    fetchOldestTaskByStatus(doc, cfg, "pending"),
    fetchOldestTaskByStatus(doc, cfg, "remake"),
  ]);
  if (!pending) return remake;
  if (!remake) return pending;
  return pending.createdAt <= remake.createdAt ? pending : remake;
}

export async function fetchOldestIngestedTask(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
): Promise<TaskItem | null> {
  return fetchOldestTaskByStatus(doc, cfg, "ingested");
}

async function countTasksByStatus(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  status: string,
): Promise<number> {
  let count = 0;
  let startKey: Record<string, any> | undefined = undefined;
  const exprNames = { "#status": "status" };
  const exprValues = { ":status": status, ":maxAttempts": 3 };

  while (true) {
    const res: QueryCommandOutput = await doc.send(
      new QueryCommand({
        TableName: cfg.tableName,
        IndexName: cfg.statusIndexName,
        KeyConditionExpression: "#status = :status",
        FilterExpression: "attribute_not_exists(retryAttempts) OR retryAttempts < :maxAttempts",
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        Select: "COUNT",
        ExclusiveStartKey: startKey,
      }),
    );

    count += res.Count ?? 0;

    if (!res.LastEvaluatedKey) break;
    startKey = res.LastEvaluatedKey;
  }

  return count;
}

export async function countReadyTasks(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
): Promise<number> {
  const [pending, remake] = await Promise.all([
    countTasksByStatus(doc, cfg, "pending"),
    countTasksByStatus(doc, cfg, "remake"),
  ]);
  return pending + remake;
}

export async function fetchTasksByStatusPage(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  status: string,
  options?: {
    startKey?: Record<string, any>;
    limit?: number;
    maxRetryAttempts?: number;
  },
): Promise<{ tasks: TaskItem[]; lastKey?: Record<string, any> }> {
  const exprNames: Record<string, string> = { "#status": "status" };
  const exprValues: Record<string, any> = { ":status": status };
  const queryInput: {
    TableName: string;
    IndexName: string;
    KeyConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, any>;
    ScanIndexForward: boolean;
    Limit: number;
    ExclusiveStartKey?: Record<string, any>;
    FilterExpression?: string;
  } = {
    TableName: cfg.tableName,
    IndexName: cfg.statusIndexName,
    KeyConditionExpression: "#status = :status",
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ScanIndexForward: true,
    Limit: options?.limit ?? 25,
  };

  if (options?.maxRetryAttempts !== undefined) {
    queryInput.FilterExpression = "attribute_not_exists(retryAttempts) OR retryAttempts < :maxAttempts";
    exprValues[":maxAttempts"] = options.maxRetryAttempts;
  }

  if (options?.startKey) {
    queryInput.ExclusiveStartKey = options.startKey;
  }

  const res = await doc.send(new QueryCommand(queryInput));
  const tasks = (res.Items ?? [])
    .map((item) => asTaskItem(item))
    .filter((item): item is TaskItem => Boolean(item));

  return { tasks, lastKey: res.LastEvaluatedKey };
}

export async function getTaskById(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  taskId: string,
): Promise<TaskItem | null> {
  const res = await doc.send(
    new GetCommand({
      TableName: cfg.tableName,
      Key: { pk: taskId },
    }),
  );
  return asTaskItem(res.Item);
}

export async function markChunkReady(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  task: TaskItem,
  chunkId: string,
): Promise<void> {
  if (!task.chunks) {
    throw new Error(`Task ${task.pk} does not contain chunks`);
  }
  const index = task.chunks.findIndex((chunk) => chunk.id === chunkId);
  if (index < 0) {
    throw new Error(`Chunk ${chunkId} not found in task ${task.pk}`);
  }

  const now = dateOnlyNow();
  try {
    await doc.send(
      new UpdateCommand({
        TableName: cfg.tableName,
        Key: { pk: task.pk },
        ConditionExpression: "(#status = :pending OR #status = :remake)",
        UpdateExpression: `SET chunks[${index}].#chunkStatus = :ready, #updatedAt = :now`,
        ExpressionAttributeNames: {
          "#chunkStatus": "status",
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":pending": "pending",
          ":remake": "remake",
          ":ready": "ready",
          ":now": now,
        },
      }),
    );
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      console.warn(`[markChunkReady] Condition failed for ${task.pk} chunk ${chunkId} (task likely not pending)`);
      return;
    }
    throw err;
  }
}

export async function markTaskSucceeded(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  task: TaskItem,
): Promise<void> {
  const now = dateOnlyNow();
  try {
    await doc.send(
      new UpdateCommand({
        TableName: cfg.tableName,
        Key: { pk: task.pk },
        ConditionExpression: "(#status = :pending OR #status = :remake)",
        UpdateExpression: "SET #status = :completed, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":pending": "pending",
          ":remake": "remake",
          ":completed": "completed",
          ":now": now,
        },
      }),
    );
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      console.warn(`[markTaskSucceeded] Condition failed for ${task.pk} (task likely not pending)`);
      return;
    }
    throw err;
  }
}

export async function bumpRetryAttempts(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  task: TaskItem,
): Promise<void> {
  const now = dateOnlyNow();
  await doc.send(
    new UpdateCommand({
      TableName: cfg.tableName,
      Key: { pk: task.pk },
      UpdateExpression: "SET retryAttempts = :next, #updatedAt = :now",
      ExpressionAttributeNames: { "#updatedAt": "updatedAt" },
      ExpressionAttributeValues: {
        ":next": (task.retryAttempts ?? 0) + 1,
        ":now": now,
      },
    }),
  );
}

export async function updateTaskForPrompt(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  taskId: string,
  updates: {
    status: TaskStatus;
    llm: string;
    llmModel: string;
    retryAttempts: number;
    updatedAt: string;
    processingMode: ProcessingMode;
    prompt_version: string;
    prompt_url: string;
    result_url: string;
    chunks: ChunkItem[];
    maxInputToken: number;
  },
): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: cfg.tableName,
      Key: { pk: taskId },
      ConditionExpression: "attribute_exists(pk)",
      UpdateExpression:
        "SET #status = :status, llm = :llm, llmModel = :llmModel, retryAttempts = :retryAttempts, #updatedAt = :updatedAt, #processingMode = :processingMode, prompt_version = :promptVersion, prompt_url = :promptUrl, result_url = :resultUrl, chunks = :chunks, maxInputToken = :maxInputToken",
      ExpressionAttributeNames: {
        "#status": "status",
        "#updatedAt": "updatedAt",
        "#processingMode": "processingMode",
      },
      ExpressionAttributeValues: {
        ":status": updates.status,
        ":llm": updates.llm,
        ":llmModel": updates.llmModel,
        ":retryAttempts": updates.retryAttempts,
        ":updatedAt": updates.updatedAt,
        ":processingMode": updates.processingMode,
        ":promptVersion": updates.prompt_version,
        ":promptUrl": updates.prompt_url,
        ":resultUrl": updates.result_url,
        ":chunks": updates.chunks,
        ":maxInputToken": updates.maxInputToken,
      },
    }),
  );
}

function dateOnlyNow(): string {
  return new Date().toISOString().slice(0, 10);
}

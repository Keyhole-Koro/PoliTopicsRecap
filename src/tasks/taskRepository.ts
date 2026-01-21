import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  type QueryCommandOutput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { TaskItem } from "./types";
import { asTaskItem } from "./validators";

export type TaskRepositoryConfig = {
  tableName: string;
  statusIndexName: string;
};

export async function fetchOldestPendingTask(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
): Promise<TaskItem | null> {
  let startKey: Record<string, any> | undefined = undefined;
  const exprNames = { "#status": "status" };
  const exprValues = { ":pending": "pending", ":maxAttempts": 3 };

  while (true) {
    const res: QueryCommandOutput = await doc.send(
      new QueryCommand({
        TableName: cfg.tableName,
        IndexName: cfg.statusIndexName,
        KeyConditionExpression: "#status = :pending",
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

export async function countPendingTasks(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
): Promise<number> {
  let count = 0;
  let startKey: Record<string, any> | undefined = undefined;
  const exprNames = { "#status": "status" };
  const exprValues = { ":pending": "pending", ":maxAttempts": 3 };

  while (true) {
    const res: QueryCommandOutput = await doc.send(
      new QueryCommand({
        TableName: cfg.tableName,
        IndexName: cfg.statusIndexName,
        KeyConditionExpression: "#status = :pending",
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

export async function getTaskByIssue(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  issueID: string,
): Promise<TaskItem | null> {
  const res = await doc.send(
    new GetCommand({
      TableName: cfg.tableName,
      Key: { pk: issueID },
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
        ConditionExpression: "#status = :pending",
        UpdateExpression: `SET chunks[${index}].#chunkStatus = :ready, #updatedAt = :now`,
        ExpressionAttributeNames: {
          "#chunkStatus": "status",
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":pending": "pending",
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
        ConditionExpression: "#status = :pending",
        UpdateExpression: "SET #status = :completed, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":pending": "pending",
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

function dateOnlyNow(): string {
  return new Date().toISOString().slice(0, 10);
}

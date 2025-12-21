import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
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
  const res = await doc.send(
    new QueryCommand({
      TableName: cfg.tableName,
      IndexName: cfg.statusIndexName,
      KeyConditionExpression: "#status = :pending",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":pending": "pending" },
      ScanIndexForward: true,
      Limit: 1,
    }),
  );

  const [raw] = res.Items ?? [];
  return asTaskItem(raw);
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
}

export async function markTaskSucceeded(
  doc: DynamoDBDocumentClient,
  cfg: TaskRepositoryConfig,
  task: TaskItem,
): Promise<void> {
  const now = dateOnlyNow();
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

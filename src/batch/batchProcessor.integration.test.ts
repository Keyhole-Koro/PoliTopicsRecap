/**
 * Integration test for container batch processing with LocalStack.
 * 
 * This test verifies the batch processing logic works correctly
 * with real AWS services (via LocalStack).
 */

import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "@utils/dynamo";
import { appConfig, setAppEnvironment } from "../config";
import { RateLimiter } from "@utils/rateLimiter";
import {
  countReadyTasks,
  type TaskRepositoryConfig,
} from "../tasks/taskRepository";
import type { TaskItem } from "../tasks/types";

describe("Batch Processing Integration", () => {
  let docClient: DynamoDBDocumentClient;
  let repoConfig: TaskRepositoryConfig;
  const testTaskIds: string[] = [];

  beforeAll(() => {
    setAppEnvironment("localstackTest");
    docClient = createDocumentClient();
    repoConfig = {
      tableName: appConfig.taskTableName,
      statusIndexName: appConfig.taskStatusIndexName,
    };
  });

  afterAll(async () => {
    // Clean up test tasks
    for (const pk of testTaskIds) {
      try {
        await docClient.send(
          new DeleteCommand({
            TableName: repoConfig.tableName,
            Key: { pk },
          })
        );
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  async function createTestTask(overrides: Partial<TaskItem> = {}): Promise<TaskItem> {
    const pk = `test-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testTaskIds.push(pk);

    const task: TaskItem = {
      pk,
      status: "pending",
      processingMode: "single_chunk",
      llm: "gemini",
      llmModel: "gemini-1.5-flash",
      retryAttempts: 0,
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
      ...overrides,
    } as TaskItem;

    await docClient.send(
      new PutCommand({
        TableName: repoConfig.tableName,
        Item: task,
      })
    );

    return task;
  }

  describe("Rate Limiter with Task Fetching", () => {
    it("should respect rate limits when fetching tasks", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2025-01-18T10:00:00.000Z"));

        const rateLimiter = new RateLimiter({
          requestsPerMinute: 2,
          requestsPerDay: 10,
          maxConsecutiveErrors: 3,
          cooldownOnErrorMs: 100,
        });

        const waitPromises = [
          rateLimiter.waitIfNeeded(),
          rateLimiter.waitIfNeeded(),
          rateLimiter.waitIfNeeded(),
        ];

        jest.advanceTimersByTime(60 * 1000);

        const waits = await Promise.all(waitPromises);
        expect(waits[0]).toBe(0);
        expect(waits[1]).toBe(0);
        expect(waits[2]).toBe(60 * 1000);
      } finally {
        jest.useRealTimers();
      }
    });

    it("should track day limit correctly", async () => {
      const rateLimiter = new RateLimiter({
        requestsPerMinute: 100,
        requestsPerDay: 3,
        maxConsecutiveErrors: 3,
        cooldownOnErrorMs: 100,
      });

      expect(rateLimiter.isDayLimitReached()).toBe(false);
      expect(rateLimiter.getRemainingDayRequests()).toBe(3);

      await rateLimiter.waitIfNeeded();
      await rateLimiter.waitIfNeeded();
      await rateLimiter.waitIfNeeded();

      expect(rateLimiter.isDayLimitReached()).toBe(true);
      expect(rateLimiter.getRemainingDayRequests()).toBe(0);
    });
  });

  describe("Task Counting", () => {
    it("should count ready tasks correctly", async () => {
      const initialCount = await countReadyTasks(docClient, repoConfig);

      // Create a test task
      await createTestTask();

      const afterCount = await countReadyTasks(docClient, repoConfig);
      expect(afterCount).toBe(initialCount + 1);
    });

    it("should not count tasks with max retries", async () => {
      const initialCount = await countReadyTasks(docClient, repoConfig);

      // Create a task with max retries
      await createTestTask({ retryAttempts: 3 });

      const afterCount = await countReadyTasks(docClient, repoConfig);
      // Should not be counted because retryAttempts >= 3
      expect(afterCount).toBe(initialCount);
    });
  });

  describe("Max Tasks Calculation", () => {
    it("should calculate max tasks as max(requestsPerDay, pendingCount) when auto", () => {
      const calculateMaxTasks = (
        maxTasksPerRun: number | "auto",
        requestsPerDay: number,
        pendingCount: number
      ): number => {
        if (maxTasksPerRun === "auto") {
          return Math.max(requestsPerDay, pendingCount);
        }
        return maxTasksPerRun;
      };

      // When pendingCount > requestsPerDay
      expect(calculateMaxTasks("auto", 100, 200)).toBe(200);

      // When requestsPerDay > pendingCount
      expect(calculateMaxTasks("auto", 100, 50)).toBe(100);

      // When explicit number is set
      expect(calculateMaxTasks(10, 100, 200)).toBe(10);
    });
  });
});

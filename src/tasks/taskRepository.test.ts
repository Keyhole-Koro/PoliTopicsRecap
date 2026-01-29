import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { fetchOldestPendingTask, type TaskRepositoryConfig } from "./taskRepository";
import type { TaskItem } from "./types";

const cfg: TaskRepositoryConfig = { tableName: "tasks", statusIndexName: "StatusIndex" };

function buildTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    pk: "ISSUE-1",
    status: "pending",
    llm: "gemini",
    llmModel: "gemini-2.5-flash",
    retryAttempts: 0,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01",
    processingMode: "single_chunk",
    prompt_version: "2026-01-28.2",
    prompt_url: "s3://bucket/prompts/ISSUE-1.json",
    result_url: "s3://bucket/results/ISSUE-1.json",
    meeting: {
      issueID: "ISSUE-1",
      nameOfMeeting: "Test Meeting",
      nameOfHouse: "Test House",
      date: "2025-01-01",
      numberOfSpeeches: 1,
      session: 1,
    },
    attachedAssets: {
      speakerMetadataUrl: "s3://bucket/assets/ISSUE-1.json",
    },
    ...overrides,
  };
}

describe("fetchOldestPendingTask", () => {
  it("skips tasks with retryAttempts >= 3 and returns the next eligible task", async () => {
    const sendMock = jest
      .fn()
      // First page filtered out (e.g., retryAttempts >= 3)
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { pk: "ISSUE-0" } })
      // Second page contains an eligible task
      .mockResolvedValueOnce({ Items: [buildTask({ pk: "ISSUE-2", retryAttempts: 2 })] });

    const task = await fetchOldestPendingTask({ send: sendMock } as any, cfg);

    expect(task?.pk).toBe("ISSUE-2");
    expect(sendMock).toHaveBeenCalledTimes(2);

    for (const [command] of sendMock.mock.calls) {
      expect(command).toBeInstanceOf(QueryCommand);
      expect(command.input.FilterExpression).toBe(
        "attribute_not_exists(retryAttempts) OR retryAttempts < :maxAttempts",
      );
      expect(command.input.ExpressionAttributeValues?.[":maxAttempts"]).toBe(3);
      expect(command.input.Limit).toBe(25);
    }
  });
});

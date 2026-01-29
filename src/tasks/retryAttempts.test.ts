const bumpRetryAttemptsMock = jest.fn();
const handleDirectTaskMock = jest.fn();
const handleChunkedTaskMock = jest.fn();
const notifyTaskErrorMock = jest.fn();
const notifyTaskWarningMock = jest.fn();
const createLlmClientMock = jest.fn();
const assertTaskReadyForProcessingMock = jest.fn();

jest.mock("../tasks/taskRepository", () => ({
  bumpRetryAttempts: (...args: any[]) => bumpRetryAttemptsMock(...args),
  fetchOldestPendingTask: jest.fn(),
}));

jest.mock("../processor/taskProcessor", () => ({
  handleDirectTask: (...args: any[]) => handleDirectTaskMock(...args),
  handleChunkedTask: (...args: any[]) => handleChunkedTaskMock(...args),
}));

jest.mock("../processor/notifications", () => ({
  notifyTaskError: (...args: any[]) => notifyTaskErrorMock(...args),
  notifyTaskWarning: (...args: any[]) => notifyTaskWarningMock(...args),
}));

jest.mock("../processor/llmFactory", () => ({
  createLlmClient: (...args: any[]) => createLlmClientMock(...args),
}));

jest.mock("../tasks/taskValidator", () => ({
  assertTaskReadyForProcessing: (...args: any[]) => assertTaskReadyForProcessingMock(...args),
}));

import type { AppConfig } from "../config";
import { processTask } from "../processor/taskRunner";
import type { TaskItem } from "./types";

/*
 * increments retryAttempts even when error notifications fail
 * [Contract] Failed task processing must still increment retryAttempts if notification delivery errors out.
 * [Reason] Notification failures should not prevent retry tracking.
 * [Accident] Without this, retryAttempts can remain stale and hide repeated failures.
 * [Odd] Forces handleDirectTask and notifyTaskError to reject to simulate error handling.
 * [History] None.
 */

const baseConfig: AppConfig = {
  environment: "local",
  aws: {
    region: "ap-northeast-3",
    endpoint: "http://localhost:4566",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    clientConfig: { region: "ap-northeast-3" },
  },
  taskTableName: "tasks",
  taskStatusIndexName: "StatusIndex",
  promptBucketName: "prompts",
  articleTableName: "articles",
  articleAssetBucketName: "assets",
  r2: {
    endpoint: "http://localhost:4566",
    region: "ap-northeast-3",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "assets",
    publicUrlBase: "http://localhost:4566/assets",
    clientConfig: { region: "ap-northeast-3" },
  },
  geminiApiKey: "test-key",
  notifications: {
    errorWebhook: "",
    warnWebhook: "",
    batchWebhook: "",
  },
  notificationSettings: {
    enabled: false,
    delayMs: 0,
  },
  rateLimit: {
    requestsPerMinute: 1,
    requestsPerDay: 1,
    maxConsecutiveErrors: 1,
    cooldownOnErrorMs: 0,
  },
  batch: {
    maxTasksPerRun: 1,
    gracefulShutdownTimeoutMs: 0,
  },
};

const baseContext = {
  config: baseConfig,
  docClient: {} as any,
  s3Client: {} as any,
  articleAssetClient: {} as any,
  articleAssetBucket: "assets",
  repoConfig: { tableName: "tasks", statusIndexName: "StatusIndex" },
};

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
    prompt_url: "s3://bucket/prompts/reduce/ISSUE-1.json",
    result_url: "s3://bucket/results/ISSUE-1_reduce.json",
    meeting: {
      issueID: "ISSUE-1",
      nameOfMeeting: "Test Meeting",
      nameOfHouse: "Test House",
      date: "2025-01-01",
      numberOfSpeeches: 1,
      session: 1,
    },
    attachedAssets: {
      speakerMetadataUrl: "s3://bucket/attachedAssets/ISSUE-1.json",
    },
    ...overrides,
  };
}

describe("retryAttempts", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    createLlmClientMock.mockReturnValue({ generate: jest.fn() });
    assertTaskReadyForProcessingMock.mockImplementation(() => {});
  });

  it("increments retryAttempts even when error notifications fail", async () => {
    const task: TaskItem = buildTask({ retryAttempts: 1 });

    handleDirectTaskMock.mockRejectedValueOnce(new Error("task failure"));
    notifyTaskErrorMock.mockRejectedValueOnce(new Error("notify failure"));

    const result = await processTask(baseContext, task);

    expect(result.status).toBe("failed");
    expect(notifyTaskErrorMock).toHaveBeenCalledTimes(1);
    expect(bumpRetryAttemptsMock).toHaveBeenCalledTimes(1);
    expect(bumpRetryAttemptsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      task,
    );
  });

  it("skips processing when retryAttempts is 3", async () => {
    const task = buildTask({ retryAttempts: 3 });

    const result = await processTask(baseContext, task);

    expect(result.status).toBe("skipped");
    expect(handleDirectTaskMock).not.toHaveBeenCalled();
    expect(handleChunkedTaskMock).not.toHaveBeenCalled();
    expect(bumpRetryAttemptsMock).not.toHaveBeenCalled();
    expect(notifyTaskErrorMock).not.toHaveBeenCalled();
    expect(notifyTaskWarningMock).not.toHaveBeenCalled();
  });
});

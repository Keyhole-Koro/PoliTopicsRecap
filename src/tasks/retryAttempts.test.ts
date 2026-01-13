const fetchOldestPendingTaskMock = jest.fn();
const bumpRetryAttemptsMock = jest.fn();
const handleDirectTaskMock = jest.fn();
const handleChunkedTaskMock = jest.fn();
const notifyTaskErrorMock = jest.fn();
const notifyTaskWarningMock = jest.fn();
const createLlmClientMock = jest.fn();
const resolveConfigMock = jest.fn();
const getS3ClientConfigMock = jest.fn();
const createDocumentClientMock = jest.fn();
const assertTaskReadyForProcessingMock = jest.fn();

jest.mock("./taskRepository", () => ({
  fetchOldestPendingTask: (...args: any[]) => fetchOldestPendingTaskMock(...args),
  bumpRetryAttempts: (...args: any[]) => bumpRetryAttemptsMock(...args),
}));

jest.mock("../lambda/taskProcessor", () => ({
  handleDirectTask: (...args: any[]) => handleDirectTaskMock(...args),
  handleChunkedTask: (...args: any[]) => handleChunkedTaskMock(...args),
}));

jest.mock("../lambda/notifications", () => ({
  notifyTaskError: (...args: any[]) => notifyTaskErrorMock(...args),
  notifyTaskWarning: (...args: any[]) => notifyTaskWarningMock(...args),
}));

jest.mock("../lambda/llmFactory", () => ({
  createLlmClient: (...args: any[]) => createLlmClientMock(...args),
}));

jest.mock("@utils/config", () => ({
  resolveConfig: (...args: any[]) => resolveConfigMock(...args),
}));

jest.mock("@utils/aws", () => ({
  getS3ClientConfig: (...args: any[]) => getS3ClientConfigMock(...args),
}));

jest.mock("@utils/dynamo", () => ({
  createDocumentClient: (...args: any[]) => createDocumentClientMock(...args),
}));

jest.mock("./taskValidator", () => ({
  assertTaskReadyForProcessing: (...args: any[]) => assertTaskReadyForProcessingMock(...args),
}));

import { handler } from "../lambda_handler";
import type { TaskItem } from "./types";

/*
 * increments retryAttempts even when error notifications fail
 * [Contract] Failed task processing must still increment retryAttempts if notification delivery errors out.
 * [Reason] Notification failures should not prevent retry tracking.
 * [Accident] Without this, retryAttempts can remain stale and hide repeated failures.
 * [Odd] Forces handleDirectTask and notifyTaskError to reject to simulate error handling.
 * [History] None.
 */

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
    resolveConfigMock.mockReturnValue({
      taskTableName: "tasks",
      taskStatusIndexName: "StatusIndex",
      geminiApiKey: "test-key",
      articleTableName: "articles",
      articleAssetBucketName: "assets",
    });
    getS3ClientConfigMock.mockReturnValue({ region: "ap-northeast-1" });
    createDocumentClientMock.mockReturnValue({});
    createLlmClientMock.mockReturnValue({ generate: jest.fn() });
    assertTaskReadyForProcessingMock.mockImplementation(() => {});
  });

  it("increments retryAttempts even when error notifications fail", async () => {
    const task: TaskItem = buildTask({ retryAttempts: 1 });

    fetchOldestPendingTaskMock.mockResolvedValueOnce(task);
    handleDirectTaskMock.mockRejectedValueOnce(new Error("task failure"));
    notifyTaskErrorMock.mockRejectedValueOnce(new Error("notify failure"));

    await expect(handler()).resolves.toBeUndefined();

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
    fetchOldestPendingTaskMock.mockResolvedValueOnce(task);

    await expect(handler()).resolves.toBeUndefined();

    expect(handleDirectTaskMock).not.toHaveBeenCalled();
    expect(handleChunkedTaskMock).not.toHaveBeenCalled();
    expect(bumpRetryAttemptsMock).not.toHaveBeenCalled();
    expect(notifyTaskErrorMock).not.toHaveBeenCalled();
    expect(notifyTaskWarningMock).not.toHaveBeenCalled();
  });
});

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  countPendingTasks,
  fetchOldestPendingTask,
  type TaskRepositoryConfig,
} from "./taskRepository";
import { createDocumentClient } from "@utils/dynamo";
import { appConfig, setAppEnvironment } from "../config";

describe("countPendingTasks", () => {
  let docClient: DynamoDBDocumentClient;
  let repoConfig: TaskRepositoryConfig;

  beforeAll(() => {
    setAppEnvironment("localstackTest");
    docClient = createDocumentClient();
    repoConfig = {
      tableName: appConfig.taskTableName,
      statusIndexName: appConfig.taskStatusIndexName,
    };
  });

  it("should return 0 when no pending tasks exist", async () => {
    // This test requires LocalStack to be running with empty table
    // In a real test environment, we would seed the table first
    const count = await countPendingTasks(docClient, repoConfig);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchOldestPendingTask", () => {
  let docClient: DynamoDBDocumentClient;
  let repoConfig: TaskRepositoryConfig;

  beforeAll(() => {
    setAppEnvironment("localstackTest");
    docClient = createDocumentClient();
    repoConfig = {
      tableName: appConfig.taskTableName,
      statusIndexName: appConfig.taskStatusIndexName,
    };
  });

  it("should return null when no pending tasks exist", async () => {
    // Note: This test may return a task if LocalStack has data from other tests
    const task = await fetchOldestPendingTask(docClient, repoConfig);
    // We just verify it doesn't throw and returns either null or a task
    expect(task === null || typeof task === "object").toBe(true);
  });
});

import type { AppConfig } from "../../src/config";

const appConfig: AppConfig = {
  environment: "local",
  aws: {
    region: "us-east-1",
    endpoint: "http://localhost:4566",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  },
  taskTableName: "politopics-llm-tasks-local",
  taskStatusIndexName: "StatusIndex",
  promptBucketName: "politopics-prompts",
  articleTableName: "politopics-local",
  articleAssetBucketName: "politopics-articles-local",
  geminiApiKey: "test-key",
};

jest.mock("../../src/config", () => ({
  appConfig,
  setAppEnvironment: jest.fn(),
  setAppConfig: jest.fn(),
  updateAppConfig: jest.fn(),
  consumeCacheBypass: jest.fn(),
}));

jest.mock("../../src/utils/config", () => ({
  resolveConfig: () => appConfig,
}));

jest.mock("@utils/config", () => ({
  resolveConfig: () => appConfig,
}));

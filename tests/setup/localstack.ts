declare global {
  // eslint-disable-next-line no-var
  var __geminiGenerateMock: jest.Mock;
  // eslint-disable-next-line no-var
  var __geminiGetModelMock: jest.Mock;
  // eslint-disable-next-line no-var
  var __googleGenerativeAiCtorMock: jest.Mock;
}

const endpoint =
  process.env.LOCALSTACK_ENDPOINT_URL ??
  process.env.AWS_ENDPOINT_URL ??
  process.env.LOCALSTACK_URL ??
  process.env.LOCALSTACK_ENDPOINT ??
  "http://localstack:4566";

process.env.LOCALSTACK_ENDPOINT_URL = endpoint;
if (!process.env.AWS_ENDPOINT_URL) {
  process.env.AWS_ENDPOINT_URL = endpoint;
}

process.env.PROMPT_BUCKET_NAME = process.env.PROMPT_BUCKET_NAME ?? "politopics-prompts";
process.env.ARTICLE_ASSET_BUCKET_NAME = process.env.ARTICLE_ASSET_BUCKET_NAME ?? "politopics-articles";
process.env.LLM_TASK_TABLE = process.env.LLM_TASK_TABLE ?? "PoliTopics-llm-tasks";
process.env.LLM_TASK_STATUS_INDEX = process.env.LLM_TASK_STATUS_INDEX ?? "StatusIndex";
process.env.ARTICLE_TABLE_NAME = process.env.ARTICLE_TABLE_NAME ?? "PoliTopics";

// Some CI terminals report tiny or negative column widths, which breaks Jest's status renderer.
const stdout: any = process.stdout;
if (stdout && typeof stdout.columns === "number" && stdout.columns < 10) {
  stdout.columns = 80;
}
if (stdout && typeof stdout.columns !== "number") {
  stdout.columns = 80;
}

if (!process.env.AWS_REGION) {
  process.env.AWS_REGION = "ap-northeast-3";
}
if (!process.env.AWS_ACCESS_KEY_ID) {
  process.env.AWS_ACCESS_KEY_ID = "test";
}

if (!process.env.AWS_SECRET_ACCESS_KEY) {
  process.env.AWS_SECRET_ACCESS_KEY = "test";
}

process.env.AWS_S3_FORCE_PATH_STYLE = "1";

if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = "local-test-key";
}

const generateContentMock = jest.fn().mockResolvedValue({
  response: {
    text: () => "stubbed llm output",
  },
});

const getGenerativeModelMock = jest.fn().mockReturnValue({
  generateContent: generateContentMock,
});

const GoogleGenerativeAI = jest.fn().mockImplementation(() => ({
  getGenerativeModel: getGenerativeModelMock,
}));

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI,
}));

export {};

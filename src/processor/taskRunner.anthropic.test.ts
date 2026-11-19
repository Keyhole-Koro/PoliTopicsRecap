const streamMock = jest.fn();
const countTokensMock = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  const actual = jest.requireActual("@anthropic-ai/sdk");
  const AnthropicMock = jest.fn(() => ({
    messages: {
      stream: (...args: unknown[]) => streamMock(...args),
      countTokens: (...args: unknown[]) => countTokensMock(...args),
    },
  }));
  // Keep the SDK error classes so `instanceof Anthropic.APIError` works in the client.
  Object.assign(AnthropicMock, { APIError: actual.APIError, BadRequestError: actual.BadRequestError });
  return { __esModule: true, ...actual, default: AnthropicMock };
});

const bumpRetryAttemptsMock = jest.fn();
const markTaskSucceededMock = jest.fn();
const markChunkReadyMock = jest.fn();
const updateTaskForPromptMock = jest.fn();

jest.mock("../tasks/taskRepository", () => ({
  bumpRetryAttempts: (...args: unknown[]) => bumpRetryAttemptsMock(...args),
  markTaskSucceeded: (...args: unknown[]) => markTaskSucceededMock(...args),
  markChunkReady: (...args: unknown[]) => markChunkReadyMock(...args),
  updateTaskForPrompt: (...args: unknown[]) => updateTaskForPromptMock(...args),
  fetchOldestReadyTask: jest.fn(),
  fetchTasksByStatusPage: jest.fn(),
}));

const fetchObjectTextMock = jest.fn();
const fetchJsonObjectMock = jest.fn();
const uploadObjectMock = jest.fn();
const uploadJsonMock = jest.fn();

jest.mock("@utils/s3", () => ({
  ...jest.requireActual("@utils/s3"),
  fetchObjectText: (...args: unknown[]) => fetchObjectTextMock(...args),
  fetchJsonObject: (...args: unknown[]) => fetchJsonObjectMock(...args),
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
  uploadJson: (...args: unknown[]) => uploadJsonMock(...args),
}));

const storeDataMock = jest.fn();

jest.mock("../dynamoDB/storeData", () => ({
  __esModule: true,
  default: (...args: unknown[]) => storeDataMock(...args),
}));

jest.mock("./notifications", () => ({
  notifyTaskError: jest.fn(),
  notifyTaskWarning: jest.fn(),
  notifyArticlePersisted: jest.fn(),
  notifyArticlePersistenceSkipped: jest.fn(),
}));

import Anthropic from "@anthropic-ai/sdk";
import { appConfig } from "../config";
import { PROMPT_VERSION } from "../prompts/prompts";
import type { TaskItem } from "../tasks/types";
import { CLAUDE_JSON_SYSTEM_INSTRUCTION } from "./llmFactory";
import { processTask, type TaskRunnerContext } from "./taskRunner";

/*
 * processes a task prepared for Gemini on Claude with the JSON-only system instruction
 * [Contract] With the default provider, processTask sends the prompt through the real factory and AnthropicClient (model, max_tokens, effort, system instruction), stores the JSON text, persists the article and marks the task succeeded.
 * [Reason] Tasks prepared before the switch (llm=gemini) must finish on Claude.
 * [Accident] Without this, in-flight tasks would keep calling Gemini, or the wiring from config to the SDK call could drift unnoticed.
 * [Odd] @anthropic-ai/sdk, S3 helpers, the task repository, storeData and notifications are mocked; no LocalStack or network.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * remakes the task with smaller chunks when Claude says the prompt is too long
 * [Contract] A 400 "prompt is too long" from the SDK is recognised as a token-limit error: the task is re-prepared with maxInputToken*0.7, counted with Claude count_tokens and tagged llm=anthropic with the Claude model.
 * [Reason] The existing shrink-and-retry path must keep working with Claude's error format.
 * [Accident] Without this, oversized prompts would fail three times and be skipped.
 * [Odd] Uses the SDK's real BadRequestError class.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * fails without storing anything when Claude's output is cut off
 * [Contract] stop_reason max_tokens fails the task (retryAttempts bumped, error notified) without uploading the partial JSON, marking the chunk ready, or remaking the task.
 * [Reason] Truncated JSON must never be stored or marked as a finished chunk.
 * [Accident] Without this, a cut-off chunk result would break the reduce step later.
 * [Odd] Covers both single_chunk and chunked tasks.
 * [History] Gemini to Claude Haiku migration (2026-11).
 */

const TASK_ID = "TASK-anthropic-1";

function buildTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    pk: TASK_ID,
    status: "pending",
    llm: "gemini",
    llmModel: "gemini-3-flash-preview",
    retryAttempts: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01",
    processingMode: "single_chunk",
    prompt_version: PROMPT_VERSION,
    prompt_url: `s3://prompts/prompts/reduce/${TASK_ID}_direct.json`,
    result_url: `s3://prompts/results/${TASK_ID}_reduce.json`,
    raw_url: `s3://prompts/raw/${TASK_ID}.json`,
    maxInputToken: 64000,
    meeting: {
      issueID: "ISSUE-anthropic-1",
      nameOfMeeting: "予算委員会",
      nameOfHouse: "参議院",
      date: "2026-11-01",
      numberOfSpeeches: 2,
      session: 219,
    },
    attachedAssets: { speakerMetadataUrl: `s3://prompts/attachedAssets/${TASK_ID}.json` },
    ...overrides,
  };
}

const ARTICLE_JSON = JSON.stringify({
  id: TASK_ID,
  title: "テスト記事",
  summary: "## 決定事項\n- テスト",
  soft_language_summary: "テストの要約です。",
  key_points: ["要点1"],
  dialogs: [
    {
      order: 1,
      reaction: "質問",
      summary_sections: [{ title: "質問", bullets: [{ point: "予算について質問した", quote: "予算は", detail: "詳細" }] }],
    },
    {
      order: 2,
      reaction: "回答",
      summary_sections: [{ title: "回答", bullets: [{ point: "予算について回答した", quote: "予算は", detail: "詳細" }] }],
    },
  ],
});

function claudeMessage(args: { text: string; stopReason: string }): Anthropic.Message {
  return {
    id: "msg_wiring",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: args.text, citations: null },
    ],
    stop_reason: args.stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: { input_tokens: 900, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function respondWith(message: Anthropic.Message | Error): void {
  streamMock.mockImplementation(() => ({
    finalMessage: async () => {
      if (message instanceof Error) throw message;
      return message;
    },
  }));
}

const ATTACHED_ASSETS = JSON.stringify({
  speeches: [
    { order: 1, speaker: "架空太郎", originalText: "予算はどうなっていますか。" },
    { order: 2, speaker: "架空花子", originalText: "予算は確保しています。" },
  ],
});

const RAW_PAYLOAD = {
  ingestedAt: "2026-11-01T00:00:00Z",
  source: "kokkai.ndl",
  meeting: {
    issueID: "ISSUE-anthropic-1",
    session: 219,
    nameOfHouse: "参議院",
    nameOfMeeting: "予算委員会",
    date: "2026-11-01",
    speechRecord: [
      { speechID: "S1", speechOrder: 1, speaker: "架空太郎", speech: "予算はどうなっていますか。" },
      { speechID: "S2", speechOrder: 2, speaker: "架空花子", speech: "予算は確保しています。" },
    ],
  },
};

const ctx: TaskRunnerContext = {
  config: appConfig,
  docClient: {} as TaskRunnerContext["docClient"],
  s3Client: {} as TaskRunnerContext["s3Client"],
  articleAssetClient: {} as TaskRunnerContext["articleAssetClient"],
  articleAssetBucket: "assets",
  repoConfig: { tableName: "tasks", statusIndexName: "StatusIndex" },
};

describe("taskRunner with the default Anthropic provider", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    fetchObjectTextMock.mockImplementation(async (_client: unknown, _bucket: string, key: string) => {
      if (key.startsWith("attachedAssets/")) return ATTACHED_ASSETS;
      return "Summarize the speeches.";
    });
    fetchJsonObjectMock.mockResolvedValue(RAW_PAYLOAD);
    uploadObjectMock.mockResolvedValue(undefined);
    uploadJsonMock.mockResolvedValue(undefined);
    storeDataMock.mockResolvedValue(undefined);
    updateTaskForPromptMock.mockResolvedValue(undefined);
    countTokensMock.mockResolvedValue({ input_tokens: 10 });
  });

  afterEach(() => {
    // Restore only the console spies; the module mocks above must keep their implementations.
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("processes a task prepared for Gemini on Claude with the JSON-only system instruction", async () => {
    expect(appConfig.llmProvider).toBe("anthropic");
    respondWith(claudeMessage({ text: `\n${ARTICLE_JSON}\n`, stopReason: "end_turn" }));
    const task = buildTask();

    const result = await processTask(ctx, task);

    expect(result.status).toBe("succeeded");
    expect(Anthropic as unknown as jest.Mock).toHaveBeenCalledWith({
      apiKey: appConfig.anthropicApiKey,
      maxRetries: 2,
    });
    expect(streamMock).toHaveBeenCalledTimes(1);
    const [params, options] = streamMock.mock.calls[0];
    expect(params).toEqual({
      model: appConfig.anthropicModel,
      max_tokens: appConfig.anthropicMaxOutputToken,
      messages: [{ role: "user", content: "Summarize the speeches." }],
      output_config: { effort: appConfig.anthropicEffort },
      system: CLAUDE_JSON_SYSTEM_INSTRUCTION,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(warnSpy).toHaveBeenCalledWith(
      "[llmFactory] Task was prepared for another LLM provider; using the active provider",
      expect.objectContaining({ taskLlm: "gemini", provider: "anthropic" }),
    );

    expect(uploadObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: `results/${TASK_ID}_reduce.json`, body: ARTICLE_JSON }),
    );
    expect(storeDataMock).toHaveBeenCalledTimes(1);
    const storedArticle = storeDataMock.mock.calls[0][1];
    expect(storedArticle).toMatchObject({ id: TASK_ID, issueID: "ISSUE-anthropic-1" });
    expect(storedArticle.dialogs.map((dialog: { speaker: string }) => dialog.speaker)).toEqual(["架空太郎", "架空花子"]);
    expect(markTaskSucceededMock).toHaveBeenCalledTimes(1);
    expect(bumpRetryAttemptsMock).not.toHaveBeenCalled();
  });

  it("remakes the task with smaller chunks when Claude says the prompt is too long", async () => {
    respondWith(
      new Anthropic.BadRequestError(
        400,
        {
          type: "error",
          error: { type: "invalid_request_error", message: "prompt is too long: 1200000 tokens > 1000000 maximum" },
        },
        undefined,
        new Headers({ "request-id": "req_too_long" }),
      ),
    );
    const task = buildTask({ llm: "anthropic", llmModel: "claude-haiku-5-5" });

    const result = await processTask(ctx, task);

    expect(result.status).toBe("skipped");
    expect(bumpRetryAttemptsMock).not.toHaveBeenCalled();
    expect(countTokensMock).toHaveBeenCalledWith({
      model: appConfig.anthropicModel,
      messages: [{ role: "user", content: expect.stringContaining("[order 1]") }],
    });
    expect(updateTaskForPromptMock).toHaveBeenCalledTimes(1);
    expect(updateTaskForPromptMock).toHaveBeenCalledWith(
      ctx.docClient,
      ctx.repoConfig,
      TASK_ID,
      expect.objectContaining({
        status: "remake",
        llm: "anthropic",
        llmModel: appConfig.anthropicModel,
        maxInputToken: 44800,
      }),
    );
  });

  it("fails without storing anything when Claude's output is cut off", async () => {
    respondWith(claudeMessage({ text: '{"dialogs":[', stopReason: "max_tokens" }));

    const single = await processTask(ctx, buildTask());
    expect(single.status).toBe("failed");

    const chunked = await processTask(
      ctx,
      buildTask({
        processingMode: "chunked",
        chunks: [
          {
            id: "CHUNK#0",
            prompt_key: `prompts/${TASK_ID}_0.json`,
            prompt_url: `s3://prompts/prompts/${TASK_ID}_0.json`,
            result_url: `s3://prompts/results/${TASK_ID}_0_result.json`,
            status: "pending",
          },
        ],
      }),
    );
    expect(chunked.status).toBe("failed");

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(markChunkReadyMock).not.toHaveBeenCalled();
    expect(storeDataMock).not.toHaveBeenCalled();
    expect(updateTaskForPromptMock).not.toHaveBeenCalled();
    expect(bumpRetryAttemptsMock).toHaveBeenCalledTimes(2);
  });
});

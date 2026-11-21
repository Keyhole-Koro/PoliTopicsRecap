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
import type { ChunkItem, TaskItem } from "../tasks/types";
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
 * remakes a chunked task with smaller chunks when a chunk's output is cut off
 * [Contract] When the chunk step of a chunked task stops at max_tokens, the partial JSON is not uploaded and the chunk is not marked ready; the task is re-prepared as "remake" with maxInputToken*0.7 and retryAttempts is not bumped.
 * [Reason] Chunks are packed by input tokens, but the chunk output grows with the number of speeches (one dialog each) and Claude counts thinking toward max_tokens, so smaller chunks are the way out.
 * [Accident] Without this, such a chunk would fail three times on the same input and the meeting would be skipped for good (with Gemini the cut-off chunk was stored and the article was published with placeholder dialogs).
 * [Odd] The two-speech meeting is remade as single_chunk; only the remake itself is checked.
 * [History] Review fix in the Gemini to Claude Haiku migration (2026-11).
 *
 * fails without storing or remaking when the reduce step or a single_chunk task is cut off
 * [Contract] stop_reason max_tokens in a single_chunk task or in the reduce step of a chunked task fails the task (retryAttempts bumped) without uploading the partial JSON, persisting an article, marking a chunk ready or remaking the task.
 * [Reason] Truncated JSON must never be stored, and smaller chunks would not shrink these outputs.
 * [Accident] Without this, a cut-off result could be stored as the article, or the task could be remade without any chance of helping.
 * [Odd] Covers single_chunk and the reduce step in one test.
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

  it("remakes a chunked task with smaller chunks when a chunk's output is cut off", async () => {
    respondWith(claudeMessage({ text: '{"dialogs":[', stopReason: "max_tokens" }));
    const task = buildTask({
      llm: "anthropic",
      llmModel: "claude-haiku-5-5",
      processingMode: "chunked",
      prompt_url: `s3://prompts/prompts/reduce/${TASK_ID}.json`,
      chunks: [buildChunk(0, "pending")],
    });

    const result = await processTask(ctx, task);

    expect(result.status).toBe("skipped");
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(markChunkReadyMock).not.toHaveBeenCalled();
    expect(storeDataMock).not.toHaveBeenCalled();
    expect(bumpRetryAttemptsMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[TaskRunner] Chunk output hit max_tokens. Remaking task with smaller chunks",
      expect.objectContaining({ taskId: TASK_ID, currentMaxInputToken: 64000, nextMaxInputToken: 44800 }),
    );
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

  it("fails without storing or remaking when the reduce step or a single_chunk task is cut off", async () => {
    respondWith(claudeMessage({ text: '{"dialogs":[', stopReason: "max_tokens" }));

    const single = await processTask(ctx, buildTask());
    expect(single.status).toBe("failed");

    const reduce = await processTask(
      ctx,
      buildTask({
        processingMode: "chunked",
        prompt_url: `s3://prompts/prompts/reduce/${TASK_ID}.json`,
        chunks: [buildChunk(0, "completed")],
      }),
    );
    expect(reduce.status).toBe("failed");

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(markChunkReadyMock).not.toHaveBeenCalled();
    expect(storeDataMock).not.toHaveBeenCalled();
    expect(markTaskSucceededMock).not.toHaveBeenCalled();
    expect(updateTaskForPromptMock).not.toHaveBeenCalled();
    expect(bumpRetryAttemptsMock).toHaveBeenCalledTimes(2);
  });
});

function buildChunk(index: number, status: ChunkItem["status"]): ChunkItem {
  return {
    id: `CHUNK#${index}`,
    prompt_key: `prompts/${TASK_ID}_${index}.json`,
    prompt_url: `s3://prompts/prompts/${TASK_ID}_${index}.json`,
    result_url: `s3://prompts/results/${TASK_ID}_${index}_result.json`,
    status,
  };
}

jest.mock("@llm/anthropicClient", () => ({
  AnthropicClient: jest.fn((options: unknown) => ({ provider: "anthropic", options })),
}));

jest.mock("@llm/geminiClient", () => ({
  GeminiClient: jest.fn((options: unknown) => ({ provider: "gemini", options })),
}));

import { CLAUDE_JSON_SYSTEM_INSTRUCTION, createLlmClient } from "./llmFactory";
import { FakeLlmClient } from "@llm/fakeLlmClient";
import { appConfig, type AppConfig } from "../config";
import type { TaskItem } from "../tasks/types";

/*
 * returns FakeLlmClient for fake and null for unknown providers
 * [Contract] task.llm "fake" keeps the echo FakeLlmClient; a missing or unknown task.llm returns null.
 * [Reason] Unknown providers are skipped by the task runner (with a warning), as before the migration.
 * [Accident] Without this, a typo in task.llm could silently call a paid API.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * builds a Claude client for anthropic tasks with the task's model and the JSON-only instruction
 * [Contract] With llmProvider=anthropic, an anthropic task gets an AnthropicClient with the config key/effort/timeout/output cap, task.llmModel and the Japanese JSON-only system instruction.
 * [Reason] Claude must answer with bare JSON (no preface, no code fences) because results are read with JSON.parse.
 * [Accident] Without this, a preface sentence would make every result unparsable.
 * [Odd] The client classes are mocked to capture constructor options.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * reroutes tasks prepared for the other provider to the active one
 * [Contract] A task tagged with the inactive provider runs on the active provider with the active model, and a warning is logged.
 * [Reason] Tasks prepared for Gemini before the switch must finish on Claude so the Gemini key can be revoked; rollback works the same way.
 * [Accident] Without this, in-flight tasks would keep calling the old provider (or fail once its key is gone).
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 */

const AnthropicClientMock = jest.requireMock("@llm/anthropicClient").AnthropicClient as jest.Mock;
const GeminiClientMock = jest.requireMock("@llm/geminiClient").GeminiClient as jest.Mock;

function buildTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    pk: "TASK-1",
    status: "pending",
    llm: "anthropic",
    llmModel: "claude-haiku-5-5",
    retryAttempts: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01",
    processingMode: "single_chunk",
    meeting: {
      issueID: "ISSUE-1",
      nameOfMeeting: "Test Meeting",
      nameOfHouse: "Test House",
      date: "2026-11-01",
      numberOfSpeeches: 1,
      session: 1,
    },
    attachedAssets: { speakerMetadataUrl: "s3://bucket/attachedAssets/TASK-1.json" },
    ...overrides,
  };
}

const anthropicConfig: AppConfig = {
  ...appConfig,
  llmProvider: "anthropic",
  anthropicApiKey: "test-anthropic-key",
  anthropicModel: "claude-haiku-5-5",
  anthropicEffort: "high",
  anthropicTimeoutMs: 1234,
  anthropicMaxOutputToken: 32000,
  geminiApiKey: "test-gemini-key",
  geminiModel: "gemini-3-flash-preview",
};

const geminiConfig: AppConfig = { ...anthropicConfig, llmProvider: "gemini" };

describe("createLlmClient", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns FakeLlmClient for fake and null for unknown providers", () => {
    expect(createLlmClient(buildTask({ llm: "fake" }), anthropicConfig)).toBeInstanceOf(FakeLlmClient);
    expect(createLlmClient(buildTask({ llm: undefined }), anthropicConfig)).toBeNull();
    expect(createLlmClient(buildTask({ llm: "openai" }), anthropicConfig)).toBeNull();
    expect(AnthropicClientMock).not.toHaveBeenCalled();
    expect(GeminiClientMock).not.toHaveBeenCalled();
  });

  it("builds a Claude client for anthropic tasks with the task's model and the JSON-only instruction", () => {
    createLlmClient(buildTask({ llm: "anthropic", llmModel: "claude-haiku-5-5-pinned" }), anthropicConfig);

    expect(AnthropicClientMock).toHaveBeenCalledTimes(1);
    expect(AnthropicClientMock).toHaveBeenCalledWith({
      apiKey: "test-anthropic-key",
      model: "claude-haiku-5-5-pinned",
      effort: "high",
      timeoutMs: 1234,
      defaultMaxOutputTokens: 32000,
      systemInstruction: CLAUDE_JSON_SYSTEM_INSTRUCTION,
    });
    expect(CLAUDE_JSON_SYSTEM_INSTRUCTION).toContain("JSON");
    expect(CLAUDE_JSON_SYSTEM_INSTRUCTION).toContain("コードフェンス");
    expect(GeminiClientMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    // A task without llmModel uses the active model.
    createLlmClient(buildTask({ llm: "anthropic", llmModel: undefined }), anthropicConfig);
    expect(AnthropicClientMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "claude-haiku-5-5" }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reroutes tasks prepared for Gemini to Claude with the active model and a warning", () => {
    createLlmClient(buildTask({ llm: "gemini", llmModel: "gemini-3-flash-preview" }), anthropicConfig);

    expect(GeminiClientMock).not.toHaveBeenCalled();
    expect(AnthropicClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-anthropic-key", model: "claude-haiku-5-5" }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[llmFactory] Task was prepared for another LLM provider; using the active provider",
      expect.objectContaining({ taskId: "TASK-1", taskLlm: "gemini", provider: "anthropic", model: "claude-haiku-5-5" }),
    );
  });

  it("with LLM_PROVIDER=gemini keeps Gemini tasks on their model and reroutes Claude tasks to Gemini", () => {
    createLlmClient(buildTask({ llm: "gemini", llmModel: "gemini-2.5-flash" }), geminiConfig);
    expect(GeminiClientMock).toHaveBeenLastCalledWith({ apiKey: "test-gemini-key", model: "gemini-2.5-flash" });
    expect(warnSpy).not.toHaveBeenCalled();

    createLlmClient(buildTask({ llm: "anthropic", llmModel: "claude-haiku-5-5" }), geminiConfig);
    expect(GeminiClientMock).toHaveBeenLastCalledWith({ apiKey: "test-gemini-key", model: "gemini-3-flash-preview" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(AnthropicClientMock).not.toHaveBeenCalled();
  });
});

const countTokensMock = jest.fn();
const googleGenAiCtorMock = jest.fn(() => ({
  models: {
    countTokens: countTokensMock,
  },
}));

jest.mock("@google/genai", () => ({
  GoogleGenAI: googleGenAiCtorMock,
}));

const anthropicCountTokensMock = jest.fn();
const anthropicCtorMock = jest.fn(() => ({
  messages: {
    countTokens: anthropicCountTokensMock,
  },
}));

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: anthropicCtorMock,
}));

import { countTokens } from "./tokenCounter";
import { appConfig, setAppEnvironment } from "../config";

/*
 * counts tokens with Claude count_tokens and the generation model (default provider)
 * [Contract] With llmProvider=anthropic, countTokens calls messages.countTokens with the active Anthropic model and one user message, returns input_tokens, and reuses one SDK client per process.
 * [Reason] Chunk packing must use the tokenizer of the model that generates (Claude Haiku 5.5 counts differently from Gemini).
 * [Accident] Without this, chunks could be sized with another tokenizer and overflow the input budget.
 * [Odd] @anthropic-ai/sdk is mocked; no network.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * returns 0 for empty or whitespace-only text without calling the API
 * [Contract] Blank text returns 0 and makes no request.
 * [Reason] The API rejects empty text blocks with a 400, and speeches can format to an empty line.
 * [Accident] Without this, one empty speech would fail the whole task preparation.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * counts tokens using the configured model (gemini)
 * [Contract] With LLM_PROVIDER=gemini, countTokens keeps using Gemini countTokens with the configured Gemini model.
 * [Reason] LLM_PROVIDER=gemini is the rollback path and must behave as before.
 * [Accident] Without this, a rollback would still count with Claude and need its key.
 * [Odd] Pins the provider by rebuilding the config with LLM_PROVIDER=gemini.
 * [History] Pinned to gemini during the Gemini to Claude Haiku migration (2026-11).
 */

describe("countTokens", () => {
  beforeEach(() => {
    countTokensMock.mockReset();
    googleGenAiCtorMock.mockClear();
    anthropicCountTokensMock.mockReset();
    anthropicCtorMock.mockClear();
  });

  describe("with the anthropic provider (default)", () => {
    it("counts tokens with Claude count_tokens and the generation model", async () => {
      expect(appConfig.llmProvider).toBe("anthropic");
      anthropicCountTokensMock.mockResolvedValue({ input_tokens: 42 });

      const first = await countTokens("hello world");
      const second = await countTokens("もう一度");

      expect(anthropicCtorMock).toHaveBeenCalledTimes(1);
      expect(anthropicCtorMock).toHaveBeenCalledWith({ apiKey: appConfig.anthropicApiKey, maxRetries: 2 });
      expect(anthropicCountTokensMock).toHaveBeenNthCalledWith(1, {
        model: appConfig.anthropicModel,
        messages: [{ role: "user", content: "hello world" }],
      });
      expect(anthropicCountTokensMock).toHaveBeenNthCalledWith(2, {
        model: appConfig.anthropicModel,
        messages: [{ role: "user", content: "もう一度" }],
      });
      expect(first).toBe(42);
      expect(second).toBe(42);
      expect(countTokensMock).not.toHaveBeenCalled();
    });

    it("returns 0 for empty or whitespace-only text without calling the API", async () => {
      expect(await countTokens("")).toBe(0);
      expect(await countTokens("  \n\t ")).toBe(0);
      expect(anthropicCountTokensMock).not.toHaveBeenCalled();
    });
  });

  describe("with LLM_PROVIDER=gemini", () => {
    const originalProvider = process.env.LLM_PROVIDER;

    beforeAll(() => {
      process.env.LLM_PROVIDER = "gemini";
      setAppEnvironment(appConfig.environment);
    });

    afterAll(() => {
      if (originalProvider === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = originalProvider;
      }
      setAppEnvironment(appConfig.environment);
    });

    it("counts tokens using the configured model", async () => {
      countTokensMock.mockResolvedValue({ totalTokens: 42 });

      const total = await countTokens("hello world");

      expect(googleGenAiCtorMock).toHaveBeenCalledWith({ apiKey: appConfig.geminiApiKey });
      expect(countTokensMock).toHaveBeenCalledWith({
        model: appConfig.geminiModel,
        contents: [{ role: "user", parts: [{ text: "hello world" }] }],
      });
      expect(total).toBe(42);
      expect(anthropicCountTokensMock).not.toHaveBeenCalled();
    });
  });
});

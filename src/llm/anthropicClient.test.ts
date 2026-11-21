import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

import { AnthropicClient, createAnthropicSdk, type AnthropicMessagesClient } from "./anthropicClient";
import { LlmOutputTruncatedError, LlmRefusalError } from "./llmClient";
import { appConfig } from "../config";

/*
 * sends model, max_tokens, effort, system and stop_sequences, and never sampling params
 * [Contract] The request carries model, max_tokens=maxOutputTokens, output_config.effort, the system instruction plus system-role messages as top-level system, and stop_sequences; temperature/top_p/top_k/thinking are never sent (a one-time warning is logged instead).
 * [Reason] Claude Haiku 5.5 rejects sampling parameters with a 400 on API 2026-10-21, and effort is set explicitly.
 * [Accident] Without this, a caller passing temperature would make every request fail.
 * [Odd] Uses a fake SDK object so the exact params can be compared, and a fresh copy of the module so the once-per-process warning is counted no matter which test ran first.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * sends a response schema as output_config.format
 * [Contract] With request.responseSchema the request carries output_config { effort, format: { type: "json_schema", schema } }; without one it carries only effort.
 * [Reason] Structured outputs make Claude return exactly the JSON shape each recap step parses.
 * [Accident] Without this, Claude answered a reduce request in a sectioned single_chunk shape on stage (2026-11-21); the article could not be saved and the batch stopped after three failures.
 *
 * returns only the text blocks, joined and trimmed
 * [Contract] Thinking blocks are skipped; text blocks are concatenated without separators and trimmed.
 * [Reason] Adaptive thinking puts thinking blocks before the answer; the JSON answer must be read by block type.
 * [Accident] Without this, content[0] (a thinking block) would be read as the answer, or JSON split across blocks would break.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * throws on refusal, truncated output and empty text
 * [Contract] stop_reason refusal throws LlmRefusalError with the category; max_tokens and model_context_window_exceeded throw LlmOutputTruncatedError; an empty answer throws.
 * [Reason] Truncated JSON must never be stored as a result, and refusals need their category in the logs.
 * [Accident] Without this, a cut-off chunk result would be stored and marked completed, and the article would be published with placeholder dialogs for its speeches.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * rejects prefill and empty requests before calling the API
 * [Contract] The conversation must end with a user message and must not be empty.
 * [Reason] Claude Haiku 5.5 returns a 400 for assistant prefill.
 * [Accident] Without this, the failure would surface later as an opaque API error.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * real SDK over a fake fetch (no network)
 * [Contract] With the real @anthropic-ai/sdk the body on the wire has model/max_tokens/output_config/stream and no sampling params; SSE with thinking+text, refusal and max_tokens are handled; 400 surfaces as BadRequestError, 429 and 529 are retried twice by the SDK client from createAnthropicSdk.
 * [Reason] Proves the integration with the SDK's streaming and error classes without an API key.
 * [Accident] Without this, a mismatch with the SDK (event accumulation, error classes, retries) would only show up in production.
 * [Odd] retry-after-ms=1 keeps SDK retries instant.
 * [History] Gemini to Claude Haiku migration (2026-11).
 */

type StreamFn = AnthropicMessagesClient["messages"]["stream"];

function buildMessage(overrides: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: '{"ok":true}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 340,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens_details: { thinking_tokens: 200 },
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function createFakeSdk(message: Anthropic.Message | Error) {
  const finalMessage = jest.fn(async () => {
    if (message instanceof Error) throw message;
    return message;
  });
  const stream = jest.fn((_params: Anthropic.MessageStreamParams, _options?: Anthropic.RequestOptions) => ({
    finalMessage,
  }));
  const client: AnthropicMessagesClient = { messages: { stream: stream as unknown as StreamFn } };
  return { client, stream };
}

/**
 * AnthropicClient from a fresh copy of its module. The sampling-parameter warning is logged once
 * per process (module state), so a test that counts it must not depend on which test ran first.
 */
function loadIsolatedAnthropicClient(): typeof AnthropicClient {
  let isolated: typeof AnthropicClient | undefined;
  jest.isolateModules(() => {
    isolated = (require("./anthropicClient") as typeof import("./anthropicClient")).AnthropicClient;
  });
  if (!isolated) throw new Error("anthropicClient module did not load");
  return isolated;
}

describe("AnthropicClient", () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends model, max_tokens, effort, system and stop_sequences, and never sampling params", async () => {
    const { client, stream } = createFakeSdk(buildMessage());
    const IsolatedAnthropicClient = loadIsolatedAnthropicClient();
    const llm = new IsolatedAnthropicClient({
      client,
      model: "claude-haiku-5-5",
      effort: "high",
      timeoutMs: 120000,
      systemInstruction: "JSON only.",
    });

    await llm.generate({
      messages: [
        { role: "system", content: "Extra system rule." },
        { role: "user", content: "Summarize." },
      ],
      maxOutputTokens: 64000,
      temperature: 0.2,
      topP: 0.9,
      topK: 5,
      stopSequences: ["END"],
    });
    await llm.generate({
      messages: [{ role: "user", content: "Again." }],
      maxOutputTokens: 100,
      temperature: 0.5,
    });

    expect(stream).toHaveBeenCalledTimes(2);
    const [params, options] = stream.mock.calls[0];
    expect(params).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 64000,
      messages: [{ role: "user", content: "Summarize." }],
      output_config: { effort: "high" },
      system: "JSON only.\n\nExtra system rule.",
      stop_sequences: ["END"],
    });
    for (const forbidden of ["temperature", "top_p", "top_k", "thinking"]) {
      expect(params).not.toHaveProperty(forbidden);
    }
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(stream.mock.calls[1][0]).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "Again." }],
      output_config: { effort: "high" },
      system: "JSON only.",
    });
    // Warned once, not per call.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("temperature/topP/topK");
  });

  it("sends a response schema as output_config.format", async () => {
    const { client, stream } = createFakeSdk(buildMessage());
    const llm = new AnthropicClient({ client });
    const schema = {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    };

    await llm.generate({ messages: [{ role: "user", content: "Hi" }], responseSchema: schema });

    expect(stream.mock.calls[0][0].output_config).toEqual({
      effort: appConfig.anthropicEffort,
      format: { type: "json_schema", schema },
    });
  });

  it("uses the config defaults when options and maxOutputTokens are omitted", async () => {
    const { client, stream } = createFakeSdk(buildMessage());
    const llm = new AnthropicClient({ client });

    await llm.generate({ messages: [{ role: "user", content: "Hi" }] });

    expect(stream.mock.calls[0][0]).toEqual({
      model: appConfig.anthropicModel,
      max_tokens: appConfig.anthropicMaxOutputToken,
      messages: [{ role: "user", content: "Hi" }],
      output_config: { effort: appConfig.anthropicEffort },
    });
  });

  it("returns only the text blocks, joined and trimmed, and logs id, usage and stop_reason", async () => {
    const message = buildMessage({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: '\n {"dialogs":', citations: null },
        { type: "text", text: '[{"order":1}]} \n', citations: null },
      ],
    });
    const { client } = createFakeSdk(message);
    const llm = new AnthropicClient({ client });

    const result = await llm.generate({ messages: [{ role: "user", content: "Hi" }], maxOutputTokens: 1000 });

    expect(result.text).toBe('{"dialogs":[{"order":1}]}');
    expect(JSON.parse(result.text)).toEqual({ dialogs: [{ order: 1 }] });
    expect(result.raw).toBe(message);
    expect(logSpy).toHaveBeenCalledWith("[AnthropicClient] response", {
      id: "msg_test",
      model: "claude-haiku-5-5",
      stopReason: "end_turn",
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        thinkingTokens: 200,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
  });

  it("throws on refusal, truncated output and empty text", async () => {
    const refusal = createFakeSdk(
      buildMessage({
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "general_harms", explanation: "declined" },
      }),
    );
    const refusalError = await new AnthropicClient({ client: refusal.client })
      .generate({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 10 })
      .catch((error: unknown) => error);
    expect(refusalError).toBeInstanceOf(LlmRefusalError);
    expect(refusalError).toMatchObject({ category: "general_harms", explanation: "declined", responseId: "msg_test" });
    expect((refusalError as Error).message).toContain("category=general_harms");

    for (const stopReason of ["max_tokens", "model_context_window_exceeded"]) {
      const truncated = createFakeSdk(
        buildMessage({ content: [{ type: "text", text: '{"dialogs":[', citations: null }], stop_reason: stopReason }),
      );
      const error = await new AnthropicClient({ client: truncated.client })
        .generate({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 8000 })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmOutputTruncatedError);
      expect(error).toMatchObject({ stopReason, maxOutputTokens: 8000 });
      // Treated as an output-side limit by the task runner (no remake with smaller chunks).
      expect((error as Error).message).toContain("output tokens");
    }

    const empty = createFakeSdk(buildMessage({ content: [{ type: "thinking", thinking: "", signature: "s" }] }));
    await expect(
      new AnthropicClient({ client: empty.client }).generate({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow("Claude returned an empty response");
  });

  it("rejects prefill and empty requests before calling the API", async () => {
    const { client, stream } = createFakeSdk(buildMessage());
    const llm = new AnthropicClient({ client });

    await expect(llm.generate({ messages: [] })).rejects.toThrow(
      "AnthropicClient.generate requires at least one message",
    );
    await expect(
      llm.generate({
        messages: [
          { role: "user", content: "Continue" },
          { role: "assistant", content: '{"partial":' },
        ],
      }),
    ).rejects.toThrow("assistant prefill is not supported");
    await expect(llm.generate({ messages: [{ role: "system", content: "only system" }] })).rejects.toThrow(
      "end with a user message",
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("rethrows SDK errors unchanged and logs status and requestID without the prompt or key", async () => {
    const apiError = new Anthropic.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
      undefined,
      new Headers({ "request-id": "req_rate" }),
    );
    const { client } = createFakeSdk(apiError);
    const llm = new AnthropicClient({ client, apiKey: "sk-test-never-logged" });

    const error = await llm
      .generate({ messages: [{ role: "user", content: "PROMPT-MARKER-should-not-be-logged" }] })
      .catch((caught: unknown) => caught);

    expect(error).toBe(apiError);
    expect(errorSpy).toHaveBeenCalledWith(
      "[AnthropicClient] messages.stream failed",
      expect.objectContaining({ name: "RateLimitError", status: 429, requestID: "req_rate" }),
    );
    const logged = JSON.stringify([...errorSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logged).not.toContain("PROMPT-MARKER");
    expect(logged).not.toContain("sk-test-never-logged");
  });

  it("requires an API key when no SDK client is injected", () => {
    expect(() => new AnthropicClient({ apiKey: "" })).toThrow("Anthropic API key is required in config");
    expect(createAnthropicSdk("test-key").maxRetries).toBe(2);
  });
});

describe("AnthropicClient with the real SDK over a fake fetch (no network)", () => {
  type FakeRequest = { url: string; body: Record<string, unknown> };

  function sse(events: Array<Record<string, unknown>>): string {
    return events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  }

  function streamResponse(args: {
    textParts: string[];
    stopReason: string;
    stopDetails?: Record<string, unknown> | null;
    thinking?: boolean;
  }): Response {
    const events: Array<Record<string, unknown>> = [
      {
        type: "message_start",
        message: {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 120, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ];
    let index = 0;
    if (args.thinking) {
      events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } });
      events.push({ type: "content_block_stop", index });
      index += 1;
    }
    if (args.textParts.length > 0) {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const part of args.textParts) {
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: part } });
      }
      events.push({ type: "content_block_stop", index });
    }
    events.push({
      type: "message_delta",
      delta: { stop_reason: args.stopReason, stop_sequence: null, stop_details: args.stopDetails ?? null },
      usage: { output_tokens: 42 },
    });
    events.push({ type: "message_stop" });
    return new Response(sse(events), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": "req_stream" },
    });
  }

  function errorResponse(status: number, type: string, message: string, requestId: string): Response {
    return new Response(JSON.stringify({ type: "error", error: { type, message }, request_id: requestId }), {
      status,
      headers: { "content-type": "application/json", "request-id": requestId, "retry-after-ms": "1" },
    });
  }

  function createFakeFetch(responses: Array<() => Response>) {
    const requests: FakeRequest[] = [];
    const fetchImpl = async (input: unknown, init?: { body?: unknown }) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      const next = responses.shift();
      if (!next) throw new Error("fake fetch: unexpected request");
      return next();
    };
    return { fetch: fetchImpl as unknown as ClientOptions["fetch"], requests };
  }

  function createLlm(responses: Array<() => Response>) {
    const fake = createFakeFetch(responses);
    const llm = new AnthropicClient({
      client: createAnthropicSdk("sk-test-fake-key", { fetch: fake.fetch }),
      model: "claude-haiku-5-5",
      effort: "medium",
      timeoutMs: 60000,
      systemInstruction: "JSON only.",
    });
    return { llm, requests: fake.requests };
  }

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("streams thinking + text and sends the expected body", async () => {
    const { llm, requests } = createLlm([
      () => streamResponse({ thinking: true, textParts: ['{"ok":', "true}"], stopReason: "end_turn" }),
    ]);

    const result = await llm.generate({
      messages: [{ role: "user", content: "Summarize." }],
      maxOutputTokens: 64000,
      temperature: 0,
    });

    expect(result.text).toBe('{"ok":true}');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/v1\/messages$/);
    expect(requests[0].body).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 64000,
      messages: [{ role: "user", content: "Summarize." }],
      output_config: { effort: "medium" },
      system: "JSON only.",
      stream: true,
    });
  });

  it("maps refusal and max_tokens from the stream to errors", async () => {
    const { llm } = createLlm([
      () =>
        streamResponse({
          textParts: [],
          stopReason: "refusal",
          stopDetails: { type: "refusal", category: "cyber", explanation: null },
        }),
      () => streamResponse({ thinking: true, textParts: ['{"dialogs":['], stopReason: "max_tokens" }),
    ]);

    const refusal = await llm.generate({ messages: [{ role: "user", content: "x" }] }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(LlmRefusalError);
    expect(refusal).toMatchObject({ category: "cyber", responseId: "msg_fake" });

    const truncated = await llm
      .generate({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 500 })
      .catch((e: unknown) => e);
    expect(truncated).toBeInstanceOf(LlmOutputTruncatedError);
    expect(truncated).toMatchObject({ stopReason: "max_tokens", maxOutputTokens: 500 });
  });

  it("surfaces a 400 as Anthropic.BadRequestError without retrying", async () => {
    const { llm, requests } = createLlm([
      () => errorResponse(400, "invalid_request_error", "prompt is too long: 1200000 tokens > 1000000 maximum", "req_400"),
    ]);

    const error = await llm.generate({ messages: [{ role: "user", content: "x" }] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Anthropic.BadRequestError);
    expect(error).toMatchObject({ status: 400, requestID: "req_400" });
    expect((error as Error).message).toContain("prompt is too long");
    expect(requests).toHaveLength(1);
  });

  it("retries 429 twice and then surfaces Anthropic.RateLimitError", async () => {
    const rateLimited = () => errorResponse(429, "rate_limit_error", "rate limited", "req_429");
    const { llm, requests } = createLlm([rateLimited, rateLimited, rateLimited]);

    const error = await llm.generate({ messages: [{ role: "user", content: "x" }] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Anthropic.RateLimitError);
    expect(error).toMatchObject({ status: 429, requestID: "req_429" });
    expect(requests).toHaveLength(3);
    const logged = JSON.stringify((console.error as jest.Mock).mock.calls);
    expect(logged).toContain("req_429");
    expect(logged).not.toContain("sk-test-fake-key");
  });

  it("retries a 529 overload and returns the retried answer", async () => {
    const { llm, requests } = createLlm([
      () => errorResponse(529, "overloaded_error", "Overloaded", "req_529"),
      () => streamResponse({ textParts: ['{"ok":1}'], stopReason: "end_turn" }),
    ]);

    const result = await llm.generate({ messages: [{ role: "user", content: "x" }] });

    expect(result.text).toBe('{"ok":1}');
    expect(requests).toHaveLength(2);
  });
});

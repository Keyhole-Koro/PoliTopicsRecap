import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

import {
  LlmOutputTruncatedError,
  LlmRefusalError,
  type LlmClient,
  type LlmGenerateRequest,
  type LlmGenerateResponse,
  type LlmMessage,
} from "./llmClient";
import { appConfig, type AnthropicEffort } from "../config";

const PROVIDER_NAME = "Claude";
const MAX_RETRIES = 2;

/**
 * The part of the SDK client that AnthropicClient uses. A real `Anthropic` instance satisfies
 * it; tests can pass a small fake instead.
 */
export interface AnthropicMessagesClient {
  messages: {
    stream(
      params: Anthropic.MessageStreamParams,
      options?: Anthropic.RequestOptions,
    ): { finalMessage(): Promise<Anthropic.Message> };
  };
}

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  effort?: AnthropicEffort;
  /** Total time for one generate() call, retries included. 0 or less disables it. */
  timeoutMs?: number;
  /** Used when a request does not set maxOutputTokens. */
  defaultMaxOutputTokens?: number;
  /** Sent as the top-level system prompt, before any system-role messages. */
  systemInstruction?: string;
  /** Pre-built SDK client (tests). When set, apiKey is not needed. */
  client?: AnthropicMessagesClient;
}

let warnedAboutSamplingParams = false;

/**
 * Builds the SDK client used for generation and token counting (2 retries with backoff for
 * 408/409/429/5xx and connection errors). `fetch` is only for tests.
 */
export function createAnthropicSdk(
  apiKey: string,
  options: { fetch?: ClientOptions["fetch"] } = {},
): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: MAX_RETRIES,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * LlmClient for Claude (default model: Claude Haiku 5.5).
 *
 * - Streams the response and waits for the final message: with large max_tokens the SDK
 *   refuses non-streaming requests, and long silent connections get cut by infrastructure.
 * - Sends output_config.effort explicitly. Adaptive thinking is the model default, so
 *   `thinking` is not sent. temperature/top_p/top_k are never sent (Claude Haiku 5.5 rejects
 *   them), and the conversation must end with a user turn (prefill is rejected too).
 * - Returns only the text blocks (thinking blocks come first and are skipped).
 * - Throws LlmRefusalError on a refusal and LlmOutputTruncatedError when the output was cut off,
 *   so incomplete JSON is never stored. SDK errors are rethrown unchanged.
 */
export class AnthropicClient implements LlmClient {
  private readonly client: AnthropicMessagesClient;
  private readonly model: string;
  private readonly effort: AnthropicEffort;
  private readonly timeoutMs: number;
  private readonly defaultMaxOutputTokens: number;
  private readonly systemInstruction?: string;

  constructor(options: AnthropicClientOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey ?? appConfig.anthropicApiKey;
      if (!apiKey) {
        throw new Error("Anthropic API key is required in config");
      }
      this.client = createAnthropicSdk(apiKey);
    }
    this.model = options.model ?? appConfig.anthropicModel;
    this.effort = options.effort ?? appConfig.anthropicEffort;
    this.timeoutMs = options.timeoutMs ?? appConfig.anthropicTimeoutMs;
    this.defaultMaxOutputTokens = options.defaultMaxOutputTokens ?? appConfig.anthropicMaxOutputToken;
    this.systemInstruction = options.systemInstruction;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    if (request.messages.length === 0) {
      throw new Error("AnthropicClient.generate requires at least one message");
    }
    warnIfSamplingParams(request);

    const maxTokens = request.maxOutputTokens ?? this.defaultMaxOutputTokens;
    const params = buildMessageParams({
      messages: request.messages,
      model: this.model,
      maxTokens,
      effort: this.effort,
      systemInstruction: this.systemInstruction,
      stopSequences: request.stopSequences,
    });

    // The SDK's own timeout only covers the wait for response headers; this signal bounds the
    // whole streamed call, retries included.
    const signal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.stream(params, signal ? { signal } : undefined).finalMessage();
    } catch (error) {
      logAnthropicError(error, {
        model: this.model,
        timeoutMs: this.timeoutMs,
        timedOut: signal?.aborted ?? false,
      });
      throw error;
    }

    logAnthropicResponse(message);

    if (message.stop_reason === "refusal") {
      throw new LlmRefusalError({
        provider: PROVIDER_NAME,
        category: message.stop_details?.category ?? null,
        explanation: message.stop_details?.explanation ?? null,
        responseId: message.id,
      });
    }
    if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
      throw new LlmOutputTruncatedError({
        provider: PROVIDER_NAME,
        stopReason: message.stop_reason,
        maxOutputTokens: maxTokens,
        responseId: message.id,
      });
    }

    const text = extractText(message);
    if (!text) {
      throw new Error(`Claude returned an empty response (id=${message.id}, stop_reason=${message.stop_reason})`);
    }
    return { text, raw: message };
  }
}

type BuildMessageParamsArgs = {
  messages: LlmMessage[];
  model: string;
  maxTokens: number;
  effort: AnthropicEffort;
  systemInstruction?: string;
  stopSequences?: string[];
};

function buildMessageParams(args: BuildMessageParamsArgs): Anthropic.MessageStreamParams {
  const systemParts: string[] = [];
  if (args.systemInstruction) systemParts.push(args.systemInstruction);
  const conversation: Anthropic.MessageParam[] = [];
  for (const message of args.messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    } else if (message.role === "user" || message.role === "assistant") {
      conversation.push({ role: message.role, content: message.content });
    } else {
      throw new Error(`Unsupported message role for AnthropicClient: ${String(message.role)}`);
    }
  }

  const last = conversation[conversation.length - 1];
  if (!last || last.role !== "user") {
    throw new Error(
      "AnthropicClient.generate requires the conversation to end with a user message (assistant prefill is not supported)",
    );
  }

  const system = systemParts.filter((part) => part.trim() !== "").join("\n\n");
  return {
    model: args.model,
    max_tokens: args.maxTokens,
    messages: conversation,
    output_config: { effort: args.effort },
    ...(system ? { system } : {}),
    ...(args.stopSequences && args.stopSequences.length > 0 ? { stop_sequences: args.stopSequences } : {}),
  };
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function warnIfSamplingParams(request: LlmGenerateRequest): void {
  if (warnedAboutSamplingParams) return;
  if (request.temperature === undefined && request.topP === undefined && request.topK === undefined) return;
  warnedAboutSamplingParams = true;
  console.warn(
    "[AnthropicClient] temperature/topP/topK are not supported by Claude Haiku 5.5 and are ignored",
  );
}

function logAnthropicResponse(message: Anthropic.Message): void {
  const usage = message.usage;
  console.log("[AnthropicClient] response", {
    id: message.id,
    model: message.model,
    stopReason: message.stop_reason,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? null,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? null,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? null,
    },
  });
}

function logAnthropicError(
  error: unknown,
  context: { model: string; timeoutMs: number; timedOut: boolean },
): void {
  // Selected fields only: never the API key, the request body or the prompt.
  if (error instanceof Anthropic.APIError) {
    console.error("[AnthropicClient] messages.stream failed", {
      name: error.name,
      status: error.status,
      requestID: error.requestID,
      errorType: error.type,
      errorCode: error.errorCode,
      message: error.message,
      model: context.model,
    });
  } else {
    console.error("[AnthropicClient] messages.stream failed", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      model: context.model,
    });
  }
  if (context.timedOut) {
    console.error(
      "[AnthropicClient] request aborted by the client timeout; if failures repeat around a fixed duration, infra egress/idle timeouts are likely",
      { model: context.model, timeoutMs: context.timeoutMs },
    );
  }
}

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface LlmGenerateRequest extends LlmGenerationOptions {
  messages: LlmMessage[];
}

export interface LlmGenerateResponse {
  text: string;
  raw?: unknown;
}

export interface LlmClient {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

/**
 * The provider declined to answer (for Claude: `stop_reason: "refusal"` from a safety
 * classifier). The response has no usable text; retrying the same prompt usually fails again.
 */
export class LlmRefusalError extends Error {
  readonly provider: string;
  /** Provider-specific refusal category (Claude: `stop_details.category`), or null. */
  readonly category: string | null;
  readonly explanation: string | null;
  readonly responseId?: string;

  constructor(args: {
    provider: string;
    category: string | null;
    explanation?: string | null;
    responseId?: string;
  }) {
    super(
      `${args.provider} declined the request (stop_reason=refusal, category=${args.category ?? "none"})`,
    );
    this.name = "LlmRefusalError";
    this.provider = args.provider;
    this.category = args.category;
    this.explanation = args.explanation ?? null;
    this.responseId = args.responseId;
  }
}

/**
 * The response stopped before it was complete (for Claude: `stop_reason` "max_tokens" or
 * "model_context_window_exceeded"). The partial text is discarded so truncated JSON is never
 * stored as a result.
 *
 * The message deliberately says "output tokens": the task runner treats errors that mention
 * "output tokens" as output-side limits, so they do not trigger a remake with smaller chunks.
 */
export class LlmOutputTruncatedError extends Error {
  readonly provider: string;
  readonly stopReason: string;
  readonly maxOutputTokens: number;
  readonly responseId?: string;

  constructor(args: {
    provider: string;
    stopReason: string;
    maxOutputTokens: number;
    responseId?: string;
  }) {
    super(
      `${args.provider} response was cut off before it finished (stop_reason=${args.stopReason}, max output tokens=${args.maxOutputTokens}); the partial output was discarded`,
    );
    this.name = "LlmOutputTruncatedError";
    this.provider = args.provider;
    this.stopReason = args.stopReason;
    this.maxOutputTokens = args.maxOutputTokens;
    this.responseId = args.responseId;
  }
}

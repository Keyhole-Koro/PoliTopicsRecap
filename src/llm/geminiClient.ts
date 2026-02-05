import { GoogleGenAI } from "@google/genai";

import type {
  LlmClient,
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmMessage,
} from './llmClient';
import { appConfig } from "../config";

type Content = {
  role: "user" | "system";
  parts: { text: string }[];
};

type GenerateContentConfig = {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  httpOptions?: {
    timeout?: number;
  };
};

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  defaultGenerationConfig?: Partial<GenerateContentConfig>;
  systemInstruction?: string;
}

export class GeminiClient implements LlmClient {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly fallbackModel?: string;
  private readonly defaultGenerationConfig?: Partial<GenerateContentConfig>;
  private readonly systemInstruction?: string;
  private readonly timeoutMs?: number;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey = options.apiKey ?? appConfig.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is required in config');
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.model = options.model ?? "gemini-2.5-pro";
    this.fallbackModel = appConfig.geminiFallbackModel;
    this.systemInstruction = options.systemInstruction;
    this.defaultGenerationConfig = options.defaultGenerationConfig;
    this.timeoutMs = appConfig.geminiTimeoutMs;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    if (request.messages.length === 0) {
      throw new Error('GeminiClient.generate requires at least one message');
    }

    const contents = request.messages.map(transformMessageToContent);

    const generationConfig = buildGenerationConfig(
      this.defaultGenerationConfig,
      request,
      this.systemInstruction,
    );

    const requestConfig = applyHttpOptions(generationConfig, this.timeoutMs);

    let result: { text?: string } | undefined;
    try {
      result = await this.ai.models.generateContent({
        model: this.model,
        contents,
        ...(requestConfig ? { config: requestConfig } : {}),
      });
    } catch (error) {
      logGeminiError(error, this.model, this.timeoutMs);
      if (shouldFallback(this.fallbackModel, this.model)) {
        const fallbackModel = this.fallbackModel as string;
        console.warn("[GeminiClient] Retrying with fallback model", {
          from: this.model,
          to: fallbackModel,
        });
        try {
          result = await this.ai.models.generateContent({
            model: fallbackModel,
            contents,
            ...(requestConfig ? { config: requestConfig } : {}),
          });
        } catch (fallbackError) {
          logGeminiError(fallbackError, fallbackModel, this.timeoutMs);
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }
    const text = typeof result?.text === "string" ? result.text.trim() : undefined;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }

    return {
      text,
      raw: result,
    };
  }
}

function transformMessageToContent(message: LlmMessage): Content {
  if (message.role != 'user' && message.role != 'system') {
    throw new Error(`Unsupported message role for GeminiClient: ${message.role}`);
  }
  
  return {
    role: message.role,
    parts: [{ text: message.content }],
  };
}

function applyHttpOptions(
  config: GenerateContentConfig | undefined,
  timeoutMs?: number,
): GenerateContentConfig | undefined {
  if (!timeoutMs || timeoutMs <= 0) return config;
  const base = config ?? {};
  return {
    ...base,
    httpOptions: {
      ...(base.httpOptions ?? {}),
      timeout: timeoutMs,
    },
  };
}

function shouldFallback(fallbackModel: string | undefined, primaryModel: string): boolean {
  return Boolean(fallbackModel && fallbackModel.trim() !== "" && fallbackModel !== primaryModel);
}

function isFetchFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: string }).message;
  return typeof message === "string" && message.includes("fetch failed");
}

function logGeminiError(error: unknown, model: string, timeoutMs?: number): void {
  const err = error as { cause?: unknown };
  console.error("[GeminiClient] generateContent failed", error);
  if (isFetchFailed(error)) {
    console.error(
      "[GeminiClient] fetch failed; if failures repeat around a fixed duration, infra egress/idle timeouts are likely",
      { model, timeoutMs },
    );
  }
  if (err?.cause) {
    console.error("[GeminiClient] cause:", err.cause);
  }
  if (err?.cause instanceof Error && err.cause.stack) {
    console.error("[GeminiClient] cause stack:", err.cause.stack);
  }
}

function buildGenerationConfig(
  defaults: Partial<GenerateContentConfig> | undefined,
  request: LlmGenerateRequest,
  systemInstruction?: string,
): GenerateContentConfig | undefined {
  const merged: Partial<GenerateContentConfig> = {
    ...defaults,
    ...(systemInstruction ? { systemInstruction } : {}),
  };

  const overrides: Partial<GenerateContentConfig> = {
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    topP: request.topP,
    topK: request.topK,
    stopSequences: request.stopSequences,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  const sanitizedEntries = Object.entries(merged).filter(([, value]) => value !== undefined);
  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries) as GenerateContentConfig;
}

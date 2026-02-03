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
  private readonly defaultGenerationConfig?: Partial<GenerateContentConfig>;
  private readonly systemInstruction?: string;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey = options.apiKey ?? appConfig.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is required in config');
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.model = options.model ?? "gemini-2.5-pro";
    this.systemInstruction = options.systemInstruction;
    this.defaultGenerationConfig = options.defaultGenerationConfig;
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

    const payload = generationConfig
      ? { model: this.model, contents, config: generationConfig }
      : { model: this.model, contents };

    let result: { text?: string } | undefined;
    try {
      result = await this.ai.models.generateContent(payload);
    } catch (error) {
      const err = error as { cause?: unknown };
      console.error("[GeminiClient] generateContent failed", error);
      if (err?.cause) {
        console.error("[GeminiClient] cause:", err.cause);
      }
      if (err?.cause instanceof Error && err.cause.stack) {
        console.error("[GeminiClient] cause stack:", err.cause.stack);
      }
      throw error;
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

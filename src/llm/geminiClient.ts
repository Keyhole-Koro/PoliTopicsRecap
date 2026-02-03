import {
  GoogleGenerativeAI,
  type Content,
  type GenerationConfig,
  type GenerateContentRequest,
  type GenerativeModel,
} from '@google/generative-ai';

import type {
  LlmClient,
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmMessage,
} from './llmClient';
import { appConfig } from "../config";

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  defaultGenerationConfig?: Partial<GenerationConfig>;
  systemInstruction?: string;
}

export class GeminiClient implements LlmClient {
  private readonly model: GenerativeModel;
  private readonly defaultGenerationConfig?: Partial<GenerationConfig>;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey = options.apiKey ?? appConfig.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is required in config');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    this.defaultGenerationConfig = options.defaultGenerationConfig;
    this.model = genAI.getGenerativeModel({
      model: options.model ?? 'gemini-2.5-pro',
      systemInstruction: options.systemInstruction,
    });
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    if (request.messages.length === 0) {
      throw new Error('GeminiClient.generate requires at least one message');
    }

    const contents = request.messages.map(transformMessageToContent);

    const generationConfig = buildGenerationConfig(
      this.defaultGenerationConfig,
      request,
    );

    const payload: GenerateContentRequest = generationConfig
      ? { contents, generationConfig }
      : { contents };

    let result;
    try {
      result = await this.model.generateContent(payload);
    } catch (error) {
      const err = error as { cause?: unknown };
      console.error("[GeminiClient] generateContent failed", error);
      if (err?.cause) {
        console.error("[GeminiClient] cause:", err.cause);
      }
      throw error;
    }
    const text = result.response?.text()?.trim();
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
  defaults: Partial<GenerationConfig> | undefined,
  request: LlmGenerateRequest,
): GenerationConfig | undefined {
  const merged: Partial<GenerationConfig> = {
    ...defaults,
  };

  const overrides: Partial<GenerationConfig> = {
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

  return Object.fromEntries(sanitizedEntries) as GenerationConfig;
}

import { GoogleGenAI } from "@google/genai";
import type Anthropic from "@anthropic-ai/sdk";
import { appConfig } from "../config";
import { createAnthropicSdk } from "./anthropicClient";

let cachedClient: GoogleGenAI | null = null;
let cachedAnthropicClient: Anthropic | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = appConfig.geminiApiKey;
  if (!apiKey) {
    throw new Error("Gemini API key is required in config");
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

function getAnthropicClient(): Anthropic {
  if (cachedAnthropicClient) return cachedAnthropicClient;
  const apiKey = appConfig.anthropicApiKey;
  if (!apiKey) {
    throw new Error("Anthropic API key is required in config");
  }
  cachedAnthropicClient = createAnthropicSdk(apiKey);
  return cachedAnthropicClient;
}

/**
 * Counts the tokens of `text` with the active provider's tokenizer (config.llmProvider).
 * Claude counts come from the count_tokens endpoint with the generation model; they are
 * estimates that can run a few tokens high, which only makes chunks slightly smaller.
 */
export async function countTokens(text: string): Promise<number> {
  if (appConfig.llmProvider === "gemini") {
    return countGeminiTokens(text);
  }
  return countAnthropicTokens(text);
}

async function countGeminiTokens(text: string): Promise<number> {
  const client = getClient();
  const response = await client.models.countTokens({
    model: appConfig.geminiModel,
    contents: [{ role: "user", parts: [{ text }] }],
  });
  return response.totalTokens ?? 0;
}

async function countAnthropicTokens(text: string): Promise<number> {
  // The API rejects empty (or whitespace-only) text blocks; such text has no tokens anyway.
  if (text.trim() === "") return 0;
  const client = getAnthropicClient();
  const response = await client.messages.countTokens({
    model: appConfig.anthropicModel,
    messages: [{ role: "user", content: text }],
  });
  return response.input_tokens;
}

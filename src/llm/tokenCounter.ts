import { GoogleGenAI } from "@google/genai";
import { appConfig } from "../config";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = appConfig.geminiApiKey;
  if (!apiKey) {
    throw new Error("Gemini API key is required in config");
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export async function countTokens(text: string): Promise<number> {
  const client = getClient();
  const response = await client.models.countTokens({
    model: appConfig.geminiModel,
    contents: [{ role: "user", parts: [{ text }] }],
  });
  return response.totalTokens ?? 0;
}

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { appConfig } from "../config";

let cachedModel: GenerativeModel | null = null;

function getModel(): GenerativeModel {
  if (cachedModel) return cachedModel;
  const apiKey = appConfig.geminiApiKey;
  if (!apiKey) {
    throw new Error("Gemini API key is required in config");
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  cachedModel = genAI.getGenerativeModel({ model: appConfig.geminiModel });
  return cachedModel;
}

export async function countTokens(text: string): Promise<number> {
  const model = getModel();
  const response = await model.countTokens({
    contents: [{ role: "user", parts: [{ text }] }],
  });
  return response.totalTokens ?? 0;
}

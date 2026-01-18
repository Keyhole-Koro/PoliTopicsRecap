import { GeminiClient } from "@llm/geminiClient";
import { FakeLlmClient } from "@llm/fakeLlmClient";
import type { LlmClient } from "@llm/llmClient";
import type { TaskItem } from "../tasks/types";

export function createLlmClient(task: TaskItem, apiKey: string): LlmClient | null {
  if (task.llm === "gemini") {
    return new GeminiClient({ apiKey, model: task.llmModel });
  }
  if (task.llm === "fake") {
    return new FakeLlmClient({ mode: "echo" });
  }
  return null;
}

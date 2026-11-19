import { AnthropicClient } from "@llm/anthropicClient";
import { GeminiClient } from "@llm/geminiClient";
import { FakeLlmClient } from "@llm/fakeLlmClient";
import type { LlmClient } from "@llm/llmClient";
import { getActiveLlmSettings, type ActiveLlmSettings, type AppConfig } from "../config";
import type { TaskItem } from "../tasks/types";

/**
 * Claude-only system instruction. Every output is read with JSON.parse, so ask for the bare
 * JSON object. The shared prompts and PROMPT_VERSION stay unchanged (a major version bump
 * would requeue every completed task).
 */
export const CLAUDE_JSON_SYSTEM_INSTRUCTION =
  "あなたの出力はプログラムが JSON.parse でそのまま読み込みます。指示された形式の JSON オブジェクトだけを出力し、前置き・説明・後書き・コードフェンス（```）は付けないでください。";

/**
 * Builds the LLM client for a task.
 *
 * - "fake" keeps the echo FakeLlmClient; unknown values return null (the task is skipped).
 * - "anthropic" and "gemini" both go to the active provider (config.llmProvider), so tasks
 *   prepared before a provider switch finish on the new provider. task.llmModel is used only
 *   when the task was prepared for the active provider.
 */
export function createLlmClient(task: TaskItem, config: AppConfig): LlmClient | null {
  if (task.llm === "fake") {
    return new FakeLlmClient({ mode: "echo" });
  }
  if (task.llm !== "anthropic" && task.llm !== "gemini") {
    return null;
  }

  const active = getActiveLlmSettings(config);
  const model = resolveModel(task, active);
  if (active.provider === "gemini") {
    return new GeminiClient({ apiKey: config.geminiApiKey, model });
  }
  return new AnthropicClient({
    apiKey: config.anthropicApiKey,
    model,
    effort: config.anthropicEffort,
    timeoutMs: config.anthropicTimeoutMs,
    defaultMaxOutputTokens: config.anthropicMaxOutputToken,
    systemInstruction: CLAUDE_JSON_SYSTEM_INSTRUCTION,
  });
}

function resolveModel(task: TaskItem, active: ActiveLlmSettings): string {
  if (task.llm === active.provider) {
    return task.llmModel || active.model;
  }
  console.warn("[llmFactory] Task was prepared for another LLM provider; using the active provider", {
    taskId: task.pk,
    taskLlm: task.llm,
    taskLlmModel: task.llmModel,
    provider: active.provider,
    model: active.model,
  });
  return active.model;
}

import type Anthropic from "@anthropic-ai/sdk";

import { AnthropicClient, createAnthropicSdk } from "./anthropicClient";
import { appConfig } from "../config";
import { CLAUDE_JSON_SYSTEM_INSTRUCTION } from "../processor/llmFactory";
import { single_chunk_prompt } from "../prompts/prompts";
import { buildSpeechInput, stripCodeFence } from "../prompts/promptInput";

/*
 * Opt-in smoke test against the real Claude API (costs a few cents at most).
 * Runs only when RUN_ANTHROPIC_SMOKE_TEST=true and ANTHROPIC_API_KEY are both set, so the
 * dummy keys used in CI never trigger it. Read the key with `read -rs` rather than typing it
 * into the command, which would leave it in the shell history:
 *
 *   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
 *   RUN_ANTHROPIC_SMOKE_TEST=true APP_ENVIRONMENT=localstackTest ENABLE_NOTIFICATION=false \
 *     ./node_modules/.bin/jest --config jest.config.ts --runInBand \
 *     src/llm/anthropicClient.smoke.test.ts
 *   unset ANTHROPIC_API_KEY
 *
 * Model and effort come from ANTHROPIC_MODEL / ANTHROPIC_EFFORT (defaults claude-haiku-5-5 / medium).
 *
 * answers a tiny JSON request with end_turn
 * [Contract] The key, model id and effort are accepted; the answer parses as JSON; stop_reason is end_turn; usage is reported.
 * [Reason] Lets the owner check the real API settings before deploying.
 * [Accident] Without this, a wrong model id or key would surface only in the batch.
 * [Odd] Reads ANTHROPIC_API_KEY directly because the test config always uses "dummy".
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * counts tokens with the configured model
 * [Contract] messages.countTokens accepts the configured model and returns a positive count.
 * [Reason] Chunk packing depends on count_tokens.
 * [Accident] Without this, task preparation could fail on the first meeting.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * returns parseable single_chunk JSON for a fictional two-speech meeting
 * [Contract] The real single_chunk prompt plus the JSON-only system instruction yields JSON that parses after stripCodeFence and has one dialog per input order.
 * [Reason] A preface sentence before the JSON would make every result unparsable.
 * [Accident] Without this, the switch could store nothing but failed payloads.
 * [Odd] Fictional speakers and text; no real meeting data is sent.
 * [History] Gemini to Claude Haiku migration (2026-11).
 */

const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
const shouldRun = process.env.RUN_ANTHROPIC_SMOKE_TEST === "true" && apiKey !== "";
const describeSmoke = shouldRun ? describe : describe.skip;

describeSmoke("Claude API smoke test (real API, opt-in)", () => {
  const sdk = shouldRun ? createAnthropicSdk(apiKey) : null;
  const buildClient = (timeoutMs: number) =>
    new AnthropicClient({
      client: sdk!,
      model: appConfig.anthropicModel,
      effort: appConfig.anthropicEffort,
      timeoutMs,
      systemInstruction: CLAUDE_JSON_SYSTEM_INSTRUCTION,
    });

  it("answers a tiny JSON request with end_turn", async () => {
    const result = await buildClient(120000).generate({
      messages: [
        {
          role: "user",
          content: '次の形式の JSON で答えてください: {"ok": true, "answer": <1 + 1 の答えの数値>}',
        },
      ],
      maxOutputTokens: 4000,
    });

    const parsed = JSON.parse(result.text);
    expect(parsed.ok).toBe(true);
    expect(Number(parsed.answer)).toBe(2);
    const message = result.raw as Anthropic.Message;
    expect(message.stop_reason).toBe("end_turn");
    expect(message.usage.input_tokens).toBeGreaterThan(0);
    expect(message.usage.output_tokens).toBeGreaterThan(0);
  }, 180000);

  it("counts tokens with the configured model", async () => {
    const response = await sdk!.messages.countTokens({
      model: appConfig.anthropicModel,
      messages: [{ role: "user", content: "[order 1] 架空太郎: 予算の執行状況について伺います。" }],
    });
    console.log("[smoke] count_tokens", { model: appConfig.anthropicModel, inputTokens: response.input_tokens });
    expect(response.input_tokens).toBeGreaterThan(0);
  }, 60000);

  it("returns parseable single_chunk JSON for a fictional two-speech meeting", async () => {
    const input = buildSpeechInput({
      taskId: "SMOKE-TASK-1",
      meeting: {
        issueID: "SMOKE-ISSUE-1",
        nameOfMeeting: "架空委員会",
        nameOfHouse: "架空院",
        date: "2026-11-01",
        numberOfSpeeches: 2,
        session: 1,
      },
      speeches: [
        {
          speechID: "SMOKE-1",
          speechOrder: 1,
          speaker: "架空太郎",
          speech: "公園の整備予算の執行状況について伺います。今年度中に工事は終わりますか。",
        },
        {
          speechID: "SMOKE-2",
          speechOrder: 2,
          speaker: "架空花子",
          speakerPosition: "架空大臣",
          speech: "予算は確保しており、工事は来年三月までに完了する予定です。",
        },
      ],
    });
    const prompt = `${single_chunk_prompt("")}\n${input}`;

    const result = await buildClient(300000).generate({
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: appConfig.anthropicMaxOutputToken,
    });

    console.log("[smoke] single_chunk", {
      startsWithBrace: result.text.startsWith("{"),
      chars: result.text.length,
      usage: (result.raw as Anthropic.Message).usage,
    });
    const parsed = JSON.parse(stripCodeFence(result.text));
    expect(parsed.summary).toBeTruthy();
    expect(parsed.soft_language_summary).toBeTruthy();
    const orders = (parsed.dialogs as Array<{ order: number }>).map((dialog) => dialog.order).sort();
    expect(orders).toEqual([1, 2]);
  }, 360000);
});

// src/llm/fakeLlmClient.ts
// ------------------------------------------------------------------------------------
// A lightweight, dependency-free fake LLM client for tests/dev.
// Implements the LlmClient interface and simulates generation behavior.
//
// Features:
//   - Modes: "echo", "canned", "template", "script"
//   - Respects maxOutputTokens (rough approximation) and stopSequences
//   - Optional artificial latency (delayMs)
//   - Deterministic by default; no randomness unless your script adds it
//
// Typical uses:
//   1) Echo the last user message:
//        new FakeLlmClient({ mode: "echo" })
//
//   2) Always return fixed text (canned):
//        new FakeLlmClient({ mode: "canned", cannedText: "Hello from fake LLM!" })
//
//   3) Simple templating with variables:
//        new FakeLlmClient({
//          mode: "template",
//          template:
//            "SYSTEM: {{system}}\nUSER: {{lastUser}}\nCONTEXT:\n{{transcript}}\n---\nAnswer: OK"
//        })
//
//   4) Fully custom logic via script (sync/async):
//        new FakeLlmClient({
//          mode: "script",
//          script: async (req) => `You said: ${getLastUser(req) ?? "(none)"}`
//        })
//
// Notes:
//   - This client treats "tokens" as whitespace-separated pieces only to simulate
//     maxOutputTokens; it does not replicate any specific tokenizer.
//   - The "raw" field returns simple metadata for observability.
// ------------------------------------------------------------------------------------

import type {
  LlmClient,
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmMessage,
} from "./llmClient";

export type FakeLlmMode = "echo" | "canned" | "template" | "script";

export interface FakeLlmClientOptions {
  /** Behavior mode (default: "echo"). */
  mode?: FakeLlmMode;

  /** Used when mode === "canned". */
  cannedText?: string;

  /** Used when mode === "template". See applyTemplate() for available variables. */
  template?: string;

  /**
   * Used when mode === "script".
   * Return a string; may be async. You can inspect request.messages/options.
   */
  script?: (request: LlmGenerateRequest) => string | Promise<string>;

  /**
   * Artificial latency in milliseconds to simulate network/compute time.
   * Default: 0 (no delay).
   */
  delayMs?: number;

  /**
   * When cutting on maxOutputTokens, we split by whitespace. This is only for
   * rough simulation and tests—not a real tokenizer. You usually don't need to change it.
   */
  tokenSplitter?: RegExp;

  /**
   * If provided, throw an error after this many generate() calls.
   * Useful for failure-path tests. Starts counting at 1.
   */
  failAfterCalls?: number;
}

export class FakeLlmClient implements LlmClient {
  private readonly mode: FakeLlmMode;
  private readonly cannedText?: string;
  private readonly template?: string;
  private readonly script?: (request: LlmGenerateRequest) => string | Promise<string>;
  private readonly delayMs: number;
  private readonly tokenSplitter: RegExp;
  private readonly failAfterCalls?: number;
  private callCount = 0;

  constructor(options: FakeLlmClientOptions = {}) {
    this.mode = options.mode ?? "echo";
    this.cannedText = options.cannedText;
    this.template = options.template;
    this.script = options.script;
    this.delayMs = options.delayMs ?? 0;
    this.tokenSplitter = options.tokenSplitter ?? /\s+/;
    this.failAfterCalls = options.failAfterCalls;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    if (!request?.messages?.length) {
      throw new Error("FakeLlmClient.generate requires at least one message");
    }

    // Optional failure injection for tests
    this.callCount += 1;
    if (this.failAfterCalls && this.callCount > this.failAfterCalls) {
      throw new Error(`FakeLlmClient forced failure: call #${this.callCount}`);
    }

    // Produce a base string according to the selected mode
    let base = await this.produceBaseText(request);

    // Apply stop sequences and max tokens like a real client would
    base = this.applyStopSequences(base, request.stopSequences);
    base = this.applyMaxOutputTokens(base, request.maxOutputTokens);

    // Optional artificial delay
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    return {
      text: base,
      raw: {
        mode: this.mode,
        callCount: this.callCount,
        appliedMaxOutputTokens: request.maxOutputTokens ?? null,
        appliedStopSequences: request.stopSequences ?? null,
        delayMs: this.delayMs,
      },
    };
  }

  // ----- Mode handlers --------------------------------------------------------

  private async produceBaseText(request: LlmGenerateRequest): Promise<string> {
    switch (this.mode) {
      case "echo":
        return this.echoMode(request);
      case "canned":
        return this.cannedMode();
      case "template":
        return this.templateMode(request);
      case "script":
        return this.scriptMode(request);
      default:
        // Should never happen; keep TypeScript happy
        return this.echoMode(request);
    }
  }

  /** Echo last user content; if absent, echo last message content. */
  private echoMode(request: LlmGenerateRequest): string {
    const lastUser = getLastByRole(request.messages, "user") ?? getLastMessage(request.messages);
    return lastUser?.content ?? "";
  }

  /** Return fixed text; empty string if not set. */
  private cannedMode(): string {
    return this.cannedText ?? "";
  }

  /**
   * Very small templating:
   *   {{system}}     -> concatenated system messages
   *   {{user}}       -> concatenated user messages
   *   {{assistant}}  -> concatenated assistant messages
   *   {{lastSystem}} -> last system message content
   *   {{lastUser}}   -> last user message content
   *   {{lastAssistant}} -> last assistant message content
   *   {{transcript}} -> a simple "role: content" transcript, joined by newlines
   */
  private templateMode(request: LlmGenerateRequest): string {
    const tpl = this.template ?? "{{lastUser}}";
    const sysAll = joinContentsByRole(request.messages, "system");
    const usrAll = joinContentsByRole(request.messages, "user");
    const asstAll = joinContentsByRole(request.messages, "assistant");

    const replacements: Record<string, string> = {
      system: sysAll,
      user: usrAll,
      assistant: asstAll,
      lastSystem: getLastByRole(request.messages, "system")?.content ?? "",
      lastUser: getLastByRole(request.messages, "user")?.content ?? "",
      lastAssistant: getLastByRole(request.messages, "assistant")?.content ?? "",
      transcript: buildTranscript(request.messages),
    };

    return applyTemplate(tpl, replacements);
  }

  /** Delegate to user-supplied function; default fallback to echo if undefined. */
  private async scriptMode(request: LlmGenerateRequest): Promise<string> {
    if (!this.script) return this.echoMode(request);
    const out = await this.script(request);
    return out ?? "";
  }

  // ----- Post-processing ------------------------------------------------------

  /** Cut at first matching stop sequence, if any. */
  private applyStopSequences(text: string, stops?: string[]): string {
    if (!text || !stops?.length) return text;
    let cut = text;
    for (const s of stops) {
      if (!s) continue;
      const idx = cut.indexOf(s);
      if (idx >= 0) {
        cut = cut.slice(0, idx);
        // Continue scanning in case an earlier sequence appears even sooner
      }
    }
    return cut;
  }

  /** Roughly simulate maxOutputTokens by splitting on whitespace and rejoining. */
  private applyMaxOutputTokens(text: string, maxOutputTokens?: number): string {
    if (!text || !maxOutputTokens || maxOutputTokens <= 0) return text;
    const tokens = text.split(this.tokenSplitter).filter(Boolean);
    if (tokens.length <= maxOutputTokens) return text;
    return tokens.slice(0, maxOutputTokens).join(" ");
  }
}

// ----- Small helpers ----------------------------------------------------------

function getLastMessage(messages: LlmMessage[]): LlmMessage | undefined {
  return messages[messages.length - 1];
}

function getLastByRole(messages: LlmMessage[], role: LlmMessage["role"]): LlmMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === role) return messages[i];
  }
  return undefined;
}

function joinContentsByRole(messages: LlmMessage[], role: LlmMessage["role"]): string {
  return messages.filter((m) => m.role === role).map((m) => m.content).join("\n");
}

function buildTranscript(messages: LlmMessage[]): string {
  return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
}

/** Minimal {{var}} replacement without conditionals/loops. */
function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

// Optional convenience export if you want a fast echo instance elsewhere
export function createEchoLlm(): LlmClient {
  return new FakeLlmClient({ mode: "echo" });
}

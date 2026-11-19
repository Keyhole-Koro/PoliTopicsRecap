import {
  appConfig,
  DEFAULT_ANTHROPIC_MODEL,
  getActiveLlmSettings,
  setAppEnvironment,
  type AppConfig,
  type AppEnvironment,
} from "./config";

/*
 * defaults to Claude (anthropic) with the documented Anthropic settings
 * [Contract] Without LLM_PROVIDER/ANTHROPIC_* the provider is anthropic, the model claude-haiku-5-5, effort medium, timeout 600000 ms and both token budgets 64000.
 * [Reason] The batch switched from Gemini to Claude Haiku; the defaults are what production runs with.
 * [Accident] Without this, a typo in a default could silently send every request to the wrong model or with a tiny output budget.
 * [Odd] Uses localstackTest, where API keys are the literal "dummy" like the Gemini key.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * parses LLM_PROVIDER and rejects unknown values
 * [Contract] LLM_PROVIDER accepts anthropic or gemini (case-insensitive, trimmed); anything else throws at startup.
 * [Reason] LLM_PROVIDER=gemini is the rollback switch; a typo must stop the batch instead of picking a provider silently.
 * [Accident] Without this, "Gemini " or "openai" could fall back to an unexpected provider.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * validates ANTHROPIC_EFFORT and reads the other ANTHROPIC_* overrides
 * [Contract] ANTHROPIC_EFFORT must be low|medium|high|xhigh|max; model, timeout and token budgets come from their env vars.
 * [Reason] An invalid effort is a 400 on every request; failing at startup is cheaper and clearer.
 * [Accident] Without this, the batch would start and fail every task.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * requires only the active provider's API key in stage/prod
 * [Contract] stage/prod require ANTHROPIC_API_KEY when the provider is anthropic and GEMINI_API_KEY when it is gemini; the other key is optional.
 * [Reason] The Gemini key can be revoked after the switch, and rollback must not need the Claude key.
 * [Accident] Without this, removing the unused key would crash the batch at startup.
 * [Odd] Sets fake R2 and Discord env vars because stage/prod require them too.
 * [History] Gemini to Claude Haiku migration (2026-11).
 *
 * returns the active provider's model and token budgets
 * [Contract] getActiveLlmSettings follows config.llmProvider; the recovery cap is min(maxOutput, 8000) for anthropic and min(maxOutput, 3000) for gemini.
 * [Reason] Call sites read budgets from one place instead of gemini* fields.
 * [Accident] Without this, Claude runs could use Gemini budgets, or the recovery call could leave no room for thinking.
 * [Odd] None.
 * [History] Gemini to Claude Haiku migration (2026-11).
 */

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_ENVIRONMENT: AppEnvironment = appConfig.environment;

const LLM_ENV_NAMES = [
  "LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_EFFORT",
  "ANTHROPIC_TIMEOUT_MS",
  "ANTHROPIC_MAX_INPUT_TOKEN",
  "ANTHROPIC_MAX_OUTPUT_TOKEN",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_MAX_INPUT_TOKEN",
  "GEMINI_MAX_OUTPUT_TOKEN",
];

function resetEnv(overrides: Record<string, string> = {}): void {
  process.env = { ...ORIGINAL_ENV };
  for (const name of LLM_ENV_NAMES) {
    delete process.env[name];
  }
  Object.assign(process.env, overrides);
}

// stage/prod also require R2 and Discord settings; fake values only.
const DEPLOYED_ENV = {
  R2_WRITE_ENDPOINT_URL: "https://r2.example.invalid",
  R2_PUBLIC_ASSET_URL: "https://asset.example.invalid",
  R2_ACCESS_KEY_ID: "test-r2-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-r2-secret",
  DISCORD_WEBHOOK_ERROR: "https://discord.example.invalid/error",
  DISCORD_WEBHOOK_WARN: "https://discord.example.invalid/warn",
  DISCORD_WEBHOOK_BATCH: "https://discord.example.invalid/batch",
};

function buildConfig(environment: AppEnvironment, env: Record<string, string> = {}): AppConfig {
  resetEnv(env);
  setAppEnvironment(environment);
  return appConfig;
}

describe("config: LLM provider settings", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    setAppEnvironment(ORIGINAL_ENVIRONMENT);
  });

  it("defaults to Claude (anthropic) with the documented Anthropic settings", () => {
    const config = buildConfig("localstackTest");

    expect(config.llmProvider).toBe("anthropic");
    expect(config.anthropicApiKey).toBe("dummy");
    expect(config.anthropicModel).toBe("claude-haiku-5-5");
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    expect(config.anthropicEffort).toBe("medium");
    expect(config.anthropicTimeoutMs).toBe(600000);
    expect(config.anthropicMaxInputToken).toBe(64000);
    expect(config.anthropicMaxOutputToken).toBe(64000);
    // Gemini settings stay available for rollback.
    expect(config.geminiApiKey).toBe("dummy");
    expect(config.geminiModel).toBe("gemini-3-flash-preview");
  });

  it("parses LLM_PROVIDER and rejects unknown values", () => {
    expect(buildConfig("localstackTest", { LLM_PROVIDER: "gemini" }).llmProvider).toBe("gemini");
    expect(buildConfig("localstackTest", { LLM_PROVIDER: " Anthropic " }).llmProvider).toBe("anthropic");
    expect(buildConfig("local", { LLM_PROVIDER: "GEMINI", ...DEPLOYED_ENV }).llmProvider).toBe("gemini");

    expect(() => buildConfig("localstackTest", { LLM_PROVIDER: "openai" })).toThrow(
      "Environment variable LLM_PROVIDER must be one of anthropic, gemini (received: openai)",
    );
  });

  it("validates ANTHROPIC_EFFORT and reads the other ANTHROPIC_* overrides", () => {
    const config = buildConfig("localstackTest", {
      ANTHROPIC_EFFORT: "high",
      ANTHROPIC_MODEL: "claude-haiku-5-5-custom",
      ANTHROPIC_TIMEOUT_MS: "120000",
      ANTHROPIC_MAX_INPUT_TOKEN: "32000",
      ANTHROPIC_MAX_OUTPUT_TOKEN: "16000",
    });
    expect(config.anthropicEffort).toBe("high");
    expect(config.anthropicModel).toBe("claude-haiku-5-5-custom");
    expect(config.anthropicTimeoutMs).toBe(120000);
    expect(config.anthropicMaxInputToken).toBe(32000);
    expect(config.anthropicMaxOutputToken).toBe(16000);

    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(buildConfig("localstackTest", { ANTHROPIC_EFFORT: effort }).anthropicEffort).toBe(effort);
    }

    expect(() => buildConfig("localstackTest", { ANTHROPIC_EFFORT: "extreme" })).toThrow(
      "Environment variable ANTHROPIC_EFFORT must be one of low, medium, high, xhigh, max (received: extreme)",
    );
  });

  describe.each<AppEnvironment>(["stage", "prod"])("requires only the active provider's API key in %s", (environment) => {
    it("anthropic: requires ANTHROPIC_API_KEY, GEMINI_API_KEY is optional", () => {
      const config = buildConfig(environment, {
        ...DEPLOYED_ENV,
        ANTHROPIC_API_KEY: "test-anthropic-key",
      });
      expect(config.llmProvider).toBe("anthropic");
      expect(config.anthropicApiKey).toBe("test-anthropic-key");
      expect(config.geminiApiKey).toBe("");

      expect(() => buildConfig(environment, { ...DEPLOYED_ENV, GEMINI_API_KEY: "test-gemini-key" })).toThrow(
        "Environment variable ANTHROPIC_API_KEY is required",
      );
    });

    it("gemini: requires GEMINI_API_KEY, ANTHROPIC_API_KEY is optional", () => {
      const config = buildConfig(environment, {
        ...DEPLOYED_ENV,
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "test-gemini-key",
      });
      expect(config.llmProvider).toBe("gemini");
      expect(config.geminiApiKey).toBe("test-gemini-key");
      expect(config.anthropicApiKey).toBe("");

      expect(() =>
        buildConfig(environment, {
          ...DEPLOYED_ENV,
          LLM_PROVIDER: "gemini",
          ANTHROPIC_API_KEY: "test-anthropic-key",
        }),
      ).toThrow("Environment variable GEMINI_API_KEY is required");
    });
  });

  it("returns the active provider's model and token budgets", () => {
    const anthropic = buildConfig("localstackTest", {
      ANTHROPIC_MAX_INPUT_TOKEN: "50000",
      ANTHROPIC_MAX_OUTPUT_TOKEN: "40000",
      GEMINI_MAX_INPUT_TOKEN: "30000",
      GEMINI_MAX_OUTPUT_TOKEN: "20000",
    });
    expect(getActiveLlmSettings(anthropic)).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      maxInputToken: 50000,
      maxOutputToken: 40000,
      recoveryMaxOutputToken: 8000,
    });

    const gemini = buildConfig("localstackTest", {
      LLM_PROVIDER: "gemini",
      ANTHROPIC_MAX_INPUT_TOKEN: "50000",
      ANTHROPIC_MAX_OUTPUT_TOKEN: "40000",
      GEMINI_MAX_INPUT_TOKEN: "30000",
      GEMINI_MAX_OUTPUT_TOKEN: "20000",
    });
    expect(getActiveLlmSettings(gemini)).toEqual({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      maxInputToken: 30000,
      maxOutputToken: 20000,
      recoveryMaxOutputToken: 3000,
    });

    // The recovery cap never exceeds the configured output budget.
    const small = buildConfig("localstackTest", { ANTHROPIC_MAX_OUTPUT_TOKEN: "4000" });
    expect(getActiveLlmSettings(small).recoveryMaxOutputToken).toBe(4000);
  });
});

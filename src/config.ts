import type { S3ClientConfig } from '@aws-sdk/client-s3';

export type AppEnvironment = "local" | "stage" | "prod" | "ghaTest" | "localstackTest"

export type RateLimitConfig = {
  requestsPerMinute: number
  requestsPerDay: number
  maxConsecutiveErrors: number
  cooldownOnErrorMs: number
}

export type BatchConfig = {
  maxTasksPerRun: number | "auto"
  gracefulShutdownTimeoutMs: number
}

export type R2Config = {
  /**
   * R2 API endpoint (S3 compatible URL).
   * Used by the SDK to perform backend operations (upload/delete).
   * e.g., https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   */
  endpoint: string
  /**
   * R2 region. Cloudflare R2 usually uses "auto".
   */
  region: string
  /**
   * R2 Token Access Key ID.
   * Credential for authentication (like a username).
   */
  accessKeyId: string
  /**
   * R2 Token Secret Access Key.
   * Credential for authentication (like a password).
   */
  secretAccessKey: string
  /**
   * The name of the R2 bucket.
   */
  bucket: string
  /**
   * The public-facing URL base for accessing assets via HTTP.
   * Used to generate public links for users (e.g., in emails or UI).
   * e.g., https://asset.politopics.net or https://pub-<ID>.r2.dev
   */
  publicUrlBase: string
  clientConfig: S3ClientConfig
}

export type NotificationSettings = {
  enabled: boolean
  delayMs: number
  logGroupName?: string
  executionEnv?: string
}

export type AppConfig = {
  environment: AppEnvironment
  aws: {
    region: string
    endpoint: string
    forcePathStyle: boolean
    credentials: { accessKeyId: string; secretAccessKey: string }
    clientConfig: S3ClientConfig
  }
  taskTableName: string
  taskStatusIndexName: string
  promptBucketName: string
  articleTableName: string
  articleAssetBucketName: string
  r2: R2Config
  geminiApiKey: string
  geminiModel: string
  geminiMaxInputToken: number
  geminiMaxOutputToken: number
  notifications: {
    errorWebhook: string
    warnWebhook: string
    batchWebhook: string
  }
  notificationSettings: NotificationSettings
  rateLimit: RateLimitConfig
  batch: BatchConfig
}

const CONFIG_BY_ENV: Record<AppEnvironment, () => Omit<AppConfig, "environment">> = {
  local: buildLocalConfig,
  stage: buildStageConfig,
  prod: buildProdConfig,
  ghaTest: buildTestConfig,
  localstackTest: buildTestConfig,
}

const ACTIVE_ENVIRONMENT: AppEnvironment = resolveEnvironment()

export let appConfig: AppConfig = {
  environment: ACTIVE_ENVIRONMENT,
  ...CONFIG_BY_ENV[ACTIVE_ENVIRONMENT](),
}

export function setAppEnvironment(environment: AppEnvironment) {
  appConfig = {
    environment,
    ...CONFIG_BY_ENV[environment](),
  }
}

function buildLocalConfig(): Omit<AppConfig, "environment"> {
  return {
    aws: {
      region: "ap-northeast-3",
      endpoint: "http://localstack:4566",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      clientConfig: {
        region: "ap-northeast-3",
        endpoint: "http://localstack:4566",
        forcePathStyle: true,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      },
    },
    taskTableName: "politopics-llm-tasks-local",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-llm-artifacts-local",
    articleTableName: "politopics-local",
    articleAssetBucketName: "politopics-articles-local",
    r2: {
      endpoint: "http://localstack:4566",
      region: "ap-northeast-3",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "politopics-articles-local",
      publicUrlBase: "http://localhost:4566/politopics-articles-local",
      clientConfig: {
        region: "ap-northeast-3",
        endpoint: "http://localstack:4566",
        forcePathStyle: true,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      },
    },
    geminiApiKey: "dummy",
    geminiModel: optionalEnv("GEMINI_MODEL") || "gemini-3-flash-preview",
    geminiMaxInputToken: optionalEnvNumber("GEMINI_MAX_INPUT_TOKEN", 64000),
    geminiMaxOutputToken: optionalEnvNumber("GEMINI_MAX_OUTPUT_TOKEN", 64000),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
    notificationSettings: {
      enabled: optionalEnvBool("ENABLE_NOTIFICATION", true),
      delayMs: optionalEnvNumber("NOTIFICATION_DELAY_MS", 1000),
      logGroupName: optionalEnv("AWS_LAMBDA_LOG_GROUP_NAME"),
      executionEnv: optionalEnv("AWS_EXECUTION_ENV"),
    },
    rateLimit: {
      requestsPerMinute: 15,
      requestsPerDay: 1500,
      maxConsecutiveErrors: 5,
      cooldownOnErrorMs: 30000,
    },
    batch: {
      maxTasksPerRun: "auto",
      gracefulShutdownTimeoutMs: 10000,
    },
  };
}

function buildStageConfig(): Omit<AppConfig, "environment"> {
  const r2Endpoint = requireEnv("R2_WRITE_ENDPOINT_URL");
  const r2PublicBase = requireEnv("R2_PUBLIC_ASSET_URL");
  return {
    aws: {
      region: "ap-northeast-3",
      endpoint: "dummy",
      forcePathStyle: false,
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
      clientConfig: {
        region: "ap-northeast-3",
      },
    },
    taskTableName: "politopics-llm-tasks-stage",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-llm-artifacts-stage",
    articleTableName: "politopics-stage",
    articleAssetBucketName: "politopics-articles-stage",
    r2: {
      endpoint: r2Endpoint,
      region: "auto",
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: "politopics-articles-stage",
      publicUrlBase: r2PublicBase,
      clientConfig: {
        region: "auto",
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
          secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
        },
        forcePathStyle: true,
      },
    },
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    geminiModel: optionalEnv("GEMINI_MODEL") || "gemini-3-flash-preview",
    geminiMaxInputToken: optionalEnvNumber("GEMINI_MAX_INPUT_TOKEN", 64000),
    geminiMaxOutputToken: optionalEnvNumber("GEMINI_MAX_OUTPUT_TOKEN", 64000),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
    notificationSettings: {
      enabled: optionalEnvBool("ENABLE_NOTIFICATION", true),
      delayMs: optionalEnvNumber("NOTIFICATION_DELAY_MS", 1000),
      logGroupName: optionalEnv("AWS_LAMBDA_LOG_GROUP_NAME"),
      executionEnv: optionalEnv("AWS_EXECUTION_ENV"),
    },
    rateLimit: {
      requestsPerMinute: 1,
      requestsPerDay: 15,
      maxConsecutiveErrors: 3,
      cooldownOnErrorMs: 30000,
    },
    batch: {
      maxTasksPerRun: "auto",
      gracefulShutdownTimeoutMs: 10000,
    },
  };
}

function buildProdConfig(): Omit<AppConfig, "environment"> {
  const r2Endpoint = requireEnv("R2_WRITE_ENDPOINT_URL");
  const r2PublicBase = "https://asset.politopics.net";
  return {
    aws: {
      region: "ap-northeast-3",
      endpoint: "dummy",
      forcePathStyle: false,
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
      clientConfig: {
        region: "ap-northeast-3",
      },
    },
    taskTableName: "politopics-llm-tasks-prod",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-llm-artifacts-prod",
    articleTableName: "politopics-prod",
    articleAssetBucketName: "politopics-articles-prod",
    r2: {
      endpoint: r2Endpoint,
      region: "auto",
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: "politopics-articles-prod",
      publicUrlBase: r2PublicBase,
      clientConfig: {
        region: "auto",
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
          secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
        },
        forcePathStyle: true,
      },
    },
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    geminiModel: optionalEnv("GEMINI_MODEL") || "gemini-3-pro-preview",
    geminiMaxInputToken: optionalEnvNumber("GEMINI_MAX_INPUT_TOKEN", 64000),
    geminiMaxOutputToken: optionalEnvNumber("GEMINI_MAX_OUTPUT_TOKEN", 64000),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
    notificationSettings: {
      enabled: optionalEnvBool("ENABLE_NOTIFICATION", true),
      delayMs: optionalEnvNumber("NOTIFICATION_DELAY_MS", 1000),
      logGroupName: optionalEnv("AWS_LAMBDA_LOG_GROUP_NAME"),
      executionEnv: optionalEnv("AWS_EXECUTION_ENV"),
    },
    rateLimit: {
      requestsPerMinute: 3,
      requestsPerDay: 50,
      maxConsecutiveErrors: 3,
      cooldownOnErrorMs: 30000,
    },
    batch: {
      maxTasksPerRun: "auto",
      gracefulShutdownTimeoutMs: 10000,
    },
  };
}

function buildTestConfig(): Omit<AppConfig, "environment"> {
  const r2Endpoint = optionalEnv("R2_WRITE_ENDPOINT_URL");
  const r2PublicBase =
    optionalEnv("R2_PUBLIC_ASSET_URL") ||
    "http://localhost:4566/politopics-articles-local";
  return {
    aws: {
      region: optionalEnv("AWS_REGION") || "ap-northeast-3",
      endpoint: optionalEnv("AWS_ENDPOINT_URL") || "http://localhost:4566",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      clientConfig: {
        region: optionalEnv("AWS_REGION") || "ap-northeast-3",
        endpoint: optionalEnv("AWS_ENDPOINT_URL") || "http://localhost:4566",
        forcePathStyle: true,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      },
    },
    taskTableName: optionalEnv("TASK_TABLE_NAME") || "politopics-llm-tasks-local",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: optionalEnv("PROMPT_BUCKET_NAME") || "politopics-llm-artifacts-local",
    articleTableName: optionalEnv("ARTICLE_TABLE_NAME") || "politopics-local",
    articleAssetBucketName: optionalEnv("ARTICLE_ASSET_BUCKET_NAME") || "politopics-articles-local",
    r2: {
      endpoint: r2Endpoint!,
      region: "auto",
      accessKeyId: optionalEnv("R2_ACCESS_KEY_ID") || "test",
      secretAccessKey: optionalEnv("R2_SECRET_ACCESS_KEY") || "test",
      bucket: optionalEnv("R2_ARTICLE_BUCKET") || "politopics-articles-local",
      publicUrlBase: r2PublicBase,
      clientConfig: {
        region: "auto",
        endpoint: r2Endpoint!,
        credentials: {
          accessKeyId: optionalEnv("R2_ACCESS_KEY_ID") || "test",
          secretAccessKey: optionalEnv("R2_SECRET_ACCESS_KEY") || "test",
        },
        forcePathStyle: true,
      },
    },
    geminiApiKey: "dummy",
    geminiModel: optionalEnv("GEMINI_MODEL") || "gemini-3-flash-preview",
    geminiMaxInputToken: optionalEnvNumber("GEMINI_MAX_INPUT_TOKEN", 64000),
    geminiMaxOutputToken: optionalEnvNumber("GEMINI_MAX_OUTPUT_TOKEN", 64000),
    notifications: {
      errorWebhook: optionalEnv("DISCORD_WEBHOOK_ERROR") || "",
      warnWebhook: optionalEnv("DISCORD_WEBHOOK_WARN") || "",
      batchWebhook: optionalEnv("DISCORD_WEBHOOK_BATCH") || "",
    },
    notificationSettings: {
      enabled: optionalEnvBool("ENABLE_NOTIFICATION", false),
      delayMs: optionalEnvNumber("NOTIFICATION_DELAY_MS", 100),
      logGroupName: optionalEnv("AWS_LAMBDA_LOG_GROUP_NAME"),
      executionEnv: optionalEnv("AWS_EXECUTION_ENV"),
    },
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerDay: 10000,
      maxConsecutiveErrors: 3,
      cooldownOnErrorMs: 1000,
    },
    batch: {
      maxTasksPerRun: 10,
      gracefulShutdownTimeoutMs: 5000,
    },
  };
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}


function optionalEnvBool(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return defaultValue;
  return value.toLowerCase() !== "false";
}

function optionalEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function requireEnv(name: string, allowMissing = false): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    if (allowMissing) return "";
    throw new Error(`Environment variable ${name} is required`);
  }
  return value.trim();
}


function resolveEnvironment(): AppEnvironment {
  if (!process.env.APP_ENVIRONMENT) {
    throw new Error("Environment variable APP_ENVIRONMENT is required");
  }
  const value = process.env.APP_ENVIRONMENT;
  if (value === "local" || value === "stage" || value === "prod" || value === "ghaTest" || value === "localstackTest") {
    return value;
  }
  throw new Error(
    `Environment variable APP_ENVIRONMENT must be one of local, stage, prod, ghaTest, localstackTest (received: ${value})`,
  );
}

// ============================================================================
// Utilities
// ============================================================================

export type Config = AppConfig;

export function resolveConfig(): Config {
  return appConfig;
}

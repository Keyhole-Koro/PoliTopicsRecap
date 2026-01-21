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
    endpoint?: string
    forcePathStyle?: boolean
    credentials?: { accessKeyId: string; secretAccessKey: string }
  }
  taskTableName: string
  taskStatusIndexName: string
  promptBucketName: string
  articleTableName: string
  articleAssetBucketName: string
  r2: R2Config | null
  geminiApiKey: string
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
    },
    taskTableName: "politopics-llm-tasks-local",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-prompts",
    articleTableName: "politopics-local",
    articleAssetBucketName: "politopics-articles-local",
    r2: null, // Use LocalStack S3 in local mode
    geminiApiKey: "dummy",
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
  return {
    aws: {
      region: "ap-northeast-3",
    },
    taskTableName: "politopics-llm-tasks-stage",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-prompts-stage",
    articleTableName: "politopics-stage",
    articleAssetBucketName: "politopics-articles-stage",
    r2: {
      endpoint: requireEnv("R2_ENDPOINT_URL"),
      region: "auto",
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: "politopics-articles-stage",
      publicUrlBase: requireEnv("R2_ENDPOINT_URL"),
    },
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
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
      requestsPerDay: 100,
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
  return {
    aws: {
      region: "ap-northeast-3",
    },
    taskTableName: "politopics-llm-tasks-prod",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-prompts-prod",
    articleTableName: "politopics-prod",
    articleAssetBucketName: "politopics-articles-prod",
    r2: {
      endpoint: requireEnv("R2_ENDPOINT_URL"),
      region: "auto",
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: "politopics-articles-prod",
      publicUrlBase: "https://asset.politopics.net",
    },
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
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

function buildTestConfig(): Omit<AppConfig, "environment"> {
  return {
    aws: {
      region: optionalEnv("AWS_REGION") || "ap-northeast-3",
      endpoint: optionalEnv("AWS_ENDPOINT_URL") || "http://localhost:4566",
      forcePathStyle: true,
      credentials:
        optionalEnv("AWS_ACCESS_KEY_ID") && optionalEnv("AWS_SECRET_ACCESS_KEY")
          ? { accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID")!, secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY")! }
          : { accessKeyId: "test", secretAccessKey: "test" },
    },
    taskTableName: optionalEnv("TASK_TABLE_NAME") || "politopics-llm-tasks-local",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: optionalEnv("PROMPT_BUCKET_NAME") || "politopics-prompts",
    articleTableName: optionalEnv("ARTICLE_TABLE_NAME") || "politopics-local",
    articleAssetBucketName: optionalEnv("ARTICLE_ASSET_BUCKET_NAME") || "politopics-articles-local",
    r2: optionalEnv("R2_ENDPOINT_URL") ? {
      endpoint: optionalEnv("R2_ENDPOINT_URL")!,
      region: optionalEnv("R2_REGION") || "auto",
      accessKeyId: optionalEnv("R2_ACCESS_KEY_ID") || "test",
      secretAccessKey: optionalEnv("R2_SECRET_ACCESS_KEY") || "test",
      bucket: optionalEnv("R2_ARTICLE_BUCKET") || "politopics-articles-local",
      publicUrlBase: optionalEnv("R2_PUBLIC_URL_BASE") || "http://localhost:4566/politopics-articles-local",
    } : null,
    geminiApiKey: "dummy",
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
  return value && value.trim() !== "" ? value : undefined;
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
  return value;
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

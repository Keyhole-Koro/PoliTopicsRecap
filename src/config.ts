export type AppEnvironment = "local" | "stage" | "prod" | "ghaTest" | "localstackTest"

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
  geminiApiKey: string
  notifications: {
    errorWebhook: string
    warnWebhook: string
    batchWebhook: string
  }
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
    geminiApiKey: "dummy",
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
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
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
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
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  };
}

function buildTestConfig(): Omit<AppConfig, "environment"> {
  const optionalEnv = (name: string) => requireEnv(name, true);
  return {
    aws: {
      region: process.env.AWS_REGION || "ap-northeast-3",
      endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
      forcePathStyle: true,
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
          : { accessKeyId: "test", secretAccessKey: "test" },
    },
    taskTableName: process.env.TASK_TABLE_NAME || "politopics-llm-tasks-local",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: process.env.PROMPT_BUCKET_NAME || "politopics-prompts",
    articleTableName: process.env.ARTICLE_TABLE_NAME || "politopics-local",
    articleAssetBucketName: process.env.ARTICLE_ASSET_BUCKET_NAME || "politopics-articles-local",
    geminiApiKey: "dummy",
    notifications: {
      errorWebhook: optionalEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: optionalEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: optionalEnv("DISCORD_WEBHOOK_BATCH"),
    },
  };
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

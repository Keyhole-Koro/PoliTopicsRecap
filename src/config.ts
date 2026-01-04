export type AppEnvironment = "local" | "stage" | "prod"

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

const CONFIG_BY_ENV: Record<AppEnvironment, Omit<AppConfig, "environment">> = {
  local: {
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
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  },
  stage: {
    aws: {
      region: "ap-northeast-3",
    },
    taskTableName: "politopics-llm-tasks-stage",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-prompts",
    articleTableName: "politopics-stage",
    articleAssetBucketName: "politopics-articles-stage",
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  },
  prod: {
    aws: {
      region: "ap-northeast-3",
    },
    taskTableName: "politopics-llm-tasks-prod",
    taskStatusIndexName: "StatusIndex",
    promptBucketName: "politopics-prompts",
    articleTableName: "politopics-prod",
    articleAssetBucketName: "politopics-articles-prod",
    geminiApiKey: requireEnv("GEMINI_API_KEY"),
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  },
}

const ACTIVE_ENVIRONMENT: AppEnvironment = resolveEnvironment()

export let appConfig: AppConfig = {
  environment: ACTIVE_ENVIRONMENT,
  ...CONFIG_BY_ENV[ACTIVE_ENVIRONMENT],
}

export function setAppEnvironment(environment: AppEnvironment) {
  appConfig = {
    environment,
    ...CONFIG_BY_ENV[environment],
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function resolveEnvironment(): AppEnvironment {
  if (!process.env.APP_ENVIRONMENT) {
    throw new Error("Environment variable APP_ENVIRONMENT is required");
  }
  const value = process.env.APP_ENVIRONMENT;
  if (value === "local" || value === "stage" || value === "prod") {
    return value;
  }
  throw new Error(
    `Environment variable APP_ENVIRONMENT must be one of local, stage, prod (received: ${value})`,
  );
}

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
    geminiApiKey: "local-dev-key",
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
    geminiApiKey: "REPLACE_ME",
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
    geminiApiKey: "REPLACE_ME",
  },
}

const ACTIVE_ENVIRONMENT: AppEnvironment = "local"

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

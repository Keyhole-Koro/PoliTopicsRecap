export type Config = {
  taskTableName: string;
  taskStatusIndexName: string;
  articleTableName: string;
  articleAssetBucketName: string;
  geminiApiKey: string;
  backoffBaseSeconds: number;
  backoffCapSeconds: number;
};

export function resolveConfig(): Config {
  const taskTableName = getEnvWithFallback(
    ['LLM_TASK_TABLE', 'TASK_TABLE_NAME'],
    'PoliTopics-llm-tasks',
  );
  const taskStatusIndexName = getEnvWithFallback(
    ['LLM_TASK_STATUS_INDEX', 'TASK_STATUS_INDEX_NAME'],
    'StatusIndex',
  );
  const articleTableName = requireEnv('ARTICLE_TABLE_NAME');
  const articleAssetBucketName = requireEnv('PROMPT_BUCKET_NAME');
  const geminiApiKey = requireEnv('GEMINI_API_KEY');
  const backoffBaseSeconds = numberFromEnv('BACKOFF_BASE_SECONDS', 1);
  const backoffCapSeconds = numberFromEnv('BACKOFF_CAP_SECONDS', 60);

  return {
    taskTableName,
    taskStatusIndexName,
    articleTableName,
    articleAssetBucketName,
    geminiApiKey,
    backoffBaseSeconds,
    backoffCapSeconds,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value && value.length > 0) {
    return value;
  }
  throw new Error(`${name} environment variable is required`);
}

function getEnvWithFallback(names: string[], defaultValue: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) {
      return value;
    }
  }
  return defaultValue;
}

function numberFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const value = Number(raw);
  if (Number.isFinite(value)) {
    return value;
  }
  return defaultValue;
}

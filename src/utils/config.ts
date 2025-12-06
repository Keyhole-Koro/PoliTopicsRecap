export type Config = {
  taskTableName: string;
  taskStatusIndexName: string;
  articleTableName: string;
  articleAssetBucketName: string;
  geminiApiKey: string;
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

  return {
    taskTableName,
    taskStatusIndexName,
    articleTableName,
    articleAssetBucketName,
    geminiApiKey,
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

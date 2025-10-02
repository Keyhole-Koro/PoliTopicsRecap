export type ChunkPromptTaskMessage = {
  type: 'chunk';
  url: string; // s3://bucket/key
  result_url?: string; // optional s3://bucket/key for result
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  delayMs?: number;
  retryAttempts: number;
};

export function isChunkPromptTaskMessage(value: unknown): value is ChunkPromptTaskMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type !== 'chunk') {
    return false;
  }

  if (typeof value.url !== 'string' || !value.url.startsWith('s3://')) {
    return false;
  }

  if (
    value.result_url !== undefined &&
    (typeof value.result_url !== 'string' || !value.result_url.startsWith('s3://'))
  ) {
    return false;
  }

  if (typeof value.llm !== 'string' || value.llm.length === 0) {
    return false;
  }

  if (typeof value.llmModel !== 'string' || value.llmModel.length === 0) {
    return false;
  }

  if (value.meta !== undefined && !isRecord(value.meta)) {
    return false;
  }

  if (value.delayMs !== undefined && !isFiniteNumber(value.delayMs)) {
    return false;
  }

  if (!isFiniteNumber(value.retryAttempts) || value.retryAttempts < 0) {
    return false;
  }

  return true;
}

export function parseChunkPromptTaskMessage(body: string | unknown): ChunkPromptTaskMessage {
  const parsed = typeof body === 'string' ? safeJsonParse(body) : body;

  if (isChunkPromptTaskMessage(parsed)) {
    return parsed;
  }

  if (isRecord(parsed) && parsed.type === 'chunk') {
    const normalized: Record<string, unknown> = {
      ...parsed,
      retryAttempts: normalizeRetryAttempts((parsed as Record<string, unknown>).retryAttempts),
    };

    if (isChunkPromptTaskMessage(normalized)) {
      return normalized;
    }
  }

  throw new Error('Invalid chunk prompt task message');
}

function safeJsonParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (err) {
    throw new Error('Failed to parse SQS body as JSON');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRetryAttempts(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }

  return 0;
}

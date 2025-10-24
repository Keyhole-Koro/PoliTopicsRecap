export type MapPromptTaskMessage = {
  type: 'map';
  url: string; // s3://bucket/key
  result_url: string;
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  retryAttempts: number;
  retryMs_in: number;
};

export function isMapPromptTaskMessage(value: unknown): value is MapPromptTaskMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type !== 'map') {
    return false;
  }

  if (typeof value.url !== 'string' || !value.url.startsWith('s3://')) {
    return false;
  }

  if (typeof value.result_url !== 'string' || !value.result_url.startsWith('s3://')) {
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

  if (!isFiniteNumber(value.retryAttempts) || value.retryAttempts < 0) {
    return false;
  }

  if (!isFiniteNumber(value.retryMs_in) || value.retryMs_in < 0) {
    return false;
  }
  
  return true;
}

export function parseMapPromptTaskMessage(body: JSON): MapPromptTaskMessage {

  if (isRecord(body) && body.type === 'map') {
    const normalized: Record<string, unknown> = {
      ...body,
      retryAttempts: normalizeRetryAttempts((body as Record<string, unknown>).retryAttempts),
    };

    if (isMapPromptTaskMessage(normalized)) {
      return normalized;
    }
  }

  throw new Error('Invalid map prompt task message');
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

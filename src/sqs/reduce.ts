export type ReducePromptTaskMessage = {
  type: 'reduce';
  chunk_result_urls: string[]; // s3://bucket/key for chunk-level results
  meta?: Record<string, any>;
  prompt: string;
  issueID: string;
  meeting: {
    issueID: string;
    nameOfMeeting: string;
    nameOfHouse: string;
    date: string;
    numberOfSpeeches: number;
  };
  llm: string;
  llmModel: string;
  retryAttempts: number;
  retryMs_in: number;
};

export function isReducePromptTaskMessage(value: unknown): value is ReducePromptTaskMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type !== 'reduce') {
    return false;
  }

  if (!Array.isArray(value.chunk_result_urls) || value.chunk_result_urls.length === 0) {
    return false;
  }

  if (
    !value.chunk_result_urls.every(
      (url) => typeof url === 'string' && url.startsWith('s3://'),
    )
  ) {
    return false;
  }

  if (value.meta !== undefined && !isRecord(value.meta)) {
    return false;
  }

  if (typeof value.prompt !== 'string' || value.prompt.length === 0) {
    return false;
  }

  if (typeof value.issueID !== 'string' || value.issueID.length === 0) {
    return false;
  }

  if (!isMeeting(value.meeting)) {
    return false;
  }

  if (typeof value.llm !== 'string' || value.llm.length === 0) {
    return false;
  }

  if (typeof value.llmModel !== 'string' || value.llmModel.length === 0) {
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

export function parseReducePromptTaskMessage(body: JSON): ReducePromptTaskMessage {

  if (isRecord(body) && body.type === 'reduce') {
    const normalized: Record<string, unknown> = {
      ...body,
      retryAttempts: normalizeRetryAttempts((body as Record<string, unknown>).retryAttempts),
      chunk_result_urls: Array.isArray((body as Record<string, unknown>).chunk_result_urls)
        ? ((body as Record<string, unknown>).chunk_result_urls as unknown[]).filter(
            (url): url is string => typeof url === 'string',
          )
        : [],
    };

    if (isReducePromptTaskMessage(normalized)) {
      return normalized;
    }
  }

  throw new Error('Invalid reduce prompt task message');
}

function isMeeting(value: unknown): value is ReducePromptTaskMessage['meeting'] {
  if (!isRecord(value)) {
    return false;
  }

  const {
    issueID,
    nameOfMeeting,
    nameOfHouse,
    date,
    numberOfSpeeches,
  } = value as Record<string, unknown>;

  if (
    typeof issueID !== 'string' ||
    typeof nameOfMeeting !== 'string' ||
    typeof nameOfHouse !== 'string' ||
    typeof date !== 'string' ||
    !isFiniteNumber(numberOfSpeeches)
  ) {
    return false;
  }

  return true;
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

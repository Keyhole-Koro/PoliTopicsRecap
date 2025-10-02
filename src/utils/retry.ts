import type { Config } from './config';

export function pickDelaySeconds(
  config: Config,
  retryAfterSeconds: number | undefined,
  attempt: number,
): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)) {
    return clampDelaySeconds(config, retryAfterSeconds);
  }

  const maxDelay = Math.min(
    config.backoffCapSeconds,
    config.backoffBaseSeconds * Math.pow(2, attempt - 1),
  );
  return Math.random() * maxDelay;
}

export function clampDelaySeconds(config: Config, delaySeconds: number): number {
  const safeDelay = Math.max(0, delaySeconds);
  return Math.min(safeDelay, config.backoffCapSeconds);
}

export function classifyError(error: unknown): {
  retryable: boolean;
  retryAfterSeconds?: number;
} {
  const err = error as any;
  const retryAfterSeconds = extractRetryAfterSeconds(err);
  const status = getHttpStatus(err);

  const retryable =
    err?.retryable === true ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    isNetworkTimeout(err);

  return { retryable: Boolean(retryable), retryAfterSeconds };
}

function getHttpStatus(err: any): number | undefined {
  return (
    err?.$metadata?.httpStatusCode ??
    err?.statusCode ??
    err?.status ??
    err?.response?.status
  );
}

function extractRetryAfterSeconds(err: any): number | undefined {
  const headers = err?.response?.headers || err?.$metadata?.httpHeaders;
  const candidates = [
    err?.retryAfter,
    err?.retryAfterSeconds,
    err?.retry_after,
    headers?.['retry-after'],
    headers?.['Retry-After'],
    headers?.['Retry-after'],
    err?.body?.retryAfter,
    err?.body?.retry_after,
  ];

  for (const candidate of candidates) {
    const parsed = parseRetryAfter(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function parseRetryAfter(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, value) : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return Math.max(0, numeric);
    }

    const dateMillis = Date.parse(trimmed);
    if (!Number.isNaN(dateMillis)) {
      const diffSeconds = (dateMillis - Date.now()) / 1_000;
      return diffSeconds > 0 ? diffSeconds : 0;
    }
  }

  return undefined;
}

function isNetworkTimeout(err: any): boolean {
  const name = typeof err?.name === 'string' ? err.name : '';
  const code = typeof err?.code === 'string' ? err.code : '';
  const message = typeof err?.message === 'string' ? err.message : '';

  return (
    name.toLowerCase().includes('timeout') ||
    code.toLowerCase().includes('timeout') ||
    code.toLowerCase().includes('throttl') ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('throttl')
  );
}

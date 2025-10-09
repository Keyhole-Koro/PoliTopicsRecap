export type CircuitBreakerConfig = {
  failureThreshold: number;
  minimumRequests: number;
  cooldownMs: number;
  halfOpenMaxCalls: number;
};

export type Config = {
  queueUrl: string;
  queueArn: string;
  idempotencyTableName: string;
  idempotencyTtlSeconds: number;
  idempotencyInProgressTtlSeconds: number;
  rateLimitRps: number;
  rateLimiterBurstCapacity: number;
  backoffBaseSeconds: number;
  backoffCapSeconds: number;
  maxAttempts: number;
  apiTimeoutMs: number;
  overallTimeoutMs: number;
  pauseOnRetryAfterSeconds: number;
  circuitBreaker: CircuitBreakerConfig;
  geminiApiKey: string;
};

export function resolveConfig(): Config {
  const queueUrl = process.env.PROMPT_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('PROMPT_QUEUE_URL environment variable is required');
  }

  const queueArn = process.env.PROMPT_QUEUE_ARN;
  if (!queueArn) {
    throw new Error('PROMPT_QUEUE_ARN environment variable is required');
  }

  const idempotencyTableName = process.env.IDEMPOTENCY_TABLE_NAME;
  if (!idempotencyTableName) {
    throw new Error('IDEMPOTENCY_TABLE_NAME environment variable is required');
  }

  const idempotencyTtlSeconds = numberFromEnv('IDEMPOTENCY_TTL_SECONDS', 86_400);
  const idempotencyInProgressTtlSeconds = numberFromEnv(
    'IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS',
    300,
  );
  const rateLimitRps = Math.max(1, numberFromEnv('RATE_LIMIT_RPS', 5));
  const rateLimiterBurstCapacity = Math.max(
    1,
    numberFromEnv('RATE_LIMIT_BURST', rateLimitRps),
  );
  const backoffBaseSeconds = Math.max(
    0.1,
    numberFromEnv('BACKOFF_BASE_SECONDS', 1),
  );
  const backoffCapSeconds = Math.max(
    backoffBaseSeconds,
    numberFromEnv('BACKOFF_CAP_SECONDS', 60),
  );
  const maxAttempts = Math.max(1, numberFromEnv('MAX_ATTEMPTS', 5));
  const apiTimeoutMs = Math.max(100, numberFromEnv('API_TIMEOUT_MS', 10_000));
  const overallTimeoutMs = Math.max(
    apiTimeoutMs + 1_000,
    numberFromEnv('OVERALL_TIMEOUT_MS', 45_000),
  );

  const circuitFailureThreshold = Math.max(
    1,
    numberFromEnv('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
  );
  const circuitMinimumRequests = Math.max(
    1,
    numberFromEnv('CIRCUIT_BREAKER_MIN_REQUESTS', 5),
  );
  const circuitCooldownSeconds = Math.max(
    1,
    numberFromEnv('CIRCUIT_BREAKER_COOLDOWN_SECONDS', 60),
  );
  const halfOpenMaxCalls = Math.max(
    1,
    numberFromEnv('CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS', 1),
  );

  const pauseOnRetryAfterSeconds = Math.max(
    0,
    numberFromEnv('PAUSE_ON_RETRY_AFTER_SECONDS', 60),
  );

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  return {
    queueUrl,
    queueArn,
    idempotencyTableName,
    idempotencyTtlSeconds,
    idempotencyInProgressTtlSeconds,
    rateLimitRps,
    rateLimiterBurstCapacity,
    backoffBaseSeconds,
    backoffCapSeconds,
    maxAttempts,
    apiTimeoutMs,
    overallTimeoutMs,
    pauseOnRetryAfterSeconds,
    circuitBreaker: {
      failureThreshold: circuitFailureThreshold,
      minimumRequests: circuitMinimumRequests,
      cooldownMs: circuitCooldownSeconds * 1_000,
      halfOpenMaxCalls,
    },
    geminiApiKey,
  };
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
  console.warn(`[PoliTopicsRecapSqsProcessor] Invalid numeric env ${name}: ${raw}`);
  return defaultValue;
}

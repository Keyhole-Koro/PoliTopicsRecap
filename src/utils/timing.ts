export async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Operation timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sleepSeconds(seconds: number): Promise<void> {
  if (seconds <= 0) {
    return;
  }
  await sleep(seconds * 1_000);
}

export function hasRemainingBudget(
  startedAt: number,
  delaySeconds: number,
  overallTimeoutMs: number,
): boolean {
  const projected = Date.now() - startedAt + delaySeconds * 1_000;
  return projected < overallTimeoutMs;
}

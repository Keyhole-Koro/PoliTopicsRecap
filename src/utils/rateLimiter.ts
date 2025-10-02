import { sleep } from './timing';

export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRatePerMs: number;
  private lastRefillTimestamp: number;

  constructor(tokensPerSecond: number, capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.tokens = this.capacity;
    this.refillRatePerMs = Math.max(tokensPerSecond, 1) / 1_000;
    this.lastRefillTimestamp = Date.now();
  }

  async acquire(): Promise<void> {
    while (!this.tryConsumeToken()) {
      const waitMs = this.computeWaitTimeMs();
      await sleep(waitMs);
    }
  }

  private tryConsumeToken(): boolean {
    this.refillTokens();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTimestamp;
    if (elapsed <= 0) {
      return;
    }
    const refill = elapsed * this.refillRatePerMs;
    this.tokens = Math.min(this.capacity, this.tokens + refill);
    this.lastRefillTimestamp = now;
  }

  private computeWaitTimeMs(): number {
    const deficit = 1 - this.tokens;
    if (deficit <= 0) {
      return 0;
    }
    return Math.ceil(deficit / this.refillRatePerMs);
  }
}

import type { RateLimitConfig } from "../config";

export interface RateLimiterState {
  minuteRequests: number[];
  dayRequests: number;
  dayStart: number;
}

/**
 * Rate limiter that enforces requests per minute and requests per day limits.
 * Tracks request timestamps and waits when limits are reached.
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private state: RateLimiterState;
  private readonly nowFn: () => number;

  constructor(config: RateLimitConfig, nowFn: () => number = Date.now) {
    this.config = config;
    this.nowFn = nowFn;
    this.state = {
      minuteRequests: [],
      dayRequests: 0,
      dayStart: this.getStartOfDay(nowFn()),
    };
  }

  /**
   * Wait if rate limit would be exceeded, then record the request.
   * Returns the time waited in milliseconds.
   */
  async waitIfNeeded(): Promise<number> {
    const waitTime = this.calculateWaitTime();
    if (waitTime > 0) {
      await this.sleep(waitTime);
    }
    this.recordRequest();
    return waitTime;
  }

  /**
   * Check if the daily limit has been reached.
   */
  isDayLimitReached(): boolean {
    this.resetDayIfNeeded();
    return this.state.dayRequests >= this.config.requestsPerDay;
  }

  /**
   * Get the current state for testing/debugging.
   */
  getState(): Readonly<RateLimiterState> {
    return { ...this.state };
  }

  /**
   * Get remaining requests for the day.
   */
  getRemainingDayRequests(): number {
    this.resetDayIfNeeded();
    return Math.max(0, this.config.requestsPerDay - this.state.dayRequests);
  }

  /**
   * Calculate how long to wait before the next request can be made.
   */
  private calculateWaitTime(): number {
    const now = this.nowFn();
    this.resetDayIfNeeded();
    this.pruneMinuteRequests(now);

    // Check day limit
    if (this.state.dayRequests >= this.config.requestsPerDay) {
      // Wait until next day
      const nextDay = this.state.dayStart + 24 * 60 * 60 * 1000;
      return nextDay - now;
    }

    // Check minute limit
    if (this.state.minuteRequests.length >= this.config.requestsPerMinute) {
      // Wait until oldest request expires from the minute window
      const oldestRequest = this.state.minuteRequests[0];
      const waitUntil = oldestRequest + 60 * 1000;
      return Math.max(0, waitUntil - now);
    }

    return 0;
  }

  /**
   * Record a request timestamp.
   */
  private recordRequest(): void {
    const now = this.nowFn();
    this.state.minuteRequests.push(now);
    this.state.dayRequests++;
  }

  /**
   * Remove requests older than 1 minute from the tracking array.
   */
  private pruneMinuteRequests(now: number): void {
    const oneMinuteAgo = now - 60 * 1000;
    this.state.minuteRequests = this.state.minuteRequests.filter(
      (timestamp) => timestamp > oneMinuteAgo
    );
  }

  /**
   * Reset day counter if a new day has started.
   */
  private resetDayIfNeeded(): void {
    const now = this.nowFn();
    const currentDayStart = this.getStartOfDay(now);
    if (currentDayStart > this.state.dayStart) {
      this.state.dayStart = currentDayStart;
      this.state.dayRequests = 0;
    }
  }

  /**
   * Get the start of the day (midnight) for a given timestamp.
   */
  private getStartOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Sleep for the specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a rate limiter from config.
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config);
}

import { RateLimiter } from "./rateLimiter";
import type { RateLimitConfig } from "../config";

describe("RateLimiter", () => {
  const baseConfig: RateLimitConfig = {
    requestsPerMinute: 3,
    requestsPerDay: 10,
    maxConsecutiveErrors: 5,
    cooldownOnErrorMs: 1000,
  };

  describe("waitIfNeeded", () => {
    it("should not wait when under rate limit", async () => {
      let currentTime = Date.now();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      const waitTime = await limiter.waitIfNeeded();
      expect(waitTime).toBe(0);
    });

    it("should track requests correctly", async () => {
      let currentTime = Date.now();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      await limiter.waitIfNeeded();
      await limiter.waitIfNeeded();

      const state = limiter.getState();
      expect(state.dayRequests).toBe(2);
      expect(state.minuteRequests.length).toBe(2);
    });
  });

  describe("isDayLimitReached", () => {
    it("should return false when under day limit", () => {
      let currentTime = Date.now();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      expect(limiter.isDayLimitReached()).toBe(false);
    });

    it("should return true when day limit is reached", async () => {
      let currentTime = Date.now();
      const nowFn = () => currentTime;
      const config: RateLimitConfig = { ...baseConfig, requestsPerDay: 2 };
      const limiter = new RateLimiter(config, nowFn);

      // Make 2 requests
      await limiter.waitIfNeeded();
      currentTime += 60000; // Move forward 1 minute to avoid RPM limit
      await limiter.waitIfNeeded();

      expect(limiter.isDayLimitReached()).toBe(true);
    });
  });

  describe("getRemainingDayRequests", () => {
    it("should return correct remaining requests", async () => {
      let currentTime = Date.now();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      expect(limiter.getRemainingDayRequests()).toBe(10);

      await limiter.waitIfNeeded();
      expect(limiter.getRemainingDayRequests()).toBe(9);

      await limiter.waitIfNeeded();
      expect(limiter.getRemainingDayRequests()).toBe(8);
    });
  });

  describe("rate limit calculation", () => {
    it("should calculate wait time when minute limit is reached", async () => {
      let currentTime = new Date("2025-01-18T10:00:00.000Z").getTime();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      // Make 3 requests (hits minute limit)
      await limiter.waitIfNeeded();
      await limiter.waitIfNeeded();
      await limiter.waitIfNeeded();

      // Check state
      const state = limiter.getState();
      expect(state.minuteRequests.length).toBe(3);
    });

    it("should reset day counter on new day", async () => {
      let currentTime = new Date("2025-01-18T23:59:00.000Z").getTime();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      await limiter.waitIfNeeded();
      expect(limiter.getRemainingDayRequests()).toBe(9);

      // Move to next day
      currentTime = new Date("2025-01-19T00:01:00.000Z").getTime();
      expect(limiter.getRemainingDayRequests()).toBe(10);
    });

    it("should prune old minute requests", async () => {
      let currentTime = new Date("2025-01-18T10:00:00.000Z").getTime();
      const nowFn = () => currentTime;
      const limiter = new RateLimiter(baseConfig, nowFn);

      // Make 3 requests
      await limiter.waitIfNeeded();
      await limiter.waitIfNeeded();
      await limiter.waitIfNeeded();

      expect(limiter.getState().minuteRequests.length).toBe(3);

      // Move forward 61 seconds
      currentTime += 61000;
      
      // Make another request - should prune old ones first
      await limiter.waitIfNeeded();
      
      // Old requests should be pruned, only new one remains
      expect(limiter.getState().minuteRequests.length).toBe(1);
    });
  });
});

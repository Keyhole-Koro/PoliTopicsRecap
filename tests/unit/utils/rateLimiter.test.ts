jest.mock('src/utils/timing', () => ({
  sleep: jest.fn(),
}));

import { TokenBucketRateLimiter } from 'src/utils/rateLimiter';

const { sleep } = jest.requireMock('src/utils/timing');

describe('TokenBucketRateLimiter', () => {
  let now = 0;
  let dateNowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    now = 0;
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    sleep.mockImplementation(async (ms: number) => {
      now += ms;
    });
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('consumes available tokens immediately', async () => {
    const limiter = new TokenBucketRateLimiter(5, 2);
    await limiter.acquire();
    await limiter.acquire();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits for tokens to refill when exhausted', async () => {
    const limiter = new TokenBucketRateLimiter(2, 2);
    await limiter.acquire();
    await limiter.acquire();

    const acquirePromise = limiter.acquire();
    expect(sleep).toHaveBeenCalledWith(500);
    await acquirePromise;

    expect(now).toBeGreaterThanOrEqual(500);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

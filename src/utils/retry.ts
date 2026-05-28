import { logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  label = "operation"
): Promise<T> {
  const { maxAttempts, delayMs, backoffFactor = 2, shouldRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (shouldRetry && !shouldRetry(err)) throw err;
      if (attempt === maxAttempts) break;

      const wait = delayMs * Math.pow(backoffFactor, attempt - 1);
      logger.warn({ label, attempt, maxAttempts, waitMs: wait }, "Retrying after failure");
      await sleep(wait);
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label = "operation"
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

import { RateLimiterMemory } from "rate-limiter-flexible";
import type { Request, Response, NextFunction } from "express";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

const chatLimiter = new RateLimiterMemory({
  points: config.RATE_LIMIT_REQUESTS_PER_MINUTE,
  duration: 60,
});

const evalLimiter = new RateLimiterMemory({
  points: 2,
  duration: 60,
});

export function chatRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (config.NODE_ENV === "development") return next();

  const key = req.ip ?? "unknown";
  chatLimiter
    .consume(key)
    .then(() => next())
    .catch(() => {
      logger.warn({ ip: key }, "Chat rate limit exceeded");
      res.status(429).json({
        error: "Too many requests",
        retryAfter: 60,
      });
    });
}

export function evalRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (config.NODE_ENV === "development") return next();

  const key = req.ip ?? "unknown";
  evalLimiter
    .consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({ error: "Eval rate limit exceeded. Max 2 runs per minute." });
    });
}

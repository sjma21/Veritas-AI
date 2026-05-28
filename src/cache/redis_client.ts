import Redis from "ioredis";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });

    redisClient.on("error", (err) => logger.error({ err }, "Redis connection error"));
    redisClient.on("connect", () => logger.info("Redis connected"));
    redisClient.on("reconnecting", () => logger.warn("Redis reconnecting"));
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

import { getRedisClient } from "./redis_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

export class CacheManager {
  private prefix: string;

  constructor(prefix = "veritas") {
    this.prefix = prefix;
  }

  private key(k: string): string {
    return `${this.prefix}:${k}`;
  }

  async get<T>(k: string): Promise<T | null> {
    try {
      const redis = getRedisClient();
      const raw = await redis.get(this.key(k));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err, key: k }, "Cache get failed");
      return null;
    }
  }

  async set(k: string, value: unknown, ttlSeconds = config.REDIS_TTL_SECONDS): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.set(this.key(k), JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      logger.warn({ err, key: k }, "Cache set failed");
    }
  }

  async del(k: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(this.key(k));
    } catch (err) {
      logger.warn({ err, key: k }, "Cache del failed");
    }
  }

  async exists(k: string): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const result = await redis.exists(this.key(k));
      return result === 1;
    } catch {
      return false;
    }
  }
}

export const cacheManager = new CacheManager();

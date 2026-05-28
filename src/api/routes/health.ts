import { Router, type Request, type Response } from "express";
import { getRedisClient } from "../../cache/redis_client.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response): Promise<void> => {
    const checks: Record<string, { status: "ok" | "error"; latencyMs?: number; message?: string }> = {};

    // Redis check
    try {
      const start = Date.now();
      const redis = getRedisClient();
      await redis.ping();
      checks.redis = { status: "ok", latencyMs: Date.now() - start };
    } catch (err) {
      checks.redis = { status: "error", message: err instanceof Error ? err.message : "Unknown" };
    }

    // ChromaDB check
    try {
      const start = Date.now();
      const resp = await fetch(`${config.CHROMA_URL}/api/v2/heartbeat`);
      checks.chromadb = {
        status: resp.ok ? "ok" : "error",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      checks.chromadb = {
        status: "error",
        message: err instanceof Error ? err.message : "Unreachable",
      };
    }

    const allOk = Object.values(checks).every((c) => c.status === "ok");

    res.status(allOk ? 200 : 503).json({
      status: allOk ? "healthy" : "degraded",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      services: checks,
      config: {
        model_cheap: config.MODEL_CHEAP,
        model_strong: config.MODEL_STRONG,
        agent_max_iterations: config.AGENT_MAX_ITERATIONS,
        retrieval_confidence_threshold: config.RETRIEVAL_CONFIDENCE_THRESHOLD,
      },
    });
  });

  return router;
}

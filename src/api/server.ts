import express from "express";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { VectorStore } from "../retrieval/vector_store.js";
import { MemoryManager } from "../memory/memory_manager.js";
import { createChatRouter } from "./routes/chat.js";
import { createEvalRouter } from "./routes/eval.js";
import { createHealthRouter } from "./routes/health.js";
import { createUploadRouter } from "./routes/upload.js";
import { chatRateLimit, evalRateLimit } from "./middleware/rate_limiter.js";
import { closeRedis } from "../cache/redis_client.js";
import { createInProcessMcpClient, type McpClient } from "../mcp/index.js";
import { SemanticCache } from "../cache/semantic_cache.js";
import { ChromaClient } from "chromadb";

export async function createServer(): Promise<{
  app: express.Express;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
          ip: req.ip,
        },
        "HTTP request"
      );
    });
    next();
  });

  // Error handling for JSON parse errors
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.message.includes("JSON")) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    next(err);
  });

  // Initialize services
  logger.info("Initializing services...");
  const vectorStore = new VectorStore();
  await vectorStore.initialize();
  const memoryManager = new MemoryManager(vectorStore);

  const semanticCache = new SemanticCache(new ChromaClient({ path: config.CHROMA_URL }));
  await semanticCache.initialize();

  let mcpClient: McpClient | undefined;
  try {
    mcpClient = await createInProcessMcpClient(vectorStore);
    logger.info("MCP corpus server connected in-process");
  } catch (err) {
    logger.warn({ err }, "MCP client failed to start — agent will run without MCP tools");
  }

  logger.info("Services initialized");

  // Routes
  app.use("/health", createHealthRouter());
  app.use("/upload", createUploadRouter(vectorStore));
  app.use("/chat", chatRateLimit, createChatRouter(vectorStore, memoryManager, mcpClient, semanticCache));
  app.use("/eval", evalRateLimit, createEvalRouter(vectorStore, memoryManager, mcpClient, semanticCache));

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled server error");
    res.status(500).json({ error: "Internal server error" });
  });

  const server = app.listen.bind(app);

  return {
    app,
    start: async () => {
      await new Promise<void>((resolve) => {
        server(config.PORT, () => {
          logger.info({ port: config.PORT, env: config.NODE_ENV }, "VeritasAI server started");
          resolve();
        });
      });
    },
    stop: async () => {
      await mcpClient?.close();
      await closeRedis();
      logger.info("Server stopped gracefully");
    },
  };
}

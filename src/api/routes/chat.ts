import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { ChatRequestSchema, type StreamEvent } from "../../schemas/output.js";
import { AgentOrchestrator } from "../../agents/orchestrator.js";
import { VectorStore } from "../../retrieval/vector_store.js";
import { MemoryManager } from "../../memory/memory_manager.js";
import { initSSE, sendSSEEvent, sendSSEDone } from "../../streaming/sse.js";
import { cacheManager } from "../../cache/cache_manager.js";
import { logger } from "../../utils/logger.js";
import type { McpClient } from "../../mcp/index.js";

export function createChatRouter(
  vectorStore: VectorStore,
  memoryManager: MemoryManager,
  mcpClient?: McpClient
): Router {
  const router = Router();
  const orchestrator = new AgentOrchestrator(vectorStore, memoryManager, mcpClient);

  router.post("/", async (req: Request, res: Response): Promise<void> => {
    const parseResult = ChatRequestSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid request", details: parseResult.error.format() });
      return;
    }

    const { message, stream } = parseResult.data;
    const sessionId = parseResult.data.session_id ?? uuidv4();

    // Load conversation history from cache
    const historyKey = `history:${sessionId}`;
    const history =
      (await cacheManager.get<{ role: string; content: string }[]>(historyKey)) ?? [];

    logger.info({ sessionId, message: message.slice(0, 50), stream }, "Chat request received");

    if (stream) {
      initSSE(res);

      const emit = (event: StreamEvent) => sendSSEEvent(res, event);

      try {
        const result = await orchestrator.run({
          userMessage: message,
          sessionId,
          conversationHistory: history as any,
          stream: true,
          emit,
        });

        // Update conversation history
        const updatedHistory = [
          ...history,
          { role: "user", content: message },
          { role: "assistant", content: result.output.answer },
        ].slice(-20); // Keep last 20 turns

        await cacheManager.set(historyKey, updatedHistory);

        sendSSEDone(res);
      } catch (err) {
        logger.error({ err, sessionId }, "Chat stream error");
        sendSSEEvent(res, {
          type: "error",
          message: err instanceof Error ? err.message : "Internal server error",
        });
        sendSSEDone(res);
      }
    } else {
      // Non-streaming JSON response
      try {
        const events: StreamEvent[] = [];
        const emit = (event: StreamEvent) => events.push(event);

        const result = await orchestrator.run({
          userMessage: message,
          sessionId,
          conversationHistory: history as any,
          stream: false,
          emit,
        });

        const updatedHistory = [
          ...history,
          { role: "user", content: message },
          { role: "assistant", content: result.output.answer },
        ].slice(-20);

        await cacheManager.set(historyKey, updatedHistory);

        res.json({
          session_id: sessionId,
          output: result.output,
          meta: {
            iterations: result.iterationsUsed,
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            estimated_cost_usd: result.estimatedCostUsd,
          },
        });
      } catch (err) {
        logger.error({ err, sessionId }, "Chat error");
        res.status(500).json({
          error: err instanceof Error ? err.message : "Internal server error",
        });
      }
    }
  });

  return router;
}

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { EVAL_DATASET } from "../../evaluation/dataset.js";
import { AgentOrchestrator } from "../../agents/orchestrator.js";
import { VectorStore } from "../../retrieval/vector_store.js";
import { MemoryManager } from "../../memory/memory_manager.js";
import { AgentOutputSchema, type EvalResult, type StreamEvent } from "../../schemas/output.js";
import { logger } from "../../utils/logger.js";

function scoreCitationQuality(citations: string[], expected: string[]): 0 | 1 | 2 {
  if (expected.length === 0) return 2;
  if (citations.length === 0) return 0;
  const matched = citations.filter((c) => expected.includes(c)).length;
  if (matched >= expected.length) return 2;
  if (matched > 0) return 1;
  return 0;
}

export function createEvalRouter(
  vectorStore: VectorStore,
  memoryManager: MemoryManager
): Router {
  const router = Router();
  const orchestrator = new AgentOrchestrator(vectorStore, memoryManager);

  router.post("/run", async (req: Request, res: Response): Promise<void> => {
    const tierFilter = req.body?.tier as number | undefined;
    const questions = tierFilter
      ? EVAL_DATASET.filter((q) => q.tier === tierFilter)
      : EVAL_DATASET;

    logger.info({ total: questions.length, tier: tierFilter }, "Starting evaluation run");

    const results: EvalResult[] = [];

    for (const question of questions) {
      const startTime = Date.now();
      const sessionId = uuidv4();
      const events: StreamEvent[] = [];

      try {
        const result = await orchestrator.run({
          userMessage: question.question,
          sessionId,
          conversationHistory: [],
          emit: (e) => events.push(e),
        });

        const latency = Date.now() - startTime;
        const output = result.output;
        const schemaValid = AgentOutputSchema.safeParse(output).success;
        const citationQuality = scoreCitationQuality(output.citations, question.expectedCitationIds);

        const toolUsed = question.requiresTool
          ? events.some((e) => e.type === "tool_call" && e.tool === question.requiresTool)
          : true;

        const pass =
          schemaValid &&
          output.confidence >= 0.15 &&
          (question.expectedCitationIds.length === 0 ||
            question.expectedCitationIds.some((id) => output.citations.includes(id))) &&
          toolUsed;

        results.push({
          question: question.question,
          expected_tier: question.tier,
          pass,
          citation_quality: citationQuality,
          schema_valid: schemaValid,
          latency_ms: latency,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          estimated_cost_usd: result.estimatedCostUsd,
          answer_preview: output.answer.slice(0, 100),
        });
      } catch (err) {
        results.push({
          question: question.question,
          expected_tier: question.tier,
          pass: false,
          citation_quality: 0,
          schema_valid: false,
          latency_ms: Date.now() - startTime,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          answer_preview: "",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalPass = results.filter((r) => r.pass).length;
    const schemaValidPct = (results.filter((r) => r.schema_valid).length / results.length) * 100;
    const totalCost = results.reduce((s, r) => s + r.estimated_cost_usd, 0);

    res.json({
      summary: {
        total: results.length,
        passed: totalPass,
        failed: results.length - totalPass,
        schema_validity_pct: schemaValidPct,
        total_cost_usd: totalCost,
      },
      results,
    });
  });

  return router;
}

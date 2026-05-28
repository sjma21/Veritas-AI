import { createObjectCsvWriter } from "csv-writer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { EVAL_DATASET, type EvalQuestion } from "./dataset.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";
import { VectorStore } from "../retrieval/vector_store.js";
import { MemoryManager } from "../memory/memory_manager.js";
import { AgentOutputSchema, type EvalResult, type StreamEvent } from "../schemas/output.js";
import { estimateCost } from "../utils/token_counter.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

async function runEvaluation(): Promise<void> {
  console.log("=== VeritasAI Evaluation Framework ===\n");

  const vectorStore = new VectorStore();
  await vectorStore.initialize();

  const memoryManager = new MemoryManager(vectorStore);
  const orchestrator = new AgentOrchestrator(vectorStore, memoryManager);

  const results: EvalResult[] = [];
  const tierCounts = { 1: { pass: 0, total: 0 }, 2: { pass: 0, total: 0 }, 3: { pass: 0, total: 0 } };
  let schemaValidCount = 0;

  for (const question of EVAL_DATASET) {
    console.log(`\n[${question.id}] Tier ${question.tier}: ${question.question}`);

    const startTime = Date.now();
    const sessionId = uuidv4();
    const events: StreamEvent[] = [];

    try {
      const runResult = await orchestrator.run({
        userMessage: question.question,
        sessionId,
        conversationHistory: [],
        emit: (event) => events.push(event),
      });

      const latency = Date.now() - startTime;
      const output = runResult.output;

      // Schema validation
      const schemaValid = AgentOutputSchema.safeParse(output).success;
      if (schemaValid) schemaValidCount++;

      // Citation quality scoring
      const citationQuality = scoreCitationQuality(
        output.citations,
        question.expectedCitationIds
      );

      // Pass/fail determination
      const pass = determinePass(question, output, events, schemaValid);

      tierCounts[question.tier].total++;
      if (pass) tierCounts[question.tier].pass++;

      const evalResult: EvalResult = {
        question: question.question,
        expected_tier: question.tier,
        pass,
        citation_quality: citationQuality,
        schema_valid: schemaValid,
        latency_ms: latency,
        input_tokens: runResult.inputTokens,
        output_tokens: runResult.outputTokens,
        estimated_cost_usd: runResult.estimatedCostUsd,
        answer_preview: output.answer.slice(0, 100),
      };

      results.push(evalResult);

      const status = pass ? "✅ PASS" : "❌ FAIL";
      console.log(
        `  ${status} | Confidence: ${output.confidence.toFixed(2)} | Citations: ${output.citations.join(", ") || "none"} | Quality: ${citationQuality}/2 | ${latency}ms`
      );
    } catch (err) {
      const latency = Date.now() - startTime;
      logger.error({ err, questionId: question.id }, "Eval question failed with exception");

      tierCounts[question.tier].total++;

      results.push({
        question: question.question,
        expected_tier: question.tier,
        pass: false,
        citation_quality: 0,
        schema_valid: false,
        latency_ms: latency,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        answer_preview: "",
        error: err instanceof Error ? err.message : "Unknown error",
      });

      console.log(`  ❌ ERROR: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  // Write CSV
  const csvPath = path.join(process.cwd(), "eval_results.csv");
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: "question", title: "question" },
      { id: "expected_tier", title: "expected_tier" },
      { id: "pass", title: "pass" },
      { id: "citation_quality", title: "citation_quality" },
      { id: "schema_valid", title: "schema_valid" },
      { id: "latency_ms", title: "latency_ms" },
      { id: "input_tokens", title: "input_tokens" },
      { id: "output_tokens", title: "output_tokens" },
      { id: "estimated_cost_usd", title: "estimated_cost_usd" },
      { id: "answer_preview", title: "answer_preview" },
      { id: "error", title: "error" },
    ],
  });

  await csvWriter.writeRecords(results);

  // Print summary
  const totalQuestions = results.length;
  const totalPass = results.filter((r) => r.pass).length;
  const schemaValidity = (schemaValidCount / totalQuestions) * 100;
  const totalCost = results.reduce((s, r) => s + r.estimated_cost_usd, 0);

  console.log("\n═══════════════════════════════════════════");
  console.log("EVALUATION SUMMARY");
  console.log("═══════════════════════════════════════════");
  console.log(`Total:           ${totalPass}/${totalQuestions} passed`);
  console.log(`Tier 1:          ${tierCounts[1].pass}/${tierCounts[1].total} (target: 4/5)`);
  console.log(`Tier 2:          ${tierCounts[2].pass}/${tierCounts[2].total} (target: 3/5)`);
  console.log(`Tier 3:          ${tierCounts[3].pass}/${tierCounts[3].total} (target: 2/5)`);
  console.log(`Schema validity: ${schemaValidity.toFixed(1)}% (target: ≥85%)`);
  console.log(`Total cost:      $${totalCost.toFixed(4)}`);
  console.log(`\nResults written to: ${csvPath}`);

  const tier1Pass = tierCounts[1].pass >= 4;
  const tier2Pass = tierCounts[2].pass >= 3;
  const tier3Pass = tierCounts[3].pass >= 2;
  const schemaPass = schemaValidity >= 85;

  console.log("\nThreshold checks:");
  console.log(`  Tier 1 ≥4/5:    ${tier1Pass ? "✅" : "❌"}`);
  console.log(`  Tier 2 ≥3/5:    ${tier2Pass ? "✅" : "❌"}`);
  console.log(`  Tier 3 ≥2/5:    ${tier3Pass ? "✅" : "❌"}`);
  console.log(`  Schema ≥85%:    ${schemaPass ? "✅" : "❌"}`);

  process.exit(tier1Pass && tier2Pass && tier3Pass && schemaPass ? 0 : 1);
}

function scoreCitationQuality(citations: string[], expected: string[]): 0 | 1 | 2 {
  if (expected.length === 0) return 2;
  if (citations.length === 0) return 0;
  const matched = citations.filter((c) => expected.includes(c)).length;
  if (matched >= expected.length) return 2;
  if (matched > 0) return 1;
  return 0;
}

function determinePass(
  question: EvalQuestion,
  output: { answer: string; citations: string[]; confidence: number },
  events: StreamEvent[],
  schemaValid: boolean
): boolean {
  if (!schemaValid) return false;
  if (output.confidence < 0.15) return false;

  // Must not be the pure "I don't know" fallback for non-ambiguous questions
  if (output.answer.startsWith("I don't know") && question.expectedCitationIds.length > 0) {
    return false;
  }

  // Check tool usage if required
  if (question.requiresTool) {
    const toolUsed = events.some(
      (e) => e.type === "tool_call" && e.tool === question.requiresTool
    );
    if (!toolUsed) return false;
  }

  // Check that at least one expected citation is present (if any expected)
  if (question.expectedCitationIds.length > 0) {
    const hasAnyCitation = question.expectedCitationIds.some((id) =>
      output.citations.includes(id)
    );
    if (!hasAnyCitation) return false;
  }

  // For contradiction question, check it's acknowledged
  if (question.id === "t1-004") {
    const mentionsContradiction =
      output.answer.toLowerCase().includes("contradict") ||
      output.answer.toLowerCase().includes("conflict") ||
      output.answer.toLowerCase().includes("disagree");
    if (!mentionsContradiction) return false;
  }

  return true;
}

runEvaluation().catch((err) => {
  console.error("Fatal evaluation error:", err);
  process.exit(1);
});

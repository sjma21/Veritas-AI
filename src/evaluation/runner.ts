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
  // Tier filter: EVAL_TIER_FILTER=1,2 runs only those tiers (used in CI to skip Tier 3 web search)
  const tierFilter = config.EVAL_TIER_FILTER
    ? new Set(config.EVAL_TIER_FILTER.split(",").map((t) => parseInt(t.trim(), 10)))
    : null;

  const questions = tierFilter
    ? EVAL_DATASET.filter((q) => tierFilter.has(q.tier))
    : EVAL_DATASET;

  const tierLabel = tierFilter ? `Tiers ${[...tierFilter].join("+")}` : "All Tiers";
  console.log(`=== VeritasAI Evaluation Framework === (${tierLabel}, ${questions.length} questions)\n`);

  const vectorStore = new VectorStore();
  await vectorStore.initialize();

  const memoryManager = new MemoryManager(vectorStore);
  const orchestrator = new AgentOrchestrator(vectorStore, memoryManager);

  const results: EvalResult[] = [];
  const tierCounts = { 1: { pass: 0, total: 0 }, 2: { pass: 0, total: 0 }, 3: { pass: 0, total: 0 } };
  let schemaValidCount = 0;

  for (const question of questions) {
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

  // Use config-driven thresholds so CI can tighten or relax them via env
  const minTier1 = tierFilter && !tierFilter.has(1) ? 0 : config.EVAL_MIN_TIER1_PASS;
  const minTier2 = tierFilter && !tierFilter.has(2) ? 0 : config.EVAL_MIN_TIER2_PASS;
  const minTier3 = tierFilter && !tierFilter.has(3) ? 0 : config.EVAL_MIN_TIER3_PASS;

  const tier1Pass = tierCounts[1].pass >= minTier1;
  const tier2Pass = tierCounts[2].pass >= minTier2;
  const tier3Pass = tierCounts[3].pass >= minTier3;
  const schemaPass = schemaValidity >= config.EVAL_MIN_SCHEMA_PCT;
  const overallPassed = tier1Pass && tier2Pass && tier3Pass && schemaPass;

  const avgLatencyMs = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / results.length)
    : 0;
  const avgCitationQuality = results.length > 0
    ? results.reduce((s, r) => s + r.citation_quality, 0) / results.length
    : 0;

  console.log("\n═══════════════════════════════════════════");
  console.log("EVALUATION SUMMARY");
  console.log("═══════════════════════════════════════════");
  console.log(`Total:           ${totalPass}/${totalQuestions} passed`);
  if (tierCounts[1].total > 0) console.log(`Tier 1:          ${tierCounts[1].pass}/${tierCounts[1].total} (min: ${minTier1})`);
  if (tierCounts[2].total > 0) console.log(`Tier 2:          ${tierCounts[2].pass}/${tierCounts[2].total} (min: ${minTier2})`);
  if (tierCounts[3].total > 0) console.log(`Tier 3:          ${tierCounts[3].pass}/${tierCounts[3].total} (min: ${minTier3})`);
  console.log(`Schema validity: ${schemaValidity.toFixed(1)}% (min: ${config.EVAL_MIN_SCHEMA_PCT}%)`);
  console.log(`Avg latency:     ${avgLatencyMs}ms`);
  console.log(`Avg citation Q:  ${avgCitationQuality.toFixed(2)}/2`);
  console.log(`Total cost:      $${totalCost.toFixed(4)}`);
  console.log(`\nResults written to: ${csvPath}`);

  console.log("\nThreshold checks:");
  if (tierCounts[1].total > 0) console.log(`  Tier 1 ≥${minTier1}/${tierCounts[1].total}: ${tier1Pass ? "✅" : "❌"}`);
  if (tierCounts[2].total > 0) console.log(`  Tier 2 ≥${minTier2}/${tierCounts[2].total}: ${tier2Pass ? "✅" : "❌"}`);
  if (tierCounts[3].total > 0) console.log(`  Tier 3 ≥${minTier3}/${tierCounts[3].total}: ${tier3Pass ? "✅" : "❌"}`);
  console.log(`  Schema ≥${config.EVAL_MIN_SCHEMA_PCT}%:  ${schemaPass ? "✅" : "❌"}`);
  console.log(`\nOverall: ${overallPassed ? "✅ PASSED" : "❌ FAILED — quality gate not met"}`);

  // Write metadata JSON for the CI summary script
  const metaPath = path.join(process.cwd(), "eval_meta.json");
  const fs = await import("fs/promises");
  await fs.writeFile(metaPath, JSON.stringify({
    passed: overallPassed,
    totalPass, totalQuestions,
    tierCounts,
    schemaValidity,
    avgLatencyMs,
    avgCitationQuality,
    totalCostUsd: totalCost,
    tierFilter: config.EVAL_TIER_FILTER ?? "all",
    thresholds: { minTier1, minTier2, minTier3, minSchemaPct: config.EVAL_MIN_SCHEMA_PCT },
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? "local",
  }, null, 2));

  process.exit(overallPassed ? 0 : 1);
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

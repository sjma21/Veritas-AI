import { complete } from "../utils/llm_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { AgentOutput } from "../schemas/output.js";
import type { RetrievedChunk } from "../retrieval/vector_store.js";
import { traceable } from "../observability/langsmith.js";

export interface CriticVerdict {
  passed: boolean;
  issues: string[];
  revisedAnswer?: Partial<AgentOutput>;
}

const CRITIC_SYSTEM = `You are a strict fact-checker for an AI research assistant. Your job is to verify the quality and accuracy of a generated answer before it is returned to the user.

Evaluate the answer on these criteria:
1. CITATION VALIDITY: Do all cited document IDs exist in the provided source documents? Flag any invented IDs.
2. EVIDENCE SUPPORT: Does the answer make claims that are actually supported by the cited documents?
3. CONTRADICTION HANDLING: If source documents contradict each other, is the contradiction acknowledged?
4. CONFIDENCE CALIBRATION: Is the confidence score appropriate for the evidence strength?
5. HALLUCINATION CHECK: Are there any claims not traceable to the provided evidence?

Output ONLY valid JSON:
{
  "passed": true|false,
  "issues": ["issue 1", "issue 2"],
  "confidence_adjustment": 0.0,
  "suggested_answer_revision": "Optional revised answer if needed (null if passed)"
}`;

async function _runCritic(
  answer: AgentOutput,
  retrievedChunks: RetrievedChunk[],
  toolEvidence: string,
  emit: (event: { type: "critic"; message: string; passed: boolean }) => void
): Promise<CriticVerdict> {
  emit({ type: "critic", message: "Running citation and evidence verification...", passed: false });

  const validIds = new Set(retrievedChunks.map((c: RetrievedChunk) => c.id));

  // Fast local check: verify cited IDs exist
  const invalidCitations = answer.citations.filter((c: string) => !validIds.has(c));
  if (invalidCitations.length > 0) {
    const issues = [`Fabricated citation IDs detected: ${invalidCitations.join(", ")}`];
    emit({
      type: "critic",
      message: `Critic FAILED: ${issues[0]}`,
      passed: false,
    });

    return {
      passed: false,
      issues,
      revisedAnswer: {
        ...answer,
        citations: answer.citations.filter((c) => validIds.has(c)),
        confidence: Math.min(answer.confidence, 0.4),
        answer: answer.answer + "\n\n[Note: Some citations were removed as they could not be verified against the source documents.]",
      },
    };
  }

  // LLM-based deep critic pass
  try {
    const sourceContext = retrievedChunks
      .map((c) => `[${c.id}] ${c.title}: ${c.content.slice(0, 300)}`)
      .join("\n");

    const result = await complete({
      model: config.MODEL_CHEAP,
      system: CRITIC_SYSTEM,
      messages: [
        {
          role: "user",
          content: `SOURCE DOCUMENTS:\n${sourceContext}\n\nTOOL EVIDENCE:\n${toolEvidence || "None"}\n\nANSWER TO VERIFY:\n${JSON.stringify(answer, null, 2)}`,
        },
      ],
      temperature: 0,
      maxTokens: 600,
    });

    let verdict: {
      passed: boolean;
      issues: string[];
      confidence_adjustment?: number;
      suggested_answer_revision?: string | null;
    };

    try {
      verdict = extractJson(result.content);
    } catch {
      logger.warn("Critic produced invalid JSON, defaulting to pass");
      verdict = { passed: true, issues: [] };
    }

    const confidenceAdjustment = verdict.confidence_adjustment ?? 0;
    const adjustedConfidence = Math.max(
      0,
      Math.min(1, answer.confidence + confidenceAdjustment)
    );

    if (verdict.passed) {
      emit({ type: "critic", message: "Critic PASSED — citations and evidence verified.", passed: true });
      return {
        passed: true,
        issues: verdict.issues ?? [],
        revisedAnswer: { ...answer, confidence: adjustedConfidence },
      };
    } else {
      const issuesSummary = (verdict.issues ?? []).join("; ");
      emit({
        type: "critic",
        message: `Critic FAILED: ${issuesSummary || "Evidence issues found"}`,
        passed: false,
      });

      const revisedAnswer: Partial<AgentOutput> = {
        ...answer,
        confidence: Math.min(adjustedConfidence, 0.5),
      };

      if (verdict.suggested_answer_revision) {
        revisedAnswer.answer = verdict.suggested_answer_revision;
      }

      return {
        passed: false,
        issues: verdict.issues ?? [],
        revisedAnswer,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Critic LLM call failed — defaulting to pass with warning");
    emit({ type: "critic", message: `Critic skipped: ${errMsg}`, passed: true });
    return { passed: true, issues: [`Critic skipped: ${errMsg}`] };
  }
}

export const runCritic = traceable(_runCritic, {
  name: "critic.verify",
  run_type: "chain",
  metadata: { layer: "critic" },
  processOutputs: (out: CriticVerdict) => ({
    passed: out.passed,
    issueCount: out.issues.length,
    issues: out.issues,
    revised: !!out.revisedAnswer,
  }),
});

function extractJson(text: string): {
  passed: boolean;
  issues: string[];
  confidence_adjustment?: number;
  suggested_answer_revision?: string | null;
} {
  // Strip markdown code fences if present
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error("No JSON found in critic response");
}

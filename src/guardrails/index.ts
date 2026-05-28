import { redact } from "./pii_redactor.js";
import { detectInjection } from "./injection_detector.js";
import { moderateContent } from "./content_moderator.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { traceable } from "../observability/langsmith.js";
import type { StreamEvent } from "../schemas/output.js";

export interface GuardrailViolation {
  check: "pii" | "injection" | "content";
  action: "redacted" | "blocked" | "warned";
  detail: string;
}

export interface GuardrailResult {
  allowed: boolean;          // false = request must be blocked
  sanitizedText: string;     // use this instead of the original
  violations: GuardrailViolation[];
}

type Emitter = (event: StreamEvent) => void;

async function _checkInput(text: string, emit?: Emitter): Promise<GuardrailResult> {
  if (!config.GUARDRAILS_ENABLED) {
    return { allowed: true, sanitizedText: text, violations: [] };
  }

  let sanitized = text;
  const violations: GuardrailViolation[] = [];

  // ── 1. PII Redaction ──────────────────────────────────────────────────────
  if (config.GUARDRAILS_PII_ENABLED) {
    const piiResult = redact(sanitized);
    if (piiResult.changed) {
      sanitized = piiResult.text;
      const types = [...new Set(piiResult.findings.map((f) => f.type))].join(", ");
      const v: GuardrailViolation = { check: "pii", action: "redacted", detail: `Redacted: ${types}` };
      violations.push(v);
      emit?.({ type: "guardrail", ...v });
      logger.info({ types, count: piiResult.findings.length }, "Input PII redacted");
    }
  }

  // ── 2. Prompt Injection Detection ─────────────────────────────────────────
  if (config.GUARDRAILS_INJECTION_ENABLED) {
    const injResult = await detectInjection(sanitized);
    if (injResult.blocked) {
      const v: GuardrailViolation = {
        check: "injection",
        action: "blocked",
        detail: `Injection attempt detected (score ${injResult.score.toFixed(2)})${injResult.triggeredPatterns.length ? `: ${injResult.triggeredPatterns.join(", ")}` : ""}`,
      };
      violations.push(v);
      emit?.({ type: "guardrail", ...v });
      return { allowed: false, sanitizedText: sanitized, violations };
    } else if (injResult.score > 0.3) {
      const v: GuardrailViolation = {
        check: "injection",
        action: "warned",
        detail: `Low-confidence injection signal (score ${injResult.score.toFixed(2)})`,
      };
      violations.push(v);
      emit?.({ type: "guardrail", ...v });
    }
  }

  // ── 3. Content Moderation ─────────────────────────────────────────────────
  if (config.GUARDRAILS_CONTENT_ENABLED) {
    const modResult = await moderateContent(sanitized, "input");
    if (!modResult.safe) {
      const v: GuardrailViolation = {
        check: "content",
        action: "blocked",
        detail: `Unsafe content: ${modResult.categories.join(", ")} — ${modResult.reason}`,
      };
      violations.push(v);
      emit?.({ type: "guardrail", ...v });
      return { allowed: false, sanitizedText: sanitized, violations };
    }
  }

  return { allowed: true, sanitizedText: sanitized, violations };
}

async function _checkOutput(text: string, emit?: Emitter): Promise<GuardrailResult> {
  if (!config.GUARDRAILS_ENABLED) {
    return { allowed: true, sanitizedText: text, violations: [] };
  }

  let sanitized = text;
  const violations: GuardrailViolation[] = [];

  // ── 1. PII Redaction on generated answer ─────────────────────────────────
  if (config.GUARDRAILS_PII_ENABLED) {
    const piiResult = redact(sanitized);
    if (piiResult.changed) {
      sanitized = piiResult.text;
      const types = [...new Set(piiResult.findings.map((f) => f.type))].join(", ");
      const v: GuardrailViolation = { check: "pii", action: "redacted", detail: `Output PII redacted: ${types}` };
      violations.push(v);
      emit?.({ type: "guardrail", ...v });
      logger.warn({ types }, "PII found in agent output — redacted");
    }
  }

  // ── 2. Output Content Moderation ─────────────────────────────────────────
  if (config.GUARDRAILS_CONTENT_ENABLED) {
    const modResult = await moderateContent(sanitized, "output");
    if (!modResult.safe) {
      // Don't block — replace with safe fallback and warn
      const v: GuardrailViolation = {
        check: "content",
        action: "warned",
        detail: `Output flagged: ${modResult.categories.join(", ")} — ${modResult.reason}`,
      };
      violations.push(v);
      emit?.({ type: "guardrail", ...v });
      logger.warn({ categories: modResult.categories }, "Unsafe content in agent output");
      sanitized = "I'm unable to provide that response. Please rephrase your question.";
    }
  }

  return { allowed: true, sanitizedText: sanitized, violations };
}

export const checkInput = traceable(_checkInput, {
  name: "guardrail.input",
  run_type: "chain",
  metadata: { layer: "guardrails" },
  processOutputs: (out: GuardrailResult) => ({
    allowed: out.allowed,
    violationCount: out.violations.length,
    violations: out.violations.map((v) => v.check),
  }),
});

export const checkOutput = traceable(_checkOutput, {
  name: "guardrail.output",
  run_type: "chain",
  metadata: { layer: "guardrails" },
  processOutputs: (out: GuardrailResult) => ({
    allowed: out.allowed,
    violationCount: out.violations.length,
  }),
});

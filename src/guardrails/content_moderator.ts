/**
 * Content Moderator — LLM-based, applied to both input and output.
 *
 * Classifies text into safety categories. One cheap LLM call per check.
 * Returns safe=true for normal research questions, false for genuinely harmful content.
 */

import { complete } from "../utils/llm_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { traceable } from "../observability/langsmith.js";

export type ContentCategory =
  | "safe"
  | "harassment"
  | "violence"
  | "self_harm"
  | "illegal_activity"
  | "explicit_content"
  | "other_unsafe";

export interface ModerationResult {
  safe: boolean;
  categories: ContentCategory[];
  reason: string;
}

const MODERATION_SYSTEM = `You are a content safety classifier for an AI research assistant. Assess whether the text is safe to process.

Flag as UNSAFE only for genuinely harmful content:
- Harassment or hate speech targeting individuals/groups
- Instructions for violence or illegal activities
- Self-harm or suicide encouragement
- Explicit sexual content
- Requests to help commit crimes

Normal research questions, technical topics, sensitive-but-legitimate queries, and edge cases should be SAFE.
Be liberal — only block clear violations.

Output ONLY valid JSON:
{
  "safe": true|false,
  "categories": [],
  "reason": "one sentence"
}
Categories (only include if unsafe): "harassment", "violence", "self_harm", "illegal_activity", "explicit_content", "other_unsafe"`;

async function _moderateContent(
  text: string,
  direction: "input" | "output"
): Promise<ModerationResult> {
  try {
    const result = await complete({
      model: config.MODEL_CHEAP,
      system: MODERATION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `[${direction.toUpperCase()}]\n${text.slice(0, 1000)}`,
        },
      ],
      temperature: 0,
      maxTokens: 100,
    });

    const stripped = result.content.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(stripped) as {
      safe: boolean;
      categories?: string[];
      reason?: string;
    };

    const modResult: ModerationResult = {
      safe: parsed.safe ?? true,
      categories: (parsed.categories ?? []) as ContentCategory[],
      reason: parsed.reason ?? "",
    };

    if (!modResult.safe) {
      logger.warn({ direction, categories: modResult.categories, reason: modResult.reason }, "Content moderation flagged");
    }

    return modResult;
  } catch (err) {
    // On error, default to safe — don't block legitimate requests due to classifier failures
    logger.warn({ err, direction }, "Content moderation failed — defaulting to safe");
    return { safe: true, categories: [], reason: "Moderation check skipped due to error" };
  }
}

export const moderateContent = traceable(_moderateContent, {
  name: "guardrail.content_moderator",
  run_type: "chain",
  metadata: { layer: "guardrails" },
  processOutputs: (out: ModerationResult) => ({ safe: out.safe, categories: out.categories }),
});

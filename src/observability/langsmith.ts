/**
 * LangSmith observability setup.
 *
 * Tracing is enabled when LANGSMITH_API_KEY is set.
 * Set LANGSMITH_TRACING=false to disable even when the key is present.
 *
 * Context propagates automatically: any traceable() function called inside
 * another traceable() becomes a child span — no manual parent wiring needed.
 */
import { traceable } from "langsmith/traceable";
import { logger } from "../utils/logger.js";

export { traceable };

export function isEnabled(): boolean {
  return !!(
    process.env.LANGSMITH_API_KEY &&
    process.env.LANGSMITH_TRACING !== "false"
  );
}

if (isEnabled()) {
  logger.info(
    { project: process.env.LANGSMITH_PROJECT ?? "veritas-ai" },
    "LangSmith tracing enabled"
  );
}

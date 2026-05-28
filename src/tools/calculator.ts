import { evaluate } from "mathjs";
import { logger } from "../utils/logger.js";
import { truncateToTokenLimit } from "../utils/token_counter.js";
import { config } from "../config/index.js";
import { traceable } from "../observability/langsmith.js";

async function _calculator(expression: string): Promise<string> {
  logger.debug({ expression }, "calculator tool invoked");

  try {
    // mathjs evaluate is safe — it does not call eval() on arbitrary JS
    const result = evaluate(expression);

    const output = {
      expression,
      result: String(result),
      type: typeof result,
    };

    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  } catch (err) {
    const output = {
      expression,
      error: err instanceof Error ? err.message : "Evaluation failed",
      result: null,
    };
    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  }
}

export const calculator = traceable(_calculator, {
  name: "tool.calculator",
  run_type: "tool",
  metadata: { layer: "tools" },
});

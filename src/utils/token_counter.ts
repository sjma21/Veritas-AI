/**
 * Lightweight token estimation (≈4 chars/token for English).
 * Used for budgeting and truncation without loading a full tokenizer at cold start.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated]";
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  // Pricing per 1M tokens (USD)
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-3-haiku-20240307":    { input: 0.25,  output: 1.25 },
    "claude-haiku-4-5-20251001":  { input: 0.80,  output: 4.00 },
    "openai/text-embedding-3-small": { input: 0.02, output: 0 },
  };

  const rates = pricing[model] ?? { input: 1.0, output: 3.0 };
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

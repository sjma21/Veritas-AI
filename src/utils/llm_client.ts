import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config/index.js";
import { logger } from "./logger.js";
import { estimateCost, estimateTokens } from "./token_counter.js";
import { withRetry } from "./retry.js";

// ── Clients ───────────────────────────────────────────────────────────────────

export const anthropicClient = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

// OpenRouter client — embeddings only (Anthropic has no embeddings API)
export const embedClient = new OpenAI({
  apiKey: config.OPENROUTER_API_KEY || "embeddings-only",
  baseURL: config.OPENROUTER_BASE_URL,
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type SimpleMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface CompletionOptions {
  model: string;
  system?: string;
  messages: SimpleMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: AnthropicTool[];
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  toolUse?: ToolUseBlock;
  stopReason: string;
}

// ── Complete ──────────────────────────────────────────────────────────────────

export async function complete(options: CompletionOptions): Promise<CompletionResult> {
  return withRetry(
    async () => {
      const resp = await anthropicClient.messages.create({
        model: options.model,
        system: options.system,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1024,
        tools: options.tools as Anthropic.Tool[] | undefined,
      });

      const inputTokens = resp.usage.input_tokens;
      const outputTokens = resp.usage.output_tokens;
      const cost = estimateCost(inputTokens, outputTokens, options.model);

      // Extract text content
      const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      const content = textBlock?.text ?? "";

      // Extract tool use if present
      const toolBlock = resp.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const toolUse: ToolUseBlock | undefined = toolBlock
        ? { id: toolBlock.id, name: toolBlock.name, input: toolBlock.input as Record<string, unknown> }
        : undefined;

      logger.debug(
        { model: options.model, inputTokens, outputTokens, cost, stopReason: resp.stop_reason },
        "Anthropic call complete"
      );

      return {
        content,
        inputTokens,
        outputTokens,
        cost,
        toolUse,
        stopReason: resp.stop_reason ?? "end_turn",
      };
    },
    { maxAttempts: 3, delayMs: 1000 },
    "llm-complete"
  );
}

// ── Stream ────────────────────────────────────────────────────────────────────

export async function streamComplete(
  options: CompletionOptions,
  onToken: (token: string) => void
): Promise<{ fullContent: string; inputTokens: number; outputTokens: number }> {
  return withRetry(
    async () => {
      let fullContent = "";

      const stream = anthropicClient.messages.stream({
        model: options.model,
        system: options.system,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1024,
      });

      stream.on("text", (text) => {
        fullContent += text;
        onToken(text);
      });

      const finalMsg = await stream.finalMessage();

      return {
        fullContent,
        inputTokens: finalMsg.usage.input_tokens,
        outputTokens: finalMsg.usage.output_tokens,
      };
    },
    { maxAttempts: 2, delayMs: 1000 },
    "llm-stream"
  );
}

// ── Embed ─────────────────────────────────────────────────────────────────────

export async function embed(texts: string[]): Promise<number[][]> {
  return withRetry(
    async () => {
      const resp = await embedClient.embeddings.create({
        model: config.MODEL_EMBED,
        input: texts,
      });
      return resp.data.map((d: { embedding: number[] }) => d.embedding);
    },
    { maxAttempts: 3, delayMs: 500 },
    "llm-embed"
  );
}

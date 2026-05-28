import { z } from "zod";

export const AgentOutputSchema = z.object({
  answer: z.string().min(1, "Answer must not be empty"),
  citations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  follow_up_questions: z.array(z.string()).max(5),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("retrieval"), message: z.string(), data: z.unknown().optional() }),
  z.object({ type: z.literal("tool_call"), tool: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("tool_result"), tool: z.string(), output: z.string() }),
  z.object({ type: z.literal("critic"), message: z.string(), passed: z.boolean() }),
  z.object({ type: z.literal("token"), content: z.string() }),
  z.object({ type: z.literal("final"), output: AgentOutputSchema }),
  z.object({ type: z.literal("cache_hit"), similarity: z.number() }),
  z.object({
    type: z.literal("guardrail"),
    check: z.enum(["pii", "injection", "content"]),
    action: z.enum(["redacted", "blocked", "warned"]),
    detail: z.string(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().uuid().optional(),
  stream: z.boolean().default(true),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const EvalResultSchema = z.object({
  question: z.string(),
  expected_tier: z.number().int().min(1).max(3),
  pass: z.boolean(),
  citation_quality: z.number().min(0).max(2),
  schema_valid: z.boolean(),
  latency_ms: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  estimated_cost_usd: z.number(),
  answer_preview: z.string(),
  error: z.string().optional(),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;

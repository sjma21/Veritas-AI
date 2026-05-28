import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // Anthropic — used for all LLM completions
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  // Tavily — real web search
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),

  // OpenRouter — used only for embeddings (Anthropic has no embeddings API)
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),

  // claude-3-haiku-20240307   — cheap tasks (rewrite, rerank, critic, memory)
  // claude-haiku-4-5-20251001 — strong tasks (final synthesis)
  MODEL_CHEAP: z.string().default("claude-haiku-4-5-20251001"),
  MODEL_STRONG: z.string().default("claude-haiku-4-5-20251001"),
  MODEL_EMBED: z.string().default("openai/text-embedding-3-small"),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_TTL_SECONDS: z.coerce.number().default(3600),

  CHROMA_URL: z.string().default("http://localhost:8000"),
  CHROMA_COLLECTION: z.string().default("veritas_corpus"),
  CHROMA_MEMORY_COLLECTION: z.string().default("veritas_memory"),

  RETRIEVAL_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.45),
  RETRIEVAL_TOP_K: z.coerce.number().default(10),
  RERANK_TOP_K: z.coerce.number().default(5),

  AGENT_MAX_ITERATIONS: z.coerce.number().default(5),
  TOOL_OUTPUT_MAX_TOKENS: z.coerce.number().default(500),

  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().default(60),

  LOG_LEVEL: z.string().default("info"),

  // Semantic cache
  SEMANTIC_CACHE_ENABLED: z.coerce.boolean().default(true),
  SEMANTIC_CACHE_THRESHOLD: z.coerce.number().default(0.92),
  SEMANTIC_CACHE_MIN_CONFIDENCE: z.coerce.number().default(0.35),
  SEMANTIC_CACHE_TTL_SECONDS: z.coerce.number().default(3600),
  SEMANTIC_CACHE_COLLECTION: z.string().default("veritas_semantic_cache"),

  // LangSmith — optional observability
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("veritas-ai"),
  LANGSMITH_TRACING: z.string().default("true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

export type Config = typeof config;

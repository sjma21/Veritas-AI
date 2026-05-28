import type Anthropic from "@anthropic-ai/sdk";
import { complete, type SimpleMessage } from "../utils/llm_client.js";
import { runRetrievalPipeline } from "../retrieval/pipeline.js";
import { MemoryManager } from "../memory/memory_manager.js";
import { TOOL_DEFINITIONS, executeTool } from "../tools/index.js";
import { runCritic } from "../critic/critic.js";
import {
  buildSystemPrompt,
  buildContextBlock,
  buildAgentSynthesisPrompt,
  buildUncertaintyResponse,
} from "../prompts/templates.js";
import { AgentOutputSchema, type AgentOutput, type StreamEvent } from "../schemas/output.js";
import { VectorStore } from "../retrieval/vector_store.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { estimateCost, truncateToTokenLimit } from "../utils/token_counter.js";
import type { McpClient } from "../mcp/index.js";

export interface AgentRunOptions {
  userMessage: string;
  sessionId: string;
  conversationHistory: SimpleMessage[];
  stream?: boolean;
  emit: (event: StreamEvent) => void;
}

export interface AgentRunResult {
  output: AgentOutput;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  iterationsUsed: number;
}

// Anthropic-native message type for the agent loop
type AgentMessage =
  | { role: "user"; content: string | Anthropic.MessageParam["content"] }
  | { role: "assistant"; content: string | Anthropic.MessageParam["content"] };

export class AgentOrchestrator {
  private mcpToolNames = new Set<string>();

  constructor(
    private vectorStore: VectorStore,
    private memoryManager: MemoryManager,
    private mcpClient?: McpClient
  ) {
    if (mcpClient) {
      for (const t of mcpClient.getToolDefinitions()) {
        this.mcpToolNames.add(t.name);
      }
    }
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { userMessage, sessionId, conversationHistory, emit } = options;
    const startTime = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolEvidence = "";

    // ── Step 1: Retrieve relevant memories ──────────────────────────────────
    emit({ type: "retrieval", message: "Retrieving relevant conversation history..." });
    const memories = await this.memoryManager.retrieveRelevant(userMessage, sessionId, 3);
    const memoryBlock = this.memoryManager.formatMemoriesForPrompt(memories);
    if (memories.length > 0) {
      emit({ type: "retrieval", message: `Found ${memories.length} relevant past exchange(s)` });
    }

    // ── Step 2: Retrieval pipeline ───────────────────────────────────────────
    const conversationContext =
      conversationHistory
        .slice(-4)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n") || undefined;

    const retrievalResult = await runRetrievalPipeline(
      userMessage,
      this.vectorStore,
      emit,
      conversationContext
    );

    // ── Step 3: Low-confidence early exit ───────────────────────────────────
    if (retrievalResult.belowThreshold && retrievalResult.chunks.length === 0) {
      const uncertainOutput = JSON.parse(buildUncertaintyResponse()) as AgentOutput;
      emit({ type: "final", output: uncertainOutput });
      setImmediate(() => {
        this.memoryManager
          .storeExchange(sessionId, userMessage, uncertainOutput.answer)
          .catch(() => {});
      });
      return { output: uncertainOutput, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, iterationsUsed: 0 };
    }

    // ── Step 4: Build initial message for agent loop ─────────────────────────
    const contextBlock = buildContextBlock(retrievalResult.chunks, retrievalResult.contradictions);
    const systemPrompt = buildSystemPrompt();

    // Anthropic messages: system is top-level, no "system" role in messages array
    const messages: AgentMessage[] = [
      ...conversationHistory.slice(-6).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      {
        role: "user" as const,
        content: buildAgentSynthesisPrompt(userMessage, contextBlock, memoryBlock, toolEvidence),
      },
    ];

    // ── Step 5: ReAct agent loop ─────────────────────────────────────────────
    let iteration = 0;
    let finalContent = "";

    while (iteration < config.AGENT_MAX_ITERATIONS) {
      iteration++;
      logger.debug({ iteration, sessionId }, "Agent loop iteration");

      // Merge local tools with MCP tools so the model can call either
      const allTools = this.mcpClient
        ? [...TOOL_DEFINITIONS, ...this.mcpClient.getToolDefinitions()]
        : TOOL_DEFINITIONS;

      const result = await complete({
        model: config.MODEL_STRONG,
        system: systemPrompt,
        messages: messages as SimpleMessage[],
        temperature: 0.2,
        maxTokens: 1200,
        tools: allTools,
      });

      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      // Tool call requested
      if (result.toolUse) {
        const { id: toolId, name: toolName, input: toolArgs } = result.toolUse;

        emit({ type: "tool_call", tool: toolName, input: toolArgs });

        // Route to MCP client if it's an MCP tool, otherwise use local executor
        const rawOutput = this.mcpToolNames.has(toolName) && this.mcpClient
          ? await this.mcpClient.callTool({ name: toolName, input: toolArgs as Record<string, unknown> })
          : await executeTool(toolName, toolArgs as Record<string, string>);

        const truncatedOutput = truncateToTokenLimit(rawOutput, config.TOOL_OUTPUT_MAX_TOKENS);

        emit({ type: "tool_result", tool: toolName, output: truncatedOutput });

        toolEvidence += `\nTool: ${toolName}\nInput: ${JSON.stringify(toolArgs)}\nOutput: ${truncatedOutput}\n---`;

        // Append assistant turn (with tool_use block) + user turn (with tool_result block)
        messages.push({
          role: "assistant",
          content: [
            ...(result.content ? [{ type: "text" as const, text: result.content }] : []),
            {
              type: "tool_use" as const,
              id: toolId,
              name: toolName,
              input: toolArgs,
            },
          ],
        });

        const toolResultContent: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: toolId,
          content: truncatedOutput,
        };

        // If web_search returned empty, instruct the agent to retry with a different query
        if (toolName === "web_search") {
          let parsed: { empty?: boolean } = {};
          try { parsed = JSON.parse(rawOutput); } catch { /* ignore */ }
          if (parsed.empty) {
            messages.push({
              role: "user",
              content: [
                toolResultContent,
                {
                  type: "text" as const,
                  text: "The search returned no results (this can happen occasionally). Try web_search again with a shorter or differently phrased query. If the second attempt also returns empty, only then answer from the document corpus.",
                },
              ],
            });
            continue;
          }
        }

        messages.push({ role: "user", content: [toolResultContent] });
        continue;
      }

      // No tool call — this is the final answer
      finalContent = result.content;
      break;
    }

    if (!finalContent) {
      logger.warn({ sessionId, iterations: iteration }, "Agent loop exhausted without final answer");
      finalContent = buildUncertaintyResponse();
    }

    // ── Step 6: Parse and validate structured output ─────────────────────────
    let parsedOutput: AgentOutput;

    const parseAttempt = AgentOutputSchema.safeParse(extractJson(finalContent));
    if (parseAttempt.success) {
      parsedOutput = parseAttempt.data;
    } else {
      logger.warn({ error: parseAttempt.error.format() }, "Schema validation failed, retrying");

      try {
        const retryResult = await complete({
          model: config.MODEL_STRONG,
          system: systemPrompt,
          messages: [
            ...(messages as SimpleMessage[]),
            { role: "assistant", content: finalContent },
            {
              role: "user",
              content: `Your response failed schema validation. Errors:\n${JSON.stringify(parseAttempt.error.format())}\n\nRespond with ONLY valid JSON: { "answer": string, "citations": string[], "confidence": number, "follow_up_questions": string[] }`,
            },
          ],
          temperature: 0,
          maxTokens: 1200,
        });

        totalInputTokens += retryResult.inputTokens;
        totalOutputTokens += retryResult.outputTokens;

        const retryParsed = AgentOutputSchema.safeParse(extractJson(retryResult.content));
        parsedOutput = retryParsed.success ? retryParsed.data : buildFallbackOutput(finalContent);
      } catch (err) {
        logger.error({ err }, "Schema retry threw error");
        parsedOutput = buildFallbackOutput(finalContent);
      }
    }

    // ── Step 7: Critic layer ─────────────────────────────────────────────────
    const criticVerdict = await runCritic(
      parsedOutput,
      retrievalResult.chunks,
      toolEvidence,
      emit
    );

    if (!criticVerdict.passed && criticVerdict.revisedAnswer) {
      parsedOutput = { ...parsedOutput, ...criticVerdict.revisedAnswer };
    }

    if (retrievalResult.belowThreshold) {
      parsedOutput.confidence = Math.min(parsedOutput.confidence, 0.4);
    }

    // ── Step 8: Stream answer tokens ─────────────────────────────────────────
    const chunkSize = 15;
    const answerText = parsedOutput.answer;
    for (let i = 0; i < answerText.length; i += chunkSize) {
      emit({ type: "token", content: answerText.slice(i, i + chunkSize) });
      await new Promise<void>((r) => setTimeout(r, 8));
    }

    emit({ type: "final", output: parsedOutput });
    emit({ type: "done" });

    // ── Step 9: Persist memory async ─────────────────────────────────────────
    setImmediate(() => {
      this.memoryManager
        .storeExchange(sessionId, userMessage, parsedOutput.answer)
        .catch((err) => logger.warn({ err }, "Async memory store failed"));
    });

    const estimatedCostUsd = estimateCost(totalInputTokens, totalOutputTokens, config.MODEL_STRONG);

    logger.info(
      {
        sessionId,
        iterations: iteration,
        tokens: totalInputTokens + totalOutputTokens,
        cost: estimatedCostUsd,
        confidence: parsedOutput.confidence,
        durationMs: Date.now() - startTime,
      },
      "Agent run complete"
    );

    return { output: parsedOutput, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, estimatedCostUsd, iterationsUsed: iteration };
  }
}

function extractJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  return null;
}

function buildFallbackOutput(rawContent: string): AgentOutput {
  return {
    answer: rawContent.slice(0, 1000) || "Unable to generate a structured response. Please try again.",
    citations: [],
    confidence: 0.2,
    follow_up_questions: [],
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { traceable } from "../observability/langsmith.js";

type SupportedMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export const SUPPORTED_MIME_TYPES: SupportedMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as string[]).includes(mime);
}

export interface ExtractionResult {
  title: string;
  content: string;
  summary: string;
  wordCount: number;
}

const EXTRACTION_PROMPT = `You are a document extraction assistant. Analyze this image thoroughly and extract all information as structured text.

Your output MUST include:
1. A concise descriptive TITLE (one line, no prefix)
2. All visible TEXT — transcribe verbatim, preserving structure (headings, bullets, tables, code)
3. Descriptions of diagrams, charts, screenshots, or visual elements
4. A 2–3 sentence SUMMARY at the end

Format:
TITLE: <title here>

<full extracted content>

SUMMARY: <2-3 sentences>

Be exhaustive. If the image contains code, reproduce it exactly.`;

const anthropicClient = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

async function _extractFromImage(
  imageBuffer: Buffer,
  mimeType: SupportedMimeType,
  filename: string
): Promise<ExtractionResult> {
  const base64Data = imageBuffer.toString("base64");

  logger.info({ filename, mimeType, bytes: imageBuffer.length }, "Extracting content from image");

  const response = await anthropicClient.messages.create({
    model: config.MODEL_STRONG,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Data,
            },
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const raw = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";

  // Parse TITLE and SUMMARY out of the structured response
  const titleMatch = raw.match(/^TITLE:\s*(.+)$/m);
  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]+)$/m);

  const title = titleMatch?.[1]?.trim() ?? filename;
  const summary = summaryMatch?.[1]?.trim() ?? "";

  // Content = everything between TITLE line and SUMMARY line
  const afterTitle = raw.replace(/^TITLE:.*\n?/m, "").replace(/SUMMARY:[\s\S]+$/m, "").trim();

  logger.info(
    { filename, title, words: afterTitle.split(/\s+/).length },
    "Vision extraction complete"
  );

  return {
    title,
    content: afterTitle,
    summary,
    wordCount: afterTitle.split(/\s+/).length,
  };
}

export const extractFromImage = traceable(_extractFromImage, {
  name: "vision.extract",
  run_type: "chain",
  metadata: { layer: "ingestion" },
  processOutputs: (out: ExtractionResult) => ({
    title: out.title,
    wordCount: out.wordCount,
    hasSummary: !!out.summary,
  }),
});

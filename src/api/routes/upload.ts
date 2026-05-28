import { Router, type Request, type Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { VectorStore } from "../../retrieval/vector_store.js";
import { extractFromImage, isSupportedMimeType, SUPPORTED_MIME_TYPES } from "../../ingestion/vision_extractor.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.UPLOAD_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isSupportedMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Accepted: ${SUPPORTED_MIME_TYPES.join(", ")}`));
    }
  },
});

export function createUploadRouter(vectorStore: VectorStore): Router {
  const router = Router();

  router.post("/", upload.single("image"), async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "No image file provided. Send a multipart/form-data request with field name 'image'." });
      return;
    }

    if (!isSupportedMimeType(file.mimetype)) {
      res.status(400).json({ error: `Unsupported type: ${file.mimetype}` });
      return;
    }

    const startMs = Date.now();

    try {
      logger.info({ filename: file.originalname, bytes: file.size }, "Image upload received");

      // Step 1: Extract text via vision model
      const extraction = await extractFromImage(file.buffer, file.mimetype, file.originalname);

      // Step 2: Build a CorpusDocument and index it
      const docId = `img-${uuidv4().slice(0, 8)}`;
      const doc = {
        id: docId,
        title: extraction.title,
        content: extraction.content,
        source: `upload:${file.originalname}`,
        metadata: {
          origin: "image_upload",
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          uploadedAt: new Date().toISOString(),
          summary: extraction.summary,
          wordCount: extraction.wordCount,
        },
      };

      await vectorStore.addDocument(doc);

      const latencyMs = Date.now() - startMs;

      logger.info({ docId, title: extraction.title, latencyMs }, "Image indexed successfully");

      res.status(201).json({
        id: docId,
        title: extraction.title,
        summary: extraction.summary,
        word_count: extraction.wordCount,
        source: doc.source,
        latency_ms: latencyMs,
        message: `Document "${extraction.title}" indexed successfully. It will appear in future corpus searches.`,
      });
    } catch (err) {
      logger.error({ err, filename: file.originalname }, "Image upload failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Image processing failed",
      });
    }
  });

  // Handle multer errors (file too large, wrong type) cleanly
  router.use((err: Error, _req: Request, res: Response, _next: unknown) => {
    if (err.message.includes("File too large")) {
      res.status(413).json({ error: `File exceeds ${config.UPLOAD_MAX_SIZE_MB}MB limit` });
    } else {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

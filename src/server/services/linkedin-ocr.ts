import JSZip from "jszip";
import mammoth from "mammoth";
import pdf from "pdf-parse";

import { env } from "~/env";
import { formatPreview, logAiEvent } from "~/server/services/ai-logger";

const DEFAULT_OCR_PROVIDER = "google";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIN_TEXT_LENGTH = 40;

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const DOCX_EXTENSIONS = new Set(["docx"]);
const ODT_EXTENSIONS = new Set(["odt"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, hex: string) => {
      const safeHex = typeof hex === "string" ? hex : "";
      return String.fromCodePoint(Number.parseInt(safeHex, 16));
    })
    .replace(/&#(\d+);/g, (_match: string, code: string) => {
      const safeCode = typeof code === "string" ? code : "";
      return String.fromCodePoint(Number.parseInt(safeCode, 10));
    });

const extractTextFromOdt = async (buffer: Buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const content = await zip.file("content.xml")?.async("text");
  if (!content) {
    throw new Error("ODT file is missing content.");
  }

  const normalized = content
    .replace(/<text:line-break[^>]*\/>/g, "\n")
    .replace(/<text:s[^>]*\/>/g, " ")
    .replace(/<text:tab[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return decodeXmlEntities(normalized);
};

const extractTextFromDocx = async (buffer: Buffer) => {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? "").trim();
};

const extractTextFromPdf = async (buffer: Buffer) => {
  try {
    const result = await pdf(buffer);
    return (result.text ?? "").trim();
  } catch {
    return "";
  }
};

const extractTextFromPlain = (buffer: Buffer) =>
  buffer.toString("utf-8").trim();

const getExtension = (filename: string) => {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1]?.toLowerCase() ?? "";
};

const extractTextFromProvider = (provider: Record<string, unknown>) => {
  const direct =
    provider.text ??
    provider.full_text ??
    provider.raw_text ??
    provider.result ??
    provider.generated_text;

  if (typeof direct === "string") return direct;

  if (Array.isArray(provider.text)) {
    const lines = provider.text.filter(
      (line): line is string =>
        typeof line === "string" && Boolean(line.trim()),
    );
    if (lines.length > 0) return lines.join("\n");
  }

  if (Array.isArray(provider.pages)) {
    const lines: string[] = [];
    for (const page of provider.pages) {
      if (!page || typeof page !== "object") continue;
      const pageRecord = page as Record<string, unknown>;
      if (typeof pageRecord.text === "string") {
        lines.push(pageRecord.text);
      }
      if (Array.isArray(pageRecord.lines)) {
        for (const line of pageRecord.lines) {
          if (!line || typeof line !== "object") continue;
          const lineRecord = line as Record<string, unknown>;
          if (typeof lineRecord.text === "string") {
            lines.push(lineRecord.text);
          }
        }
      }
    }
    if (lines.length > 0) return lines.join("\n");
  }

  if (Array.isArray(provider.results)) {
    const lines = provider.results
      .map((result) => {
        if (!result || typeof result !== "object") return "";
        const record = result as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join("\n");
  }

  return "";
};

const readProviderText = (
  data: Record<string, unknown>,
  providerKey: string,
) => {
  const providerPayload =
    (data[providerKey] as Record<string, unknown> | undefined) ??
    (Object.values(data).find((value) => {
      if (!value || typeof value !== "object") return false;
      const record = value as Record<string, unknown>;
      return (
        typeof record.text === "string" ||
        typeof record.full_text === "string" ||
        typeof record.raw_text === "string" ||
        typeof record.result === "string"
      );
    }) as Record<string, unknown> | undefined);

  return providerPayload ? extractTextFromProvider(providerPayload) : "";
};

const callOcr = async (buffer: Buffer, file: File) => {
  if (!env.EDENAI_API_KEY) {
    throw new Error("EDENAI_API_KEY is required for OCR import.");
  }

  const providers = env.EDENAI_OCR_PROVIDER ?? DEFAULT_OCR_PROVIDER;
  const requestMeta = {
    providers,
    fileName: file.name || "resume",
    fileSize: buffer.length,
    fileType: file.type || "application/octet-stream",
  };
  const formData = new FormData();
  formData.append("providers", providers);
  formData.append("language", "en");
  formData.append(
    "file",
    new Blob([new Uint8Array(buffer)], {
      type: file.type || "application/octet-stream",
    }),
    file.name || "resume",
  );

  void logAiEvent({
    level: "debug",
    operation: "resume_ocr",
    provider: providers,
    request: requestMeta,
  });

  const response = await fetch("https://api.edenai.run/v2/ocr/ocr", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EDENAI_API_KEY}`,
    },
    body: formData,
  });

  const responseText = await response.text();
  void logAiEvent({
    level: "debug",
    operation: "resume_ocr",
    provider: providers,
    response: {
      status: response.status,
      ok: response.ok,
      bodyLength: responseText.length,
      bodyPreview: formatPreview(responseText),
    },
  });

  if (!response.ok) {
    void logAiEvent({
      level: "error",
      operation: "resume_ocr",
      provider: providers,
      response: {
        status: response.status,
        ok: response.ok,
        bodyPreview: formatPreview(responseText),
      },
    });
    throw new Error("Eden AI OCR failed.");
  }

  const data = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!data) {
    throw new Error("Eden AI OCR returned an empty response.");
  }

  const providerKey = providers.split(",")[0]?.trim() ?? DEFAULT_OCR_PROVIDER;
  const text = readProviderText(data, providerKey);
  if (!text) {
    throw new Error(
      "OCR returned no usable text. Try a text-based PDF or paste text.",
    );
  }

  return text.trim();
};

export const extractTextFromFile = async (file: File) => {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File too large. Keep it under 10MB.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = getExtension(file.name);
  const mime = file.type.toLowerCase();

  if (TEXT_EXTENSIONS.has(extension) || mime.startsWith("text/")) {
    const text = extractTextFromPlain(buffer);
    if (!text) {
      throw new Error("Text file was empty.");
    }
    return text;
  }

  if (
    DOCX_EXTENSIONS.has(extension) ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const text = await extractTextFromDocx(buffer);
    if (!text) {
      throw new Error("DOCX file had no readable text.");
    }
    return text;
  }

  if (
    ODT_EXTENSIONS.has(extension) ||
    mime === "application/vnd.oasis.opendocument.text"
  ) {
    const text = await extractTextFromOdt(buffer);
    if (!text) {
      throw new Error("ODT file had no readable text.");
    }
    return text;
  }

  if (PDF_EXTENSIONS.has(extension) || mime === "application/pdf") {
    const extracted = await extractTextFromPdf(buffer);
    if (extracted.length >= MIN_TEXT_LENGTH) {
      return extracted;
    }
    return callOcr(buffer, file);
  }

  if (mime.startsWith("image/")) {
    return callOcr(buffer, file);
  }

  throw new Error("Unsupported file type.");
};

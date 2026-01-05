import { jsonrepair } from "jsonrepair";

import { env } from "~/env";
import { scrapedProfileSchema, type ScrapedProfile } from "~/lib/resume/types";
import { formatPreview, logAiEvent } from "~/server/services/ai-logger";

const DEFAULT_PROMPT_LIMIT = 12000;
const DEFAULT_MAX_TOKENS = 500;

const trimToLimit = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const headSize = Math.floor(limit * 0.6);
  const tailSize = Math.max(0, limit - headSize - 10);
  const head = text.slice(0, headSize);
  const tail = text.slice(text.length - tailSize);
  return `${head}\n...\n${tail}`;
};

const buildPrompt = (rawText: string, url: string) => {
  const instructions = [
    "You are extracting resume-ready data from a LinkedIn profile scrape.",
    "Return ONLY valid JSON that matches this shape:",
    '{ "profile": { "fullName": "", "headline": "", "jobField": "", "email": "", "phone": "", "location": "", "website": "", "summary": "" }, "skills": [""] , "experiences": [ { "id": "exp-1", "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "summary": "", "highlights": [""] } ], "education": [ { "id": "edu-1", "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "notes": "" } ], "links": [ { "id": "link-1", "label": "", "url": "" } ] }',
    "Use empty strings when data is missing.",
    "The text may include sections labeled EXPERIENCE_DETAILS, EDUCATION_DETAILS, SKILLS_DETAILS, PROFILE_PAGE. Prefer details sections for completeness.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  return [
    instructions,
    `SOURCE_URL: ${url}`,
    "SCRAPE_TEXT:",
    rawText,
  ].join("\n");
};

const TEXT_KEYS = [
  "generated_text",
  "text",
  "result",
  "output",
  "content",
] as const;

const ARRAY_KEYS = ["items", "results", "choices", "outputs", "data"] as const;

const extractTextFromPayload = (
  payload: unknown,
  depth = 0,
): string | null => {
  if (!payload || depth > 4) return null;
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractTextFromPayload(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  if (typeof record.status === "string" && record.status !== "success") {
    return null;
  }

  for (const key of TEXT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  for (const key of ARRAY_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      const found = extractTextFromPayload(value, depth + 1);
      if (found) return found;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "status" || key === "error") continue;
    const found = extractTextFromPayload(value, depth + 1);
    if (found) return found;
  }

  return null;
};

const extractJsonCandidates = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  candidates.push(trimmed);
  return Array.from(new Set(candidates));
};

const tryParseJson = (text: string) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    try {
      const repaired = jsonrepair(text);
      return JSON.parse(repaired) as unknown;
    } catch {
      return null;
    }
  }
};

const parseScrapedProfile = (text: string): unknown | null => {
  for (const candidate of extractJsonCandidates(text)) {
    const parsed = tryParseJson(candidate);
    if (parsed) return parsed;
  }
  return null;
};

const readProviderText = (
  data: Record<string, unknown>,
  providerKey: string,
) => {
  const providerPayload = data[providerKey] ?? null;
  const direct = extractTextFromPayload(providerPayload);
  if (direct) return direct;

  for (const value of Object.values(data)) {
    const fallback = extractTextFromPayload(value);
    if (fallback) return fallback;
  }

  return "";
};

const readProviderError = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const status = typeof record.status === "string" ? record.status : undefined;
  const errorValue = record.error;
  if (typeof errorValue === "string" && errorValue.trim()) {
    return errorValue;
  }

  if (errorValue && typeof errorValue === "object") {
    const errorRecord = errorValue as Record<string, unknown>;
    const message =
      typeof errorRecord.message === "string" ? errorRecord.message : null;
    const type =
      typeof errorRecord.type === "string" ? errorRecord.type : null;
    if (message && type) return `${type}: ${message}`;
    if (message) return message;
    if (type) return type;
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }

  if (status && status !== "success") {
    return `Provider status: ${status}`;
  }

  return null;
};

const getProviderMeta = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  return {
    providerStatus: record.status,
    providerStatusCode: record.provider_status_code ?? record.status_code,
    providerCost: record.cost,
  };
};

export const extractLinkedInProfile = async ({
  rawText,
  url,
}: {
  rawText: string;
  url: string;
}): Promise<ScrapedProfile> => {
  if (!env.EDENAI_API_KEY) {
    throw new Error("EDENAI_API_KEY is required to normalize scraped data.");
  }

  const maxPromptChars = env.EDENAI_MAX_PROMPT_CHARS ?? DEFAULT_PROMPT_LIMIT;
  const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
  const trimmedText = trimToLimit(rawText, maxPromptChars);
  const prompt = buildPrompt(trimmedText, url);
  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const requestBody = {
    providers: provider,
    text: prompt,
    temperature: 0.1,
    max_tokens: maxTokens,
    model,
  };

  void logAiEvent({
    level: "debug",
    operation: "linkedin_extract",
    provider,
    model,
    request: {
      promptLength: prompt.length,
      rawTextLength: rawText.length,
      trimmedTextLength: trimmedText.length,
      maxTokens,
      promptPreview: formatPreview(prompt),
    },
  });

  const response = await fetch("https://api.edenai.run/v2/text/generation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EDENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  void logAiEvent({
    level: "debug",
    operation: "linkedin_extract",
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
      operation: "linkedin_extract",
      provider,
      model,
      response: {
        status: response.status,
        ok: response.ok,
        bodyPreview: formatPreview(responseText),
      },
    });
    throw new Error("Eden AI extraction failed.");
  }

  const data = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!data) {
    if (!responseText.trim()) {
      throw new Error("Eden AI returned an empty response.");
    }
    throw new Error("Eden AI returned a non-JSON response.");
  }

  const providerPayload = data[provider] ?? null;
  const providerError = readProviderError(providerPayload);
  const providerMeta = getProviderMeta(providerPayload);

  if (providerError) {
    void logAiEvent({
      level: "error",
      operation: "linkedin_extract",
      provider,
      model,
      response: {
        status: response.status,
        ok: response.ok,
        ...providerMeta,
        providerError,
      },
    });
    throw new Error(`Eden AI error: ${providerError}`);
  }

  void logAiEvent({
    level: "debug",
    operation: "linkedin_extract",
    provider,
    model,
    response: { keys: Object.keys(data), ...providerMeta },
  });

  const rawTextResponse = readProviderText(data, provider);
  if (!rawTextResponse) {
    void logAiEvent({
      level: "error",
      operation: "linkedin_extract",
      provider,
      model,
      response: { ...providerMeta },
    });
    throw new Error("Eden AI returned an empty response.");
  }

  const parsed = parseScrapedProfile(rawTextResponse);
  if (!parsed) {
    void logAiEvent({
      level: "error",
      operation: "linkedin_extract",
      provider,
      model,
      response: {
        parseError: "invalid_json",
        rawPreview: formatPreview(rawTextResponse),
      },
    });
    throw new Error("Eden AI returned an invalid JSON payload.");
  }

  const validated = scrapedProfileSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error("Eden AI output did not match the expected schema.");
  }

  return validated.data;
};

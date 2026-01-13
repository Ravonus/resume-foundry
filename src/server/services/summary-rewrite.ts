import { jsonrepair } from "jsonrepair";
import { z } from "zod";

import { env } from "~/env";
import { type ResumeDraft } from "~/lib/resume/types";
import {
  formatPreview,
  formatTailPreview,
  logAiEvent,
} from "~/server/services/ai-logger";

const rewriteResultSchema = z.object({
  summary: z.string().optional(),
});

const DEFAULT_MAX_TOKENS = 320;

const extractJsonCandidates = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const candidates: string[] = [];
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
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

const extractTextFromPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const direct =
    typeof record.generated_text === "string"
      ? record.generated_text
      : typeof record.text === "string"
        ? record.text
        : typeof record.result === "string"
          ? record.result
          : typeof record.output === "string"
            ? record.output
            : typeof record.content === "string"
              ? record.content
              : null;
  if (direct) return direct;
  const arrayCandidate = ["items", "results", "choices", "outputs", "data"]
    .map((key) => record[key])
    .find((value) => Array.isArray(value));
  if (!Array.isArray(arrayCandidate)) return null;
  for (const entry of arrayCandidate) {
    if (!entry || typeof entry !== "object") continue;
    const text =
      typeof (entry as Record<string, unknown>).generated_text === "string"
        ? (entry as Record<string, unknown>).generated_text
        : typeof (entry as Record<string, unknown>).text === "string"
          ? (entry as Record<string, unknown>).text
          : typeof (entry as Record<string, unknown>).content === "string"
            ? (entry as Record<string, unknown>).content
            : null;
    if (text) return text;
  }
  return null;
};

const buildPrompt = ({
  summary,
  profile,
  prompt,
}: {
  summary: string;
  profile?: Partial<ResumeDraft["profile"]> | null;
  prompt?: string;
}) => {
  const profilePayload = profile
    ? {
        headline: profile.headline,
        targetRole: profile.targetRole,
        jobField: profile.jobField,
        jobType: profile.jobType,
      }
    : null;

  return [
    "You are rewriting a professional resume summary.",
    "Rewrite only the summary. Do not invent facts.",
    "Keep it 2-4 sentences and impact-led.",
    "Return ONLY JSON in this shape:",
    '{ "summary": "" }',
    "Your rewrite must be meaningfully different from the input.",
    "Do not reuse any full sentence or long phrase from the input.",
    "Use ASCII only. Markdown is allowed for bullets and inline emphasis.",
    "Do not use headings, tables, or code fences.",
    prompt ? `USER_PROMPT: ${prompt}` : "",
    `SUMMARY: ${summary}`,
    profilePayload ? `PROFILE_HINTS: ${JSON.stringify(profilePayload)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const rewriteProfileSummary = async ({
  summary,
  profile,
  prompt,
}: {
  summary: string;
  profile?: Partial<ResumeDraft["profile"]> | null;
  prompt?: string;
}): Promise<{ summary: string }> => {
  if (!env.EDENAI_API_KEY) {
    throw new Error("AI is not configured.");
  }

  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
  const input = buildPrompt({ summary, profile, prompt });

  const response = await fetch("https://api.edenai.run/v2/text/generation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EDENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      providers: provider,
      text: input,
      temperature: 0.35,
      max_tokens: maxTokens,
      model,
    }),
  });

  const responseText = await response.text();
  void logAiEvent({
    level: "debug",
    operation: "summary_rewrite",
    provider,
    model,
    response: {
      status: response.status,
      ok: response.ok,
      bodyPreview: formatPreview(responseText),
      bodyTailPreview: formatTailPreview(responseText),
    },
  });

  const payload = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!payload) {
    throw new Error("AI response was invalid.");
  }

  const providerPayload = payload[provider] ?? null;
  const rawText =
    extractTextFromPayload(providerPayload) ??
    Object.values(payload)
      .map((value) => extractTextFromPayload(value))
      .find((value) => value);

  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("AI response was empty.");
  }

  let parsed: unknown = null;
  for (const candidate of extractJsonCandidates(rawText)) {
    const attempt = tryParseJson(candidate);
    if (attempt) {
      parsed = attempt;
      break;
    }
  }

  const normalized = rewriteResultSchema.safeParse(parsed);
  if (!normalized.success) {
    void logAiEvent({
      level: "error",
      operation: "summary_rewrite",
      provider,
      model,
      response: {
        parseError: "schema_mismatch",
        rawPreview: formatPreview(rawText),
        rawTailPreview: formatTailPreview(rawText),
      },
    });
    throw new Error("AI response did not match the expected format.");
  }

  return { summary: normalized.data.summary?.trim() ?? "" };
};

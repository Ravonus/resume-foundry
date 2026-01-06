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
  highlights: z.array(z.string()).optional(),
});

const DEFAULT_MAX_TOKENS = 450;

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
  experience,
  profile,
  prompt,
}: {
  experience: ResumeDraft["experiences"][number];
  profile?: Partial<ResumeDraft["profile"]> | null;
  prompt?: string;
}) => {
  const experiencePayload = {
    title: experience.title,
    company: experience.company,
    location: experience.location,
    startDate: experience.startDate,
    endDate: experience.endDate,
    summary: experience.summary,
    highlights: experience.highlights ?? [],
  };

  const profilePayload = profile
    ? {
        headline: profile.headline,
        targetRole: profile.targetRole,
        jobField: profile.jobField,
        jobType: profile.jobType,
      }
    : null;

  return [
    "You are rewriting a single resume experience entry.",
    "Rewrite only summary and highlights. Do not change titles, companies, or dates.",
    "Do not invent facts. Stay faithful to the provided content.",
    "Return ONLY JSON in this shape:",
    '{ "summary": "", "highlights": [""] }',
    "Summary should be 1-3 tight sentences.",
    "Highlights should be 3-6 bullets, action-led, concise.",
    "Use ASCII only. No markdown or extra commentary.",
    prompt ? `USER_PROMPT: ${prompt}` : "",
    `EXPERIENCE: ${JSON.stringify(experiencePayload)}`,
    profilePayload ? `PROFILE_HINTS: ${JSON.stringify(profilePayload)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const rewriteExperienceEntry = async ({
  experience,
  profile,
  prompt,
}: {
  experience: ResumeDraft["experiences"][number];
  profile?: Partial<ResumeDraft["profile"]> | null;
  prompt?: string;
}): Promise<{ summary: string; highlights: string[] }> => {
  if (!env.EDENAI_API_KEY) {
    throw new Error("AI is not configured.");
  }

  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
  const input = buildPrompt({ experience, profile, prompt });

  const response = await fetch("https://api.edenai.run/v2/text/generation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EDENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      providers: provider,
      text: input,
      temperature: 0.2,
      max_tokens: maxTokens,
      model,
    }),
  });

  const responseText = await response.text();
  void logAiEvent({
    level: "debug",
    operation: "experience_rewrite",
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

  if (!rawText) {
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
      operation: "experience_rewrite",
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

  const result = normalized.data;
  const summary = result.summary?.trim() ?? "";
  const highlights =
    result.highlights
      ?.map((item) => item.trim().replace(/^[-*•]\s*/, ""))
      .filter(Boolean) ?? [];

  return { summary, highlights };
};

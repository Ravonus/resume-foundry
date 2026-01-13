import { jsonrepair } from "jsonrepair";
import { z } from "zod";

import { env } from "~/env";
import { type ResumeDraft, type ScrapedProfile } from "~/lib/resume/types";
import {
  formatPreview,
  formatTailPreview,
  logAiEvent,
} from "~/server/services/ai-logger";

const polishResultSchema = z.object({
  profile: z
    .object({
      headline: z.string().optional(),
      summary: z.string().optional(),
    })
    .optional(),
  experiences: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().optional(),
        highlights: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const DEFAULT_MAX_TOKENS = 700;

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
  draft,
  scraped,
  prompt,
}: {
  draft: ResumeDraft;
  scraped: ScrapedProfile | null;
  prompt?: string;
}) => {
  const draftPayload = {
    profile: {
      fullName: draft.profile.fullName,
      headline: draft.profile.headline,
      targetRole: draft.profile.targetRole,
      jobField: draft.profile.jobField,
      jobType: draft.profile.jobType,
      summary: draft.profile.summary,
    },
    skills: draft.skills.slice(0, 12),
    experiences: draft.experiences.map((exp) => ({
      id: exp.id,
      title: exp.title,
      company: exp.company,
      startDate: exp.startDate,
      endDate: exp.endDate,
      summary: exp.summary,
      highlights: exp.highlights ?? [],
    })),
  };

  const scrapedPayload = scraped
    ? {
        profile: scraped.profile ?? {},
        skills: (scraped.skills ?? []).slice(0, 12),
      }
    : null;

  return [
    "You are polishing resume copy for clarity and impact.",
    "Only rewrite text. Do not change names, titles, companies, or dates.",
    "Return ONLY JSON in this shape:",
    '{ "profile": { "headline": "", "summary": "" }, "experiences": [ { "id": "", "summary": "", "highlights": [""] } ] }',
    "Keep highlights concise and punchy. Preserve any metrics.",
    "Rewrite every non-empty summary/highlights with fresh language.",
    "Your rewrite must be meaningfully different from the input.",
    "Do not reuse any full sentence or long phrase from the input.",
    "If a summary is long, you may return 3-5 bullet lines prefixed with '- '.",
    "Avoid repeating sentences. Remove duplicate ideas.",
    "If a summary or highlights list is empty, return an empty string or empty array.",
    "Do not copy sentences verbatim from the input.",
    "Use ASCII only. Markdown is allowed for bullets and inline emphasis.",
    "Do not use headings, tables, or code fences.",
    prompt ? `USER_PROMPT: ${prompt}` : "",
    `DRAFT: ${JSON.stringify(draftPayload)}`,
    scrapedPayload ? `SCRAPED_HINTS: ${JSON.stringify(scrapedPayload)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const polishResumeDraft = async ({
  draft,
  scraped,
  prompt,
}: {
  draft: ResumeDraft;
  scraped: ScrapedProfile | null;
  prompt?: string;
}): Promise<ResumeDraft> => {
  if (!env.EDENAI_API_KEY) {
    return draft;
  }

  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
  const input = buildPrompt({ draft, scraped, prompt });

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
    operation: "resume_polish",
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
  if (!payload) return draft;

  const providerPayload = payload[provider] ?? null;
  const rawText =
    extractTextFromPayload(providerPayload) ??
    Object.values(payload)
      .map((value) => extractTextFromPayload(value))
      .find((value) => value);

  if (typeof rawText !== "string" || !rawText.trim()) return draft;

  let parsed: unknown = null;
  for (const candidate of extractJsonCandidates(rawText)) {
    const attempt = tryParseJson(candidate);
    if (attempt) {
      parsed = attempt;
      break;
    }
  }

  const normalized = polishResultSchema.safeParse(parsed);
  if (!normalized.success) {
    void logAiEvent({
      level: "error",
      operation: "resume_polish",
      provider,
      model,
      response: {
        parseError: "schema_mismatch",
        rawPreview: formatPreview(rawText),
        rawTailPreview: formatTailPreview(rawText),
      },
    });
    return draft;
  }

  const result = normalized.data;
  const updatedProfile = { ...draft.profile };
  if (result.profile?.headline?.trim()) {
    updatedProfile.headline = result.profile.headline.trim();
  }
  if (result.profile?.summary?.trim()) {
    updatedProfile.summary = result.profile.summary.trim();
  }

  const updatedExperiences = draft.experiences.map((exp) => {
    const next = result.experiences?.find((item) => item.id === exp.id);
    if (!next) return exp;
    return {
      ...exp,
      summary: next.summary?.trim() ?? exp.summary,
      highlights:
        next.highlights && next.highlights.length > 0
          ? next.highlights.filter(Boolean)
          : exp.highlights,
    };
  });

  return {
    ...draft,
    profile: updatedProfile,
    experiences: updatedExperiences,
  };
};

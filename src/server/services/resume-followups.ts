import { jsonrepair } from "jsonrepair";
import { z } from "zod";

import { env } from "~/env";
import { type ResumeDraft, type ScrapedProfile } from "~/lib/resume/types";
import { formatPreview, logAiEvent } from "~/server/services/ai-logger";

const followupQuestionSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  label: z.string().min(1),
  inputType: z.enum(["text", "textarea", "choice"]),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  hint: z.string().optional(),
  prefill: z.string().optional(),
});

const followupResponseSchema = z.object({
  questions: z.array(followupQuestionSchema),
});

export type FollowupQuestion = z.infer<typeof followupQuestionSchema>;

type FollowupResult = {
  questions: FollowupQuestion[];
  source: "ai" | "heuristic" | "mix";
};

const hasMetric = (text: string | undefined) => /\d/.test(text ?? "");

const buildHeuristicQuestions = (
  draft: ResumeDraft,
  scraped: ScrapedProfile | null,
): FollowupQuestion[] => {
  const questions: FollowupQuestion[] = [];

  if (!draft.profile.summary || draft.profile.summary.trim().length < 80) {
    questions.push({
      key: "summary_impact",
      label:
        "What two or three sentences best capture your impact and the roles you want?",
      inputType: "textarea",
      placeholder:
        "Example: Product designer who ships onboarding improvements that cut time-to-value.",
    });
  }

  const latestExperience = draft.experiences[0];
  if (latestExperience && !latestExperience.summary?.trim()) {
    questions.push({
      key: "latest_role_impact",
      label: `What measurable impact did you deliver at ${latestExperience.company || "your last role"}?`,
      inputType: "textarea",
      placeholder: "Example: Reduced churn by 12% through a retention initiative.",
    });
  }

  const hasAnyMetrics = draft.experiences.some((experience) => {
    return hasMetric(experience.summary) || hasMetric(experience.title);
  });

  if (!hasAnyMetrics) {
    questions.push({
      key: "impact_metrics",
      label: "Share one or two metrics that prove your impact.",
      inputType: "text",
      placeholder: "Example: +25% conversion, saved 12 hours/week.",
    });
  }

  const missingLinks = draft.links.every((link) => !link.url.trim());
  if (missingLinks) {
    questions.push({
      key: "portfolio_link",
      label: "Do you have a portfolio, GitHub, or case study link to include?",
      inputType: "text",
      placeholder: "https://",
    });
  }

  const missingEducationDetail = draft.education.some(
    (edu) => !edu.degree?.trim() && !edu.field?.trim(),
  );
  if (missingEducationDetail) {
    questions.push({
      key: "education_focus",
      label: "What degree or focus area should we list for your education?",
      inputType: "text",
      placeholder: "Example: B.S. Computer Science",
    });
  }

  const scrapedSkills = (scraped?.skills ?? []).filter(Boolean);
  if (scrapedSkills.length > 0 && draft.skills.length === 0) {
    questions.push({
      key: "highlight_skills",
      label: "Which 5 to 8 skills should we highlight most prominently?",
      inputType: "text",
      placeholder: "Example: Product strategy, Figma, UX research",
      prefill: scrapedSkills.slice(0, 5).join(", "),
    });
  }

  const draftExperienceKeys = new Set(
    draft.experiences.map(
      (item) => `${item.title.toLowerCase()}::${item.company.toLowerCase()}`,
    ),
  );
  const missingExperiences = (scraped?.experiences ?? []).filter((item) => {
    const key = `${item.title.toLowerCase()}::${item.company.toLowerCase()}`;
    return item.title && item.company && !draftExperienceKeys.has(key);
  });
  missingExperiences.slice(0, 2).forEach((item, index) => {
    questions.push({
      key: `scraped_experience_${index + 1}`,
      label: `We found ${item.title} at ${item.company}. Add a one line summary if you want it included.`,
      inputType: "textarea",
      placeholder: "Optional: impact or scope in one or two sentences.",
      prefill: item.summary ?? "",
    });
  });

  const draftEducationKeys = new Set(
    draft.education.map(
      (item) => `${item.school.toLowerCase()}::${(item.degree ?? "").toLowerCase()}`,
    ),
  );
  const missingEducation = (scraped?.education ?? []).filter((item) => {
    const key = `${item.school.toLowerCase()}::${(item.degree ?? "").toLowerCase()}`;
    return item.school && !draftEducationKeys.has(key);
  });
  missingEducation.slice(0, 2).forEach((item, index) => {
    questions.push({
      key: `scraped_education_${index + 1}`,
      label: `We found ${item.school}. Add a short note if you want it listed.`,
      inputType: "textarea",
      placeholder: "Optional: degree, honors, or focus area.",
      prefill: item.degree ?? "",
    });
  });

  return questions.slice(0, 6);
};

const buildPrompt = (draft: ResumeDraft, scraped: ScrapedProfile | null) => {
  const instructions = [
    "You are a resume coach and talent advisor.",
    "Return ONLY valid JSON in the format:",
    '{"questions":[{"key":"short_key","label":"question","inputType":"text|textarea|choice","placeholder":"optional","options":["optional"],"hint":"optional","prefill":"optional"}]}',
    "Ask 3 to 7 follow-up questions that fill missing info or verify scraped-only items.",
    "Do not ask for data already present in the draft.",
    "Favor questions about measurable impact, scope, tools, and notable projects.",
    "If skills or experiences exist in the scrape but not the draft, ask whether to include them and where.",
    "Ask for short summaries or facts, not bullet formatting.",
    "Use ASCII only. Keep each label to one sentence.",
  ].join("\n");

  return [
    instructions,
    "SCRAPED:",
    JSON.stringify(scraped ?? {}),
    "DRAFT:",
    JSON.stringify(draft),
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

const parseAiQuestions = (text: string): FollowupQuestion[] | null => {
  for (const candidate of extractJsonCandidates(text)) {
    const parsed = tryParseJson(candidate);
    if (!parsed) continue;
    const normalized = Array.isArray(parsed)
      ? { questions: parsed }
      : parsed;
    const validated = followupResponseSchema.safeParse(normalized);
    if (validated.success) {
      return validated.data.questions;
    }
  }
  return null;
};

const callEdenAi = async (
  draft: ResumeDraft,
  scraped: ScrapedProfile | null,
): Promise<FollowupQuestion[] | null> => {
  if (!env.EDENAI_API_KEY) return null;

  try {
    const provider = env.EDENAI_PROVIDER ?? "openai";
    const model = env.EDENAI_MODEL ?? "gpt-4o";
    const maxPromptChars = env.EDENAI_MAX_PROMPT_CHARS ?? DEFAULT_PROMPT_LIMIT;
    const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
    const basePrompt = buildPrompt(draft, scraped);
    const prompt = trimToLimit(basePrompt, maxPromptChars);
    const requestBody = {
      providers: provider,
      text: prompt,
      temperature: 0.2,
      max_tokens: maxTokens,
      model,
    };

    void logAiEvent({
      level: "debug",
      operation: "resume_followups",
      provider,
      model,
      request: {
        promptLength: prompt.length,
        basePromptLength: basePrompt.length,
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
      operation: "resume_followups",
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
        operation: "resume_followups",
        provider,
        model,
        response: {
          status: response.status,
          ok: response.ok,
          bodyPreview: formatPreview(responseText),
        },
      });
      return null;
    }

    const data = (() => {
      try {
        return JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        return null;
      }
    })();
    if (!data) return null;

    const providerPayload = data[provider] ?? null;
    const providerError = readProviderError(providerPayload);
    const providerMeta = getProviderMeta(providerPayload);
    if (providerError) {
      void logAiEvent({
        level: "error",
        operation: "resume_followups",
        provider,
        model,
        response: {
          status: response.status,
          ok: response.ok,
          ...providerMeta,
          providerError,
        },
      });
      return null;
    }

    const rawText =
      extractTextFromPayload(providerPayload) ??
      Object.values(data)
        .map((value) => extractTextFromPayload(value))
        .find((value) => value);

    if (!rawText) return null;

    const parsedQuestions = parseAiQuestions(rawText);
    if (!parsedQuestions) {
      void logAiEvent({
        level: "error",
        operation: "resume_followups",
        provider,
        model,
        response: {
          parseError: "invalid_json",
          rawPreview: formatPreview(rawText),
        },
      });
      return null;
    }

    return parsedQuestions;
  } catch {
    return null;
  }
};

const dedupeQuestions = (questions: FollowupQuestion[]) => {
  const seen = new Set<string>();
  const result: FollowupQuestion[] = [];
  for (const question of questions) {
    const key = question.key.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }
  return result;
};

export const generateFollowupQuestions = async ({
  draft,
  scraped,
}: {
  draft: ResumeDraft;
  scraped: ScrapedProfile | null;
}): Promise<FollowupResult> => {
  const heuristic = buildHeuristicQuestions(draft, scraped);
  const aiQuestions = await callEdenAi(draft, scraped);

  if (aiQuestions && aiQuestions.length > 0) {
    const merged = dedupeQuestions([...heuristic, ...aiQuestions]).slice(0, 8);
    return {
      questions: merged,
      source: heuristic.length > 0 ? "mix" : "ai",
    };
  }

  return { questions: heuristic, source: "heuristic" };
};

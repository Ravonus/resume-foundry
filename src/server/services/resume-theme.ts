import { jsonrepair } from "jsonrepair";
import { z } from "zod";

import { env } from "~/env";
import { type ResumeDraft } from "~/lib/resume/types";
import {
  formatPreview,
  formatTailPreview,
  logAiEvent,
} from "~/server/services/ai-logger";

export const resumeThemeSchema = z.object({
  accent: z.string(),
  accentSoft: z.string(),
  accentInk: z.string(),
});

export type ResumeTheme = z.infer<typeof resumeThemeSchema>;

export const DEFAULT_RESUME_THEME: ResumeTheme = {
  accent: "#1f5c7a",
  accentSoft: "#d9e6ef",
  accentInk: "#f6fbff",
};

const THEME_PROMPT_MAX_TOKENS = 140;

const normalizeHex = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return hex.toLowerCase();
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
};

const rgbToHex = (r: number, g: number, b: number) => {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const mixHex = (base: string, mix: string, weight: number) => {
  const baseRgb = hexToRgb(base);
  const mixRgb = hexToRgb(mix);
  const mixWeight = Math.max(0, Math.min(1, weight));
  const r = baseRgb.r * (1 - mixWeight) + mixRgb.r * mixWeight;
  const g = baseRgb.g * (1 - mixWeight) + mixRgb.g * mixWeight;
  const b = baseRgb.b * (1 - mixWeight) + mixRgb.b * mixWeight;
  return rgbToHex(r, g, b);
};

const accentSoftFrom = (accent: string) => mixHex(accent, "#ffffff", 0.8);

const accentInkFrom = (accent: string) => {
  const { r, g, b } = hexToRgb(accent);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#0b141a" : "#ffffff";
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

const buildPrompt = (draft: ResumeDraft) => {
  const profile = draft.profile;
  const palette = [
    "#1F5C7A",
    "#2C6E6E",
    "#2E5F8A",
    "#3C5A73",
    "#375E3B",
    "#6B4E2E",
    "#45556C",
    "#0E5A6F",
    "#4C6A7C",
    "#2F4F4F",
  ];

  return [
    "You are selecting a professional accent color for a resume layout.",
    "Pick one accent color (hex) that fits the candidate and target job.",
    "Return ONLY valid JSON with this shape:",
    '{ "accent": "#RRGGBB", "accentName": "short name", "accentInk": "#RRGGBB" }',
    "accentInk should be either #ffffff or #0b141a for readable text on the accent.",
    "Use a mature, clean tone. Avoid neon and avoid purple.",
    `PALETTE: ${palette.join(", ")}`,
    `NAME: ${profile.fullName ?? ""}`,
    `HEADLINE: ${profile.headline ?? ""}`,
    `TARGET_ROLE: ${profile.targetRole ?? ""}`,
    `JOB_FIELD: ${profile.jobField ?? ""}`,
    `JOB_TYPE: ${profile.jobType ?? ""}`,
    `SUMMARY: ${(profile.summary ?? "").slice(0, 220)}`,
    `TOP_SKILLS: ${draft.skills.slice(0, 10).join(", ")}`,
  ].join("\n");
};

export const resolveResumeTheme = async (
  draft: ResumeDraft,
): Promise<ResumeTheme> => {
  if (!env.EDENAI_API_KEY) {
    return DEFAULT_RESUME_THEME;
  }

  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const prompt = buildPrompt(draft);

  const response = await fetch("https://api.edenai.run/v2/text/generation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EDENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      providers: provider,
      text: prompt,
      temperature: 0.2,
      max_tokens: THEME_PROMPT_MAX_TOKENS,
      model,
    }),
  });

  const responseText = await response.text();
  void logAiEvent({
    level: "debug",
    operation: "resume_theme",
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
  if (!payload) return DEFAULT_RESUME_THEME;

  const providerPayload = payload[provider] ?? null;
  const rawText =
    extractTextFromPayload(providerPayload) ??
    Object.values(payload)
      .map((value) => extractTextFromPayload(value))
      .find((value) => value);

  if (!rawText) return DEFAULT_RESUME_THEME;

  let parsed: Record<string, unknown> | null = null;
  for (const candidate of extractJsonCandidates(rawText)) {
    const attempt = tryParseJson(candidate);
    if (attempt && typeof attempt === "object" && !Array.isArray(attempt)) {
      parsed = attempt as Record<string, unknown>;
      break;
    }
  }
  if (!parsed) {
    void logAiEvent({
      level: "error",
      operation: "resume_theme",
      provider,
      model,
      response: {
        parseError: "invalid_json",
        rawPreview: formatPreview(rawText),
        rawTailPreview: formatTailPreview(rawText),
      },
    });
    return DEFAULT_RESUME_THEME;
  }

  const accent = normalizeHex(
    typeof parsed.accent === "string" ? parsed.accent : undefined,
    DEFAULT_RESUME_THEME.accent,
  );
  const accentInk = normalizeHex(
    typeof parsed.accentInk === "string" ? parsed.accentInk : undefined,
    accentInkFrom(accent),
  );
  const accentSoft = accentSoftFrom(accent);

  return {
    accent,
    accentInk,
    accentSoft,
  };
};

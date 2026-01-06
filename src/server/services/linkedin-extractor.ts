import { jsonrepair } from "jsonrepair";

import { env } from "~/env";
import { scrapedProfileSchema, type ScrapedProfile } from "~/lib/resume/types";
import {
  formatPreview,
  formatTailPreview,
  logAiEvent,
} from "~/server/services/ai-logger";

const DEFAULT_PROMPT_LIMIT = 12000;
const DEFAULT_MAX_TOKENS = 700;
const MIN_SECTION_TOKENS = {
  profile: 700,
  experience: 2000,
  education: 800,
  skills: 1200,
  full: 1800,
} as const;

const trimToLimit = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const headSize = Math.floor(limit * 0.6);
  const tailSize = Math.max(0, limit - headSize - 10);
  const head = text.slice(0, headSize);
  const tail = text.slice(text.length - tailSize);
  return `${head}\n...\n${tail}`;
};

const normalizeSectionText = (text: string) => {
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned: string[] = [];
  let last = "";
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ");
    if (normalized === last) continue;
    cleaned.push(normalized);
    last = normalized;
  }
  return cleaned.join("\n");
};

const EXPERIENCE_DATE_REGEX =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*(?:-|to)\s*(?:Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})/i;

const EMPLOYMENT_HINTS = [
  "full-time",
  "part-time",
  "contract",
  "internship",
  "freelance",
  "self-employed",
  "temporary",
  "seasonal",
  "apprenticeship",
];

const parseDateRange = (line: string) => {
  const match = line.match(
    /(\b[A-Za-z]{3,9}\s+\d{4})\s*(?:-|to)\s*(Present|[A-Za-z]{3,9}\s+\d{4})/i,
  );
  if (!match) return { startDate: "", endDate: "" };
  return {
    startDate: match[1],
    endDate: match[2],
  };
};

const stripCompanySuffix = (line: string) =>
  line.split("·")[0]?.trim() ?? line.trim();

const looksLikeCompanyLine = (line: string) => {
  const normalized = normalizeKey(line);
  if (!normalized) return false;
  if (line.includes("·")) return true;
  return EMPLOYMENT_HINTS.some((hint) => normalized.includes(hint));
};

const isNoiseLine = (line: string) => {
  const normalized = normalizeKey(line);
  if (!normalized) return true;
  if (EXPERIENCE_DATE_REGEX.test(line)) return false;
  if (normalized === "experience") return true;
  if (normalized.startsWith("show all")) return true;
  if (normalized.includes("connections")) return true;
  if (normalized.includes("contact info")) return true;
  if (/\b\d+\s*(?:yr|yrs|year|years|mo|mos|month|months)\b/.test(normalized)) {
    return true;
  }
  return false;
};

const isBulletLine = (line: string) => /^[-*•]\s+/.test(line);

const looksLikeLocation = (line: string) => {
  const normalized = line.trim();
  if (!normalized) return false;
  if (EXPERIENCE_DATE_REGEX.test(normalized)) return false;
  if (normalized.includes("·")) return false;
  if (normalized.length > 90) return false;
  if (normalized.includes(",")) return true;
  return /(area|united states|remote)/i.test(normalized);
};

const parseExperienceFallback = (text: string) => {
  if (!text) return [];
  const lines = normalizeSectionText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));

  const markers: {
    titleIndex: number;
    companyIndex: number;
    title: string;
    company: string;
  }[] = [];

  const nextNonNoiseIndex = (start: number) => {
    for (let i = start; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || isNoiseLine(line)) continue;
      return i;
    }
    return -1;
  };

  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (isNoiseLine(line) || isBulletLine(line)) continue;
    if (EXPERIENCE_DATE_REGEX.test(line)) continue;
    const nextIndex = nextNonNoiseIndex(i + 1);
    if (nextIndex === -1) break;
    const nextLine = lines[nextIndex];
    if (!looksLikeCompanyLine(nextLine)) continue;
    markers.push({
      titleIndex: i,
      companyIndex: nextIndex,
      title: line,
      company: stripCompanySuffix(nextLine),
    });
  }

  if (markers.length === 0) return [];

  const dedupedMarkers: typeof markers = [];
  const seenMarkerKeys = new Set<string>();
  for (const marker of markers) {
    const key = normalizeKey(`${marker.title}|${marker.company}`);
    if (!key || seenMarkerKeys.has(key)) continue;
    seenMarkerKeys.add(key);
    dedupedMarkers.push(marker);
  }

  const roles: {
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    summary: string;
    highlights: string[];
  }[] = [];

  for (let i = 0; i < dedupedMarkers.length; i += 1) {
    const marker = dedupedMarkers[i];
    const nextMarker = dedupedMarkers[i + 1];
    const title = marker.title;
    const company = marker.company;
    const endBoundary = nextMarker?.titleIndex ?? lines.length;

    let dateIndex = -1;
    for (let j = marker.companyIndex + 1; j < endBoundary; j += 1) {
      const line = lines[j];
      if (EXPERIENCE_DATE_REGEX.test(line)) {
        dateIndex = j;
        break;
      }
    }

    const detailStart =
      dateIndex >= 0 ? dateIndex + 1 : marker.companyIndex + 1;
    const detailEnd = Math.max(detailStart, endBoundary - 1);
    const details = lines.slice(detailStart, detailEnd + 1);

    let location = "";
    const summaryLines: string[] = [];
    const highlights: string[] = [];
    const seenDetail = new Set<string>();

    for (const detail of details) {
      if (!detail || isNoiseLine(detail)) continue;
      if (detail === title || detail === company) continue;
      if (looksLikeCompanyLine(detail)) continue;
      if (EXPERIENCE_DATE_REGEX.test(detail)) continue;
      const normalizedDetail = normalizeKey(detail);
      if (normalizedDetail && seenDetail.has(normalizedDetail)) continue;
      if (normalizedDetail) seenDetail.add(normalizedDetail);
      if (isBulletLine(detail)) {
        highlights.push(detail.replace(/^[-*•]\s+/, "").trim());
        continue;
      }
      if (!location && looksLikeLocation(detail)) {
        location = detail;
        continue;
      }
      summaryLines.push(detail);
    }

    const { startDate, endDate } =
      dateIndex >= 0 ? parseDateRange(lines[dateIndex]) : parseDateRange("");
    const summary = summaryLines.join(" ").trim();

    if (title || company || summary || highlights.length > 0) {
      roles.push({
        title,
        company,
        location,
        startDate,
        endDate,
        summary,
        highlights,
      });
    }
  }

  return roles;
};

const SECTION_MARKERS = [
  "EXPERIENCE_DETAILS",
  "EDUCATION_DETAILS",
  "SKILLS_DETAILS",
  "RECOMMENDATIONS_DETAILS",
  "PROFILE_PAGE",
  "SKILLS_ENDORSEMENTS_JSON",
] as const;

const extractSection = (rawText: string, marker: string) => {
  const index = rawText.indexOf(marker);
  if (index === -1) return "";
  const rest = rawText.slice(index + marker.length);
  const nextIndex = SECTION_MARKERS.map((label) => {
    if (label === marker) return -1;
    return rest.indexOf(label);
  })
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0];
  const section = rest.slice(0, nextIndex ?? rest.length);
  return section.replace(/^\s+/, "").trim();
};

const extractMarkerLine = (rawText: string, marker: string) => {
  const index = rawText.indexOf(marker);
  if (index === -1) return "";
  const after = rawText.slice(index + marker.length);
  const line = after
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? "";
};

const buildSection = (label: string, content: string, limit: number) => {
  if (!content) return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `${label}\n${trimmed.slice(0, limit)}`;
};

const buildPrompt = (rawText: string, url: string, maxChars: number) => {
  const instructions = [
    "You are extracting resume-ready data from a LinkedIn profile scrape.",
    "Return ONLY valid JSON that matches this shape:",
    '{ "profile": { "fullName": "", "headline": "", "targetRole": "", "jobField": "", "jobType": "", "email": "", "phone": "", "location": "", "website": "", "summary": "" }, "skills": [""] , "experiences": [ { "id": "exp-1", "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "summary": "", "highlights": [""] } ], "education": [ { "id": "edu-1", "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "notes": "" } ], "links": [ { "id": "link-1", "label": "", "url": "" } ] }',
    "Use empty strings when data is missing.",
    "The text may include sections labeled EXPERIENCE_DETAILS, EDUCATION_DETAILS, SKILLS_DETAILS, PROFILE_PAGE. Prefer details sections for completeness.",
    "If SKILLS_ENDORSEMENTS_JSON appears, include all skills from it and sort by endorsements desc.",
    "Extract tools, applications, programs, and hard skills mentioned in experience summaries and add them to the top-level skills list.",
    "If RECOMMENDATIONS_DETAILS appears, use it to refine wording and emphasize strengths, but do not add a recommendations section to the output.",
    "Infer jobField and targetRole from headline and recent roles when possible; leave blank if unclear.",
    "Set jobType only if the text explicitly mentions full-time, contract, freelance, part-time, or internship.",
    "Exclude noise like connections counts, endorsement labels, and any lines containing 'endorsement', 'connections', 'contact info', or 'show all/see all'.",
    "For experience: preserve bullet-like lines (starting with '-' or '•') as highlights for the matching role. Do not invent highlights or summaries; leave them empty if not present.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const hasMarkers = SECTION_MARKERS.some((marker) => rawText.includes(marker));
  if (!hasMarkers) {
    return [
      instructions,
      `SOURCE_URL: ${url}`,
      "SCRAPE_TEXT:",
      trimToLimit(rawText, maxChars),
    ].join("\n");
  }

  const budget = Math.max(4000, maxChars - 1600);
  const limits = {
    experience: Math.floor(budget * 0.4),
    education: Math.floor(budget * 0.18),
    skills: Math.floor(budget * 0.18),
    recommendations: Math.floor(budget * 0.12),
    profile: Math.floor(budget * 0.12),
  };

  const experience = extractSection(rawText, "EXPERIENCE_DETAILS");
  const education = extractSection(rawText, "EDUCATION_DETAILS");
  const skills = extractSection(rawText, "SKILLS_DETAILS");
  const recommendations = extractSection(rawText, "RECOMMENDATIONS_DETAILS");
  const profile = extractSection(rawText, "PROFILE_PAGE");
  const skillsJson = extractMarkerLine(rawText, "SKILLS_ENDORSEMENTS_JSON");

  const sections = [
    `SOURCE_URL: ${url}`,
    skillsJson ? `SKILLS_ENDORSEMENTS_JSON\n${skillsJson}` : "",
    buildSection("EXPERIENCE_DETAILS", experience, limits.experience),
    buildSection("EDUCATION_DETAILS", education, limits.education),
    buildSection("SKILLS_DETAILS", skills, limits.skills),
    buildSection(
      "RECOMMENDATIONS_DETAILS",
      recommendations,
      limits.recommendations,
    ),
    buildSection("PROFILE_PAGE", profile, limits.profile),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [instructions, sections].join("\n");
};

const buildProfilePrompt = ({
  profileText,
  recommendationsText,
  url,
  maxChars,
}: {
  profileText: string;
  recommendationsText: string;
  url: string;
  maxChars: number;
}) => {
  const instructions = [
    "You are extracting profile summary data from a LinkedIn scrape.",
    "Return ONLY valid JSON in this shape:",
    '{ "profile": { "fullName": "", "headline": "", "targetRole": "", "jobField": "", "jobType": "", "email": "", "phone": "", "location": "", "website": "", "summary": "" }, "links": [ { "id": "link-1", "label": "", "url": "" } ] }',
    "Use empty strings when data is missing.",
    "Infer jobField and targetRole from headline and roles when possible; leave blank if unclear.",
    "Set jobType only if the text explicitly mentions full-time, contract, freelance, part-time, or internship.",
    "If recommendations are present, use them to refine tone only.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const sections = [
    `SOURCE_URL: ${url}`,
    buildSection("PROFILE_PAGE", profileText, maxChars),
    recommendationsText
      ? buildSection("RECOMMENDATIONS_DETAILS", recommendationsText, maxChars)
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [instructions, sections].join("\n");
};

const buildExperiencePrompt = ({
  experienceText,
  url,
  maxChars,
}: {
  experienceText: string;
  url: string;
  maxChars: number;
}) => {
  const instructions = [
    "Extract experience entries from the LinkedIn scrape.",
    "Return ONLY valid JSON in this shape:",
    '{ "experiences": [ { "id": "exp-1", "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "summary": "", "highlights": [""] } ] }',
    "Use empty strings when data is missing.",
    "Preserve order from most recent to oldest when possible.",
    "Do not repeat the same role/company combination.",
    "Ignore duplicated lines or repeated headings from the scrape.",
    "Preserve bullet-like lines (starting with '-' or '•') as highlights for the matching role.",
    "If there are non-bullet sentences for a role, capture them in summary.",
    "Do not invent highlights or summaries; leave them empty if not present.",
    "Keep summary concise (<= 300 chars) and cap highlights at 6 bullets.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const sections = [
    `SOURCE_URL: ${url}`,
    buildSection("EXPERIENCE_DETAILS", experienceText, maxChars),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [instructions, sections].join("\n");
};

const buildEducationPrompt = ({
  educationText,
  url,
  maxChars,
}: {
  educationText: string;
  url: string;
  maxChars: number;
}) => {
  const instructions = [
    "Extract education entries from the LinkedIn scrape.",
    "Return ONLY valid JSON in this shape:",
    '{ "education": [ { "id": "edu-1", "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "notes": "" } ] }',
    "Use empty strings when data is missing.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const sections = [
    `SOURCE_URL: ${url}`,
    buildSection("EDUCATION_DETAILS", educationText, maxChars),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [instructions, sections].join("\n");
};

const buildSkillsPrompt = ({
  skillsText,
  skillsJson,
  experienceText,
  url,
  maxChars,
}: {
  skillsText: string;
  skillsJson: string;
  experienceText: string;
  url: string;
  maxChars: number;
}) => {
  const instructions = [
    "Extract skills from the LinkedIn scrape.",
    "Return ONLY valid JSON in this shape:",
    '{ "skills": [""] }',
    "Include all skills from SKILLS_ENDORSEMENTS_JSON when present.",
    "Also extract tools, applications, programs, and hard skills from experience text.",
    "Exclude noise like connections counts, endorsement labels, and any lines containing 'endorsement', 'connections', 'contact info', or 'show all/see all'.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const sections = [
    `SOURCE_URL: ${url}`,
    skillsJson ? `SKILLS_ENDORSEMENTS_JSON\n${skillsJson}` : "",
    buildSection("SKILLS_DETAILS", skillsText, maxChars),
    experienceText
      ? buildSection("EXPERIENCE_DETAILS", experienceText, maxChars)
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [instructions, sections].join("\n");
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

const sanitizeJsonCandidate = (text: string) =>
  text
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const extractJsonBlocks = (text: string) => {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return blocks;
};

const extractJsonCandidates = (text: string) => {
  const trimmed = sanitizeJsonCandidate(text.trim());
  if (!trimmed) return [];

  const candidates: string[] = [];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  candidates.push(...extractJsonBlocks(trimmed));

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  candidates.push(trimmed);
  return Array.from(new Set(candidates));
};

const tryParseJson = (text: string) => {
  const cleaned = sanitizeJsonCandidate(text.trim());
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    try {
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired) as unknown;
    } catch {
      return null;
    }
  }
};

const parseScrapedProfile = (text: string): unknown | null => {
  const hasKnownKey = (value: Record<string, unknown>) =>
    ["profile", "skills", "experiences", "education", "links"].some(
      (key) => key in value,
    );

  for (const candidate of extractJsonCandidates(text)) {
    const parsed = tryParseJson(candidate);
    if (!parsed) continue;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (hasKnownKey(record)) return parsed;
    }

    if (Array.isArray(parsed)) {
      const first = parsed[0];
      if (typeof first === "string") {
        return { skills: parsed };
      }
      if (first && typeof first === "object") {
        const record = first as Record<string, unknown>;
        if ("school" in record || "degree" in record) {
          return { education: parsed };
        }
        if ("company" in record || "title" in record) {
          return { experiences: parsed };
        }
        if ("url" in record || "label" in record) {
          return { links: parsed };
        }
        if ("name" in record || "skill" in record) {
          return { skills: parsed };
        }
      }
      return { skills: parsed };
    }
  }
  return null;
};

const parseSkillsFallback = (rawText: string) => {
  const line = extractMarkerLine(rawText, "SKILLS_ENDORSEMENTS_JSON");
  if (!line) return [];

  const parsed = tryParseJson(line);
  if (!Array.isArray(parsed)) return [];

  const items = parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name.trim()
          : typeof record.skill === "string"
            ? record.skill.trim()
            : "";
      const parsedEndorsements =
        typeof record.endorsements === "number"
          ? record.endorsements
          : typeof record.endorsements === "string"
            ? Number.parseInt(record.endorsements, 10)
            : undefined;
      const endorsements =
        typeof parsedEndorsements === "number" &&
        Number.isFinite(parsedEndorsements)
          ? parsedEndorsements
          : undefined;
      if (!name) return null;
      return { name, endorsements };
    })
    .filter(Boolean) as { name: string; endorsements?: number }[];

  items.sort((a, b) => (b.endorsements ?? 0) - (a.endorsements ?? 0));

  const seen = new Set<string>();
  return items
    .map((item) => item.name)
    .filter((name) => {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const parseSkillsFromDetails = (rawText: string) => {
  const section = extractSection(rawText, "SKILLS_DETAILS");
  if (!section) return [];

  const blacklist = [
    "endorsement",
    "endorsements",
    "skill",
    "skills",
    "show all",
    "see all",
    "add",
    "linkedin",
    "profile",
  ];

  const lines = section
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const candidates = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (blacklist.some((word) => lower.includes(word))) return false;
    if (line.length < 2 || line.length > 50) return false;
    if (!/^[A-Za-z0-9 .&+/#-]+$/.test(line)) return false;
    return true;
  });

  const seen = new Set<string>();
  return candidates.filter((skill) => {
    const key = skill.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeSkills = (primary: string[] | undefined, fallback: string[]) => {
  const base = primary ?? [];
  if (fallback.length === 0) return base;
  if (base.length === 0) return fallback;
  const seen = new Set(base.map((item) => item.trim().toLowerCase()));
  const merged = [...base];
  for (const skill of fallback) {
    const key = skill.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(skill);
  }
  return merged;
};

const coerceString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const normalizeSkillsList = (value: unknown) => {
  const normalizedList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/,|\n/).map((item) => item.trim())
      : [];

  const mapped = normalizedList
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record.name === "string") return record.name.trim();
      if (typeof record.skill === "string") return record.skill.trim();
      return "";
    })
    .filter(Boolean);

  const seen = new Set<string>();
  return mapped.filter((skill) => {
    const key = skill.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeHighlights = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((item) => item.replace(/^[*-]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeProfile = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const profile = {
    fullName: coerceString(record.fullName ?? ""),
    headline: coerceString(record.headline ?? ""),
    targetRole: coerceString(record.targetRole ?? ""),
    jobField: coerceString(record.jobField ?? ""),
    jobType: coerceString(record.jobType ?? ""),
    email: coerceString(record.email ?? ""),
    phone: coerceString(record.phone ?? ""),
    location: coerceString(record.location ?? ""),
    website: coerceString(record.website ?? ""),
    summary: coerceString(record.summary ?? ""),
  };
  const hasAny = Object.values(profile).some((value) => value.trim());
  return hasAny ? profile : undefined;
};

const normalizeExperiences = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = coerceString(record.title ?? "");
      const company = coerceString(record.company ?? "");
      const location = coerceString(record.location ?? "");
      const startDate = coerceString(record.startDate ?? "");
      const endDate = coerceString(record.endDate ?? "");
      const summary = coerceString(record.summary ?? "");
      const highlights = normalizeHighlights(record.highlights);
      const hasAny = Boolean(
        title || company || location || startDate || endDate || summary,
      );
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `exp-${index + 1}`,
        title,
        company,
        location,
        startDate,
        endDate,
        summary,
        highlights,
      };
    })
    .filter(Boolean);
};

const normalizeEducation = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const school = coerceString(record.school ?? "");
      const degree = coerceString(record.degree ?? "");
      const field = coerceString(record.field ?? "");
      const startDate = coerceString(record.startDate ?? "");
      const endDate = coerceString(record.endDate ?? "");
      const notes = coerceString(record.notes ?? "");
      const hasAny = Boolean(
        school || degree || field || startDate || endDate || notes,
      );
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `edu-${index + 1}`,
        school,
        degree,
        field,
        startDate,
        endDate,
        notes,
      };
    })
    .filter(Boolean);
};

const normalizeLinks = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = coerceString(record.label ?? "");
      const url = coerceString(record.url ?? "");
      const hasAny = Boolean(label || url);
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `link-${index + 1}`,
        label,
        url,
      };
    })
    .filter(Boolean);
};

const normalizeScrapedProfile = (value: unknown) => {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    profile: normalizeProfile(record.profile),
    skills: normalizeSkillsList(record.skills),
    experiences: normalizeExperiences(record.experiences),
    education: normalizeEducation(record.education),
    links: normalizeLinks(record.links),
  };
};

const normalizeKey = (value: string) => value.trim().toLowerCase();

const dedupeByKey = <T>(
  items: T[],
  getKey: (item: T) => string,
): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeProfiles = (current: ScrapedProfile, next: ScrapedProfile) => {
  const mergedProfile = { ...(current.profile ?? {}) };
  for (const [key, value] of Object.entries(next.profile ?? {})) {
    if (!value) continue;
    const field = key as keyof NonNullable<ScrapedProfile["profile"]>;
    if (!mergedProfile[field]) {
      mergedProfile[field] = value;
    }
  }

  return mergedProfile;
};

const mergeExperienceDetails = (
  primary: ScrapedProfile["experiences"] = [],
  fallback: ReturnType<typeof parseExperienceFallback>,
) => {
  if (!fallback || fallback.length === 0) return primary;
  const normalized = primary.map((item, index) => ({
    ...item,
    id: item.id ?? `exp-${index + 1}`,
  }));
  const keyFor = (item: {
    title?: string;
    company?: string;
    startDate?: string;
    endDate?: string;
  }) =>
    normalizeKey(
      `${item.title ?? ""}|${item.company ?? ""}|${item.startDate ?? ""}|${item.endDate ?? ""}`,
    );
  const fallbackKeyFor = (item: { title?: string; company?: string }) =>
    normalizeKey(`${item.title ?? ""}|${item.company ?? ""}`);
  const fallbackMap = new Map<string, (typeof fallback)[number]>();
  const fallbackLooseMap = new Map<string, (typeof fallback)[number] | null>();
  for (const item of fallback) {
    const key = keyFor(item);
    if (key && !fallbackMap.has(key)) {
      fallbackMap.set(key, item);
    }
    const looseKey = fallbackKeyFor(item);
    if (!looseKey) continue;
    if (!fallbackLooseMap.has(looseKey)) {
      fallbackLooseMap.set(looseKey, item);
      continue;
    }
    fallbackLooseMap.set(looseKey, null);
  }

  const merged = normalized.map((item) => {
    const hasText = (value?: string) =>
      typeof value === "string" && value.trim().length > 0;
    const key = keyFor(item);
    const looseKey = fallbackKeyFor(item);
    const extra =
      (key ? fallbackMap.get(key) : undefined) ??
      (looseKey ? fallbackLooseMap.get(looseKey) : undefined) ??
      undefined;
    if (!extra) return item;
    const mergedHighlights =
      item.highlights && item.highlights.length > 0
        ? item.highlights
        : extra.highlights;
    return {
      ...item,
      location: hasText(item.location) ? item.location : extra.location,
      startDate: hasText(item.startDate) ? item.startDate : extra.startDate,
      endDate: hasText(item.endDate) ? item.endDate : extra.endDate,
      summary: hasText(item.summary) ? item.summary : extra.summary,
      highlights: mergedHighlights,
    };
  });

  return dedupeByKey(merged, (item) =>
    normalizeKey(
      `${item.title ?? ""}|${item.company ?? ""}|${item.startDate ?? ""}|${item.endDate ?? ""}|${item.location ?? ""}`,
    ),
  );
};

const mergeExperiences = (
  current: ScrapedProfile["experiences"] = [],
  next: ScrapedProfile["experiences"] = [],
) => {
  const merged = [...current, ...next].filter(Boolean);
  return dedupeByKey(merged, (item) =>
    normalizeKey(
      `${item.title ?? ""}|${item.company ?? ""}|${item.startDate ?? ""}|${item.endDate ?? ""}|${item.location ?? ""}`,
    ),
  );
};

const mergeEducation = (
  current: ScrapedProfile["education"] = [],
  next: ScrapedProfile["education"] = [],
) => {
  const merged = [...current, ...next].filter(Boolean);
  return dedupeByKey(merged, (item) =>
    normalizeKey(
      `${item.school ?? ""}|${item.degree ?? ""}|${item.field ?? ""}|${item.startDate ?? ""}|${item.endDate ?? ""}`,
    ),
  );
};

const mergeLinks = (
  current: ScrapedProfile["links"] = [],
  next: ScrapedProfile["links"] = [],
) => {
  const merged = [...current, ...next].filter(Boolean);
  return dedupeByKey(merged, (item) =>
    normalizeKey(`${item.label ?? ""}|${item.url ?? ""}`),
  );
};

const mergeScrapedProfiles = (
  current: ScrapedProfile,
  next: ScrapedProfile,
): ScrapedProfile => ({
  profile: mergeProfiles(current, next),
  skills: mergeSkills(current.skills, next.skills ?? []),
  experiences: mergeExperiences(current.experiences, next.experiences),
  education: mergeEducation(current.education, next.education),
  links: mergeLinks(current.links, next.links),
});

const SKILL_STOPWORDS = [
  "endorsement",
  "endorsements",
  "contact info",
  "connections",
  "followers",
  "linkedin",
  "profile",
  "education",
  "experience",
  "recommendations",
  "skills",
  "people also viewed",
  "add section",
  "show all",
  "see all",
  "message",
];

const cleanSkills = (
  skills: string[],
  context: ScrapedProfile,
): string[] => {
  const blocklist = new Set<string>();
  const profile = context.profile ?? {};
  const addBlock = (value: string | undefined) => {
    if (!value) return;
    const normalized = normalizeKey(value);
    if (!normalized) return;
    blocklist.add(normalized);
  };

  addBlock(profile.fullName);
  addBlock(profile.headline);
  addBlock(profile.targetRole);
  addBlock(profile.jobField);
  addBlock(profile.location);

  const locationParts = (profile.location ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  locationParts.forEach((part) => addBlock(part));

  for (const experience of context.experiences ?? []) {
    addBlock(experience.company);
    addBlock(experience.title);
  }

  for (const education of context.education ?? []) {
    addBlock(education.school);
    addBlock(education.degree);
  }

  const cleaned = skills.filter((skill) => {
    const normalized = normalizeKey(skill);
    if (!normalized) return false;
    if (SKILL_STOPWORDS.some((word) => normalized.includes(word))) return false;
    if (/(^|\s)all(\s|$)/.test(normalized)) return false;
    if (blocklist.has(normalized)) return false;
    if (/^\d+$/.test(normalized)) return false;
    if (normalized.length < 2 || normalized.length > 50) return false;
    return true;
  });

  return dedupeByKey(cleaned, (item) => normalizeKey(item));
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

const callEdenSection = async ({
  operation,
  prompt,
  provider,
  model,
  maxTokens,
}: {
  operation: string;
  prompt: string;
  provider: string;
  model: string;
  maxTokens: number;
}): Promise<ScrapedProfile | null> => {
  const requestBody = {
    providers: provider,
    text: prompt,
    temperature: 0.1,
    max_tokens: maxTokens,
    model,
  };

  void logAiEvent({
    level: "debug",
    operation,
    provider,
    model,
    request: {
      promptLength: prompt.length,
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
    operation,
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
      operation,
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
  if (!data) {
    return null;
  }

  const providerPayload = data[provider] ?? null;
  const providerError = readProviderError(providerPayload);
  const providerMeta = getProviderMeta(providerPayload);

  if (providerError) {
    void logAiEvent({
      level: "error",
      operation,
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

  const rawTextResponse = readProviderText(data, provider);
  if (!rawTextResponse) {
    return null;
  }

  const parsed = parseScrapedProfile(rawTextResponse);
  if (!parsed) {
    void logAiEvent({
      level: "error",
      operation,
      provider,
      model,
      response: {
        parseError: "invalid_json",
        rawPreview: formatPreview(rawTextResponse),
        rawTailPreview: formatTailPreview(rawTextResponse),
      },
    });
    return null;
  }

  const normalized = normalizeScrapedProfile(parsed);
  const validated = scrapedProfileSchema.safeParse(normalized);
  if (!validated.success) {
    void logAiEvent({
      level: "error",
      operation,
      provider,
      model,
      response: {
        parseError: "schema_mismatch",
        schemaErrors: validated.error.flatten(),
        rawPreview: formatPreview(JSON.stringify(parsed)),
        rawTailPreview: formatTailPreview(JSON.stringify(parsed)),
      },
    });
    return null;
  }

  return validated.data;
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
  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const markers = SECTION_MARKERS.filter((marker) => rawText.includes(marker));
  const hasMarkers = markers.length > 0;
  const sectionLimit = Math.min(maxPromptChars, 6500);
  const experienceLimit = Math.min(maxPromptChars, 12000);
  const tokenBudget = {
    profile: Math.max(maxTokens, MIN_SECTION_TOKENS.profile),
    experience: Math.max(maxTokens, MIN_SECTION_TOKENS.experience),
    education: Math.max(maxTokens, MIN_SECTION_TOKENS.education),
    skills: Math.max(maxTokens, MIN_SECTION_TOKENS.skills),
    full: Math.max(maxTokens, MIN_SECTION_TOKENS.full),
  };

  void logAiEvent({
    level: "debug",
    operation: "linkedin_extract",
    provider,
    model,
    request: {
      rawTextLength: rawText.length,
      maxPromptChars,
      maxTokens,
      tokenBudget,
      markers,
    },
  });

  let collected: ScrapedProfile = {};

  if (hasMarkers) {
    const experienceText = normalizeSectionText(
      extractSection(rawText, "EXPERIENCE_DETAILS"),
    );
    const educationText = normalizeSectionText(
      extractSection(rawText, "EDUCATION_DETAILS"),
    );
    const skillsText = normalizeSectionText(
      extractSection(rawText, "SKILLS_DETAILS"),
    );
    const recommendationsText = normalizeSectionText(
      extractSection(rawText, "RECOMMENDATIONS_DETAILS"),
    );
    const profileText = normalizeSectionText(
      extractSection(rawText, "PROFILE_PAGE"),
    );
    const experienceSource = experienceText || profileText;
    const educationSource = educationText || profileText;
    const skillsSource = skillsText || profileText;
    const skillsJson = extractMarkerLine(rawText, "SKILLS_ENDORSEMENTS_JSON");

    void logAiEvent({
      level: "debug",
      operation: "linkedin_extract_sections",
      provider,
      model,
      meta: {
        experienceLength: experienceText.length,
        educationLength: educationText.length,
        skillsLength: skillsText.length,
        recommendationsLength: recommendationsText.length,
        profileLength: profileText.length,
        skillsJsonLength: skillsJson.length,
      },
    });

    if (profileText || recommendationsText) {
      const prompt = buildProfilePrompt({
        profileText,
        recommendationsText,
        url,
        maxChars: sectionLimit,
      });
      const result = await callEdenSection({
        operation: "linkedin_extract_profile",
        prompt,
        provider,
        model,
        maxTokens: tokenBudget.profile,
      });
      if (result) collected = mergeScrapedProfiles(collected, result);
    }

    if (experienceSource) {
      const prompt = buildExperiencePrompt({
        experienceText: experienceSource,
        url,
        maxChars: experienceLimit,
      });
      const result = await callEdenSection({
        operation: "linkedin_extract_experience",
        prompt,
        provider,
        model,
        maxTokens: tokenBudget.experience,
      });
      if (result) collected = mergeScrapedProfiles(collected, result);
    }

    if (educationSource) {
      const prompt = buildEducationPrompt({
        educationText: educationSource,
        url,
        maxChars: sectionLimit,
      });
      const result = await callEdenSection({
        operation: "linkedin_extract_education",
        prompt,
        provider,
        model,
        maxTokens: tokenBudget.education,
      });
      if (result) collected = mergeScrapedProfiles(collected, result);
    }

    if (skillsSource || skillsJson || experienceSource) {
      const prompt = buildSkillsPrompt({
        skillsText: skillsSource,
        skillsJson,
        experienceText: experienceSource,
        url,
        maxChars: sectionLimit,
      });
      const result = await callEdenSection({
        operation: "linkedin_extract_skills",
        prompt,
        provider,
        model,
        maxTokens: tokenBudget.skills,
      });
      if (result) collected = mergeScrapedProfiles(collected, result);
    }
  } else {
    const prompt = buildPrompt(rawText, url, maxPromptChars);
    const result = await callEdenSection({
      operation: "linkedin_extract_full",
      prompt,
      provider,
      model,
      maxTokens: tokenBudget.full,
    });
    if (result) collected = mergeScrapedProfiles(collected, result);
  }

  const fallbackExperienceText = normalizeSectionText(
    extractSection(rawText, "EXPERIENCE_DETAILS") ||
      extractSection(rawText, "PROFILE_PAGE") ||
      rawText,
  );
  const fallbackExperiences = parseExperienceFallback(fallbackExperienceText);
  if (fallbackExperiences.length > 0) {
    collected.experiences = mergeExperienceDetails(
      collected.experiences ?? [],
      fallbackExperiences,
    );
  }

  const fallbackSkills = mergeSkills(
    parseSkillsFallback(rawText),
    parseSkillsFromDetails(rawText),
  );
  const mergedSkills =
    fallbackSkills.length > 0
      ? mergeSkills(fallbackSkills, collected.skills ?? [])
      : collected.skills ?? [];
  const cleanedSkills = cleanSkills(mergedSkills, collected);
  const finalSkills =
    cleanedSkills.length > 0
      ? cleanedSkills
      : dedupeByKey(
          mergedSkills.map((skill) => skill.trim()).filter(Boolean),
          (item) => normalizeKey(item),
        );
  const normalized = { ...collected, skills: finalSkills };

  const validated = scrapedProfileSchema.safeParse(normalized);
  if (!validated.success) {
    void logAiEvent({
      level: "error",
      operation: "linkedin_extract",
      provider,
      model,
      response: {
        parseError: "schema_mismatch",
        schemaErrors: validated.error.flatten(),
        rawPreview: formatPreview(JSON.stringify(normalized)),
      },
    });
    throw new Error("Eden AI output did not match the expected schema.");
  }

  return validated.data;
};

import { jsonrepair } from "jsonrepair";

import { env } from "~/env";
import { scrapedProfileSchema, type ScrapedProfile } from "~/lib/resume/types";
import {
  formatPreview,
  formatTailPreview,
  logAiEvent,
} from "~/server/services/ai-logger";

const DEFAULT_PROMPT_LIMIT = 8000;
const DEFAULT_MAX_TOKENS = 700;

type SectionKey =
  | "profile"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "honors"
  | "volunteering"
  | "services"
  | "links";

type ResumeSections = Partial<Record<SectionKey, string[]>>;
type ResumeProfileHints = Partial<NonNullable<ScrapedProfile["profile"]>>;

const RESUME_NOISE = [
  "skip to main content",
  "show all",
  "see all",
  "connections",
  "followers",
  "contact info",
  "endorsement",
  "endorsements",
  "people also viewed",
  "people you may know",
  "for business",
  "suggested for you",
  "share that you're hiring",
  "discover who's viewed",
  "profile views",
  "post impressions",
  "create a post",
  "add project",
  "add case studies",
  "add profile section",
  "activity",
  "interests",
  "recommendations",
  "messages",
  "notifications",
  "privacy",
  "terms",
];

const SECTION_MATCHERS: Array<{ key: SectionKey; pattern: RegExp }> = [
  {
    key: "summary",
    pattern: /^(summary|professional summary|profile|objective|about)$/,
  },
  {
    key: "experience",
    pattern:
      /^(experience|work experience|professional experience|employment|work history)$/,
  },
  {
    key: "projects",
    pattern:
      /^(projects|selected projects|project experience|project work|personal projects)$/,
  },
  {
    key: "education",
    pattern:
      /^(education|academics|academic background|education and training)$/,
  },
  {
    key: "skills",
    pattern:
      /^(skills|key skills|core skills|technical skills|core competencies|competencies|skillset|technical proficiencies|technical expertise|expertise|areas of expertise|tools|technologies|tech stack|stack|frameworks|languages|technologies and tools|tools and technologies|tech and tools|tools and tech|technology stack)$/,
  },
  {
    key: "certifications",
    pattern:
      /^(certifications|certificates|licenses|licenses and certifications|certifications and licenses)$/,
  },
  {
    key: "honors",
    pattern: /^(honors|awards|honors and awards|awards and honors)$/,
  },
  {
    key: "volunteering",
    pattern:
      /^(volunteering|volunteer experience|community|community involvement)$/,
  },
  {
    key: "services",
    pattern: /^(services|offerings|consulting services)$/,
  },
  {
    key: "links",
    pattern:
      /^(links|contact|contact info|contact information|get in touch|connect)$/,
  },
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_REGEX = /(\+?\d[\d\s().-]{7,}\d)/;
const URL_DETECT_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;
const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const looksLikeContactLine = (line: string) =>
  EMAIL_REGEX.test(line) ||
  PHONE_REGEX.test(line) ||
  URL_DETECT_REGEX.test(line);

const trimToLimit = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const headSize = Math.floor(limit * 0.6);
  const tailSize = Math.max(0, limit - headSize - 10);
  const head = text.slice(0, headSize);
  const tail = text.slice(text.length - tailSize);
  return `${head}\n...\n${tail}`;
};

const normalizeLine = (value: string) => value.trim().toLowerCase();

const normalizeHeading = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const detectSectionHeading = (line: string): SectionKey | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  const normalized = normalizeHeading(trimmed);
  if (!normalized) return null;
  for (const matcher of SECTION_MATCHERS) {
    if (matcher.pattern.test(normalized)) return matcher.key;
  }
  return null;
};

const isNoiseLine = (line: string) => {
  const normalized = normalizeLine(line);
  if (!normalized) return true;
  if (looksLikeContactLine(line)) return false;
  if (normalized === "resume" || normalized === "curriculum vitae") return true;
  return RESUME_NOISE.some((noise) => normalized.includes(noise));
};

const cleanResumeLines = (text: string) => {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned: string[] = [];
  let last = "";
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    if (line === last) continue;
    cleaned.push(line);
    last = line;
  }
  return cleaned;
};

const SECTION_SEPARATORS = [":", " - ", " — ", " – ", " | ", " • ", " · "];

const parseSectionLine = (
  line: string,
): { key: SectionKey; content?: string } | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0 && colonIndex < 40) {
    const left = trimmed.slice(0, colonIndex).trim();
    const right = trimmed.slice(colonIndex + 1).trim();
    const heading = detectSectionHeading(left);
    if (heading) {
      return { key: heading, content: right || undefined };
    }
  }

  for (const separator of SECTION_SEPARATORS) {
    if (separator === ":") continue;
    const index = trimmed.indexOf(separator);
    if (index <= 0) continue;
    const left = trimmed.slice(0, index).trim();
    const right = trimmed.slice(index + separator.length).trim();
    const heading = detectSectionHeading(left);
    if (heading) {
      return { key: heading, content: right || undefined };
    }
  }

  const heading = detectSectionHeading(trimmed);
  if (heading) return { key: heading };

  return null;
};

const splitResumeSections = (lines: string[]): ResumeSections => {
  const sections: ResumeSections = {};
  let current: SectionKey = "profile";
  for (const line of lines) {
    const parsed = parseSectionLine(line);
    if (parsed) {
      current = parsed.key;
      if (parsed.content) {
        (sections[current] ??= []).push(parsed.content);
      }
      continue;
    }
    (sections[current] ??= []).push(line);
  }
  return sections;
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim().replace(/[),.]+$/, "");
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
};

const looksLikeName = (line: string) => {
  const cleaned = line
    .replace(/[^A-Za-z'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return false;
  if (/\d/.test(cleaned)) return false;
  if (cleaned.length < 4 || cleaned.length > 60) return false;
  const words = cleaned.split(" ");
  if (words.length < 2 || words.length > 5) return false;
  return words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word));
};

const NAME_SEPARATORS = [" | ", " • ", " · ", " — ", " – ", " - "];

const extractNameFromLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return "";
  for (const separator of NAME_SEPARATORS) {
    if (!trimmed.includes(separator)) continue;
    const left = trimmed.split(separator)[0]?.trim() ?? "";
    if (left && looksLikeName(left)) return left;
  }
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((part) => part.trim());
    if (parts.length >= 2) {
      const candidate = `${parts[1]} ${parts[0]}`.trim();
      if (looksLikeName(candidate)) return candidate;
    }
  }
  return looksLikeName(trimmed) ? trimmed : "";
};

const extractContactHints = (lines: string[]): ResumeProfileHints => {
  const hints: ResumeProfileHints = {};
  for (const line of lines) {
    if (!hints.email) {
      const emailMatch = EMAIL_REGEX.exec(line);
      if (emailMatch?.[0]) hints.email = emailMatch[0];
    }

    if (!hints.phone) {
      const phoneMatch = PHONE_REGEX.exec(line);
      if (phoneMatch?.[1]) hints.phone = phoneMatch[1];
    }

    if (!hints.website) {
      const urls = line.match(URL_REGEX) ?? [];
      if (urls.length > 0) {
        const preferred =
          urls.find((url) => !url.includes("linkedin.com")) ?? urls[0];
        if (preferred) hints.website = normalizeUrl(preferred);
      }
    }

    if (!hints.location) {
      const candidateParts = line
        .split(/\s[|•·]\s|\s-\s|\s—\s|\s–\s/)
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of candidateParts) {
        if (
          part.length <= 80 &&
          part.includes(",") &&
          !looksLikeContactLine(part) &&
          !looksLikeName(part)
        ) {
          hints.location = part;
          break;
        }
      }
    }
  }
  return hints;
};

const extractProfileHints = (lines: string[]): ResumeProfileHints => {
  const hints: ResumeProfileHints = {};
  let nameIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!hints.fullName) {
      const candidate = extractNameFromLine(line);
      if (candidate) {
        hints.fullName = candidate;
        nameIndex = i;
      }
    }

    if (!hints.email) {
      const emailMatch = EMAIL_REGEX.exec(line);
      if (emailMatch?.[0]) hints.email = emailMatch[0];
    }

    if (!hints.phone) {
      const phoneMatch = PHONE_REGEX.exec(line);
      if (phoneMatch?.[1]) hints.phone = phoneMatch[1];
    }

    if (!hints.website) {
      const urls = line.match(URL_REGEX) ?? [];
      if (urls.length > 0) {
        const preferred =
          urls.find((url) => !url.includes("linkedin.com")) ?? urls[0];
        if (preferred) hints.website = normalizeUrl(preferred);
      }
    }
  }

  if (nameIndex >= 0) {
    for (let i = nameIndex + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      if (detectSectionHeading(line)) break;
      if (looksLikeContactLine(line) || looksLikeName(line)) continue;
      if (line.length <= 120) {
        hints.headline = line;
        break;
      }
    }
  }

  if (!hints.location) {
    const locationLine = lines.find(
      (line) =>
        line.length <= 80 &&
        line.includes(",") &&
        !looksLikeContactLine(line) &&
        !looksLikeName(line),
    );
    if (locationLine) hints.location = locationLine;
  }

  return hints;
};

const buildSummaryHint = (summaryLines: string[], profileLines: string[]) => {
  const summary = summaryLines.join("\n").trim();
  if (summary) return summary;
  const candidates = profileLines.filter(
    (line) =>
      line.length >= 40 && !looksLikeContactLine(line) && !looksLikeName(line),
  );
  if (candidates.length === 0) return "";
  return candidates.slice(0, 3).join(" ").trim();
};

const normalizeDashes = (value: string) => value.replace(/\u2013|\u2014/g, "-");

const MONTHS = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*";
const DATE_RANGE_REGEX = new RegExp(
  `\\b(${MONTHS}\\s+\\d{4}|\\d{4})\\s*(?:-|to)\\s*(Present|${MONTHS}\\s+\\d{4}|\\d{4})`,
  "i",
);

const parseDateRange = (line: string) => {
  const normalized = normalizeDashes(line);
  const match = DATE_RANGE_REGEX.exec(normalized);
  if (!match) return { startDate: "", endDate: "" };
  return { startDate: match[1] ?? "", endDate: match[2] ?? "" };
};

const isBulletLine = (line: string) => /^[-*\u2022]\s+/.test(line);

const stripBullet = (line: string) => line.replace(/^[-*\u2022]\s+/, "").trim();

const looksLikeLocationLine = (line: string) => {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  if (normalized.includes("remote")) return true;
  if (normalized.includes("united states")) return true;
  if (normalized.includes("area")) return true;
  if (line.includes(",")) return true;
  return false;
};

const splitDashLine = (line: string) => {
  const normalized = normalizeDashes(line).replace(/\s+/g, " ").trim();
  const parts = normalized.split(" - ").map((part) => part.trim());
  if (parts.length < 2) return null;
  return {
    left: parts[0] ?? "",
    right: parts.slice(1).join(" - ").trim(),
  };
};

const cleanSkillToken = (value: string) =>
  value
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^[\s:;,-]+/, "")
    .replace(/[.,;:]+$/g, "")
    .trim();

const splitSkillLine = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0 && colonIndex < 40) {
    return trimmed.slice(colonIndex + 1).trim();
  }
  return trimmed;
};

const extractParenSkills = (value: string) => {
  const matches = Array.from(value.matchAll(/\(([^)]+)\)/g));
  const skills: string[] = [];
  for (const match of matches) {
    const inner = (match[1] ?? "").trim();
    if (!inner) continue;
    const parts = inner
      .split(/,|;|\||\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 6 && inner.length <= 80) {
      skills.push(...parts);
    }
  }
  return skills;
};

const parseSkillsFromLines = (lines: string[]) => {
  const skills: string[] = [];
  for (const line of lines) {
    const cleaned = splitSkillLine(
      stripBullet(line)
        .replace(/^skills?:\s*/i, "")
        .trim(),
    );
    const parts = cleaned
      .split(/,|;|\||\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    const parenParts = extractParenSkills(cleaned);
    if (parts.length > 1) {
      skills.push(...parts, ...parenParts);
    } else if (cleaned) {
      skills.push(cleaned, ...parenParts);
    }
  }
  const normalized = skills
    .map((skill) => cleanSkillToken(skill))
    .filter(Boolean);
  return dedupeByKey(normalized, (skill) => normalizeKey(skill));
};

const labelFromUrl = (url: string) => {
  const normalized = url.toLowerCase();
  if (normalized.includes("linkedin.com")) return "LinkedIn";
  if (normalized.includes("github.com")) return "GitHub";
  if (normalized.includes("behance.net")) return "Behance";
  if (normalized.includes("dribbble.com")) return "Dribbble";
  return "Website";
};

const parseLinksFromLines = (lines: string[]) => {
  const links: Array<{ label: string; url: string }> = [];
  for (const line of lines) {
    const urls = line.match(URL_REGEX) ?? [];
    if (urls.length === 0) continue;
    const labelText = line
      .replace(URL_REGEX, "")
      .replace(/[:|-]+$/, "")
      .trim();
    for (const url of urls) {
      links.push({
        label: labelText || labelFromUrl(url),
        url: normalizeUrl(url),
      });
    }
  }
  return dedupeByKey(links, (item) => item.url.toLowerCase());
};

const parseExperienceFromLines = (lines: string[]) => {
  const entries: Array<{
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    summary: string;
    highlights: string[];
  }> = [];
  let current: (typeof entries)[number] | null = null;

  const startEntry = (title = "", company = "") => ({
    title,
    company,
    location: "",
    startDate: "",
    endDate: "",
    summary: "",
    highlights: [],
  });

  const flush = () => {
    if (!current) return;
    const hasAny = Boolean(
      current.title ||
      current.company ||
      current.summary ||
      current.highlights.length > 0,
    );
    if (hasAny) entries.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = normalizeDashes(rawLine).trim();
    if (!line || isNoiseLine(line)) continue;
    if (isBulletLine(line)) {
      current ??= startEntry();
      current.highlights.push(stripBullet(line));
      continue;
    }
    const dates = parseDateRange(line);
    if (dates.startDate || dates.endDate) {
      current ??= startEntry();
      if (!current.startDate && dates.startDate)
        current.startDate = dates.startDate;
      if (!current.endDate && dates.endDate) current.endDate = dates.endDate;
      const pipeParts = line.split("|").map((part) => part.trim());
      const last = pipeParts[pipeParts.length - 1];
      if (last && !current.location && looksLikeLocationLine(last)) {
        current.location = last;
      }
      continue;
    }
    if (line.includes("|")) {
      const parts = line
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        current ??= startEntry();
        if (!current.title) current.title = parts[0] ?? "";
        const last = parts[parts.length - 1];
        if (last && !current.location && looksLikeLocationLine(last)) {
          current.location = last;
        } else if (!current.company && parts[1]) {
          current.company = parts[1];
        }
        continue;
      }
    }
    const dashParts = splitDashLine(line);
    if (dashParts) {
      flush();
      current = startEntry(dashParts.left, dashParts.right);
      continue;
    }
    if (!current) {
      current = startEntry(line, "");
      continue;
    }
    if (!current.title) {
      current.title = line;
      continue;
    }
    if (!current.company && !looksLikeLocationLine(line)) {
      current.company = line;
      continue;
    }
    if (!current.location && looksLikeLocationLine(line)) {
      current.location = line;
      continue;
    }
    current.summary = current.summary ? `${current.summary}\n${line}` : line;
  }

  flush();
  return entries;
};

const parseProjectsFromLines = (lines: string[]) => {
  const roles = parseExperienceFromLines(lines);
  return roles.map((entry) => ({
    name: entry.title || entry.company,
    role: entry.company && entry.title ? entry.company : "",
    description: entry.summary,
    startDate: entry.startDate,
    endDate: entry.endDate,
    url: "",
  }));
};

const EDU_DEGREE_KEYWORDS = [
  "bachelor",
  "master",
  "associate",
  "doctor",
  "phd",
  "mba",
  "b.s",
  "bs",
  "b.a",
  "ba",
  "m.s",
  "ms",
  "m.a",
  "ma",
  "high school",
  "highschool",
  "diploma",
  "certificate",
  "certification",
];

const looksLikeDegreeLine = (line: string) => {
  const normalized = normalizeLine(line);
  return EDU_DEGREE_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const looksLikeSchoolLine = (line: string) =>
  /(university|college|school|institute|academy)/i.test(line);

const splitDegreeField = (line: string) => {
  const commaParts = line
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length > 1) {
    return {
      degree: commaParts[0] ?? "",
      field: commaParts.slice(1).join(", "),
    };
  }
  const inParts = line.split(/\s+in\s+/i).map((part) => part.trim());
  if (inParts.length > 1) {
    return {
      degree: inParts[0] ?? "",
      field: inParts.slice(1).join(" in "),
    };
  }
  return { degree: line.trim(), field: "" };
};

const parseEducationFromLines = (lines: string[]) => {
  const entries: Array<{
    school: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    notes: string;
  }> = [];
  let current: (typeof entries)[number] | null = null;
  const flush = () => {
    if (current?.school) entries.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = normalizeDashes(rawLine).trim();
    if (!line || isNoiseLine(line)) continue;
    if (looksLikeSchoolLine(line)) {
      flush();
      current = {
        school: line,
        degree: "",
        field: "",
        startDate: "",
        endDate: "",
        notes: "",
      };
      continue;
    }
    const dates = parseDateRange(line);
    if (dates.startDate || dates.endDate) {
      current ??= {
        school: "",
        degree: "",
        field: "",
        startDate: "",
        endDate: "",
        notes: "",
      };
      if (!current.startDate && dates.startDate)
        current.startDate = dates.startDate;
      if (!current.endDate && dates.endDate) current.endDate = dates.endDate;
      continue;
    }
    if (looksLikeDegreeLine(line)) {
      current ??= {
        school: "",
        degree: "",
        field: "",
        startDate: "",
        endDate: "",
        notes: "",
      };
      const { degree, field } = splitDegreeField(line);
      if (!current.degree) current.degree = degree;
      if (!current.field && field) current.field = field;
      continue;
    }
    current ??= {
      school: "",
      degree: "",
      field: "",
      startDate: "",
      endDate: "",
      notes: "",
    };
    if (!current.school) {
      current.school = line;
      continue;
    }
    current.notes = current.notes ? `${current.notes}\n${line}` : line;
  }

  flush();
  return entries;
};

const parseSimpleItems = (
  lines: string[],
  key: "name" | "title",
  secondaryKey?: "issuer" | "description",
) => {
  const items: Array<Record<string, string>> = [];
  for (const rawLine of lines) {
    const line = stripBullet(normalizeDashes(rawLine));
    if (!line || isNoiseLine(line)) continue;
    const dashParts = splitDashLine(line);
    if (dashParts && secondaryKey) {
      items.push({
        [key]: dashParts.left,
        [secondaryKey]: dashParts.right,
      });
    } else {
      items.push({ [key]: line });
    }
  }
  return items;
};

const parseVolunteeringFromLines = (lines: string[]) => {
  const roles = parseExperienceFromLines(lines);
  return roles.map((entry) => ({
    role: entry.title,
    organization: entry.company,
    cause: "",
    startDate: entry.startDate,
    endDate: entry.endDate,
    summary: entry.summary,
  }));
};

const buildScrapedFromSections = (
  sections: ResumeSections,
  profileHints: ResumeProfileHints,
  summaryHint: string,
) => {
  const profileLines = sections.profile ?? [];
  const summaryLines = sections.summary ?? [];
  const fallbackHints = extractProfileHints([...profileLines, ...summaryLines]);
  const fallbackSummary = buildSummaryHint(summaryLines, profileLines);
  const profile = {
    ...fallbackHints,
    summary: fallbackSummary || summaryHint,
  };

  const scraped = normalizeScrapedProfile({
    profile,
    skills: parseSkillsFromLines(sections.skills ?? []),
    experiences: parseExperienceFromLines(sections.experience ?? []),
    projects: parseProjectsFromLines(sections.projects ?? []),
    education: parseEducationFromLines(sections.education ?? []),
    certifications: parseSimpleItems(
      sections.certifications ?? [],
      "name",
      "issuer",
    ),
    honors: parseSimpleItems(sections.honors ?? [], "title"),
    volunteering: parseVolunteeringFromLines(sections.volunteering ?? []),
    services: parseSimpleItems(sections.services ?? [], "name", "description"),
    links: parseLinksFromLines(sections.links ?? []),
  });

  const mergedProfile = applyProfileHints(scraped, profileHints, summaryHint);
  return normalizeScrapedProfile(mergedProfile);
};

const mergeScrapedProfiles = (
  primary: ScrapedProfile,
  fallback: ScrapedProfile,
): ScrapedProfile => {
  const profile = { ...(fallback.profile ?? {}) };
  for (const [key, value] of Object.entries(primary.profile ?? {})) {
    if (!value) continue;
    const field = key as keyof NonNullable<ScrapedProfile["profile"]>;
    profile[field] = value;
  }
  return {
    profile: Object.values(profile).some((value) => value.trim())
      ? profile
      : (primary.profile ?? fallback.profile),
    skills:
      (primary.skills ?? []).length > 0 ? primary.skills : fallback.skills,
    experiences:
      (primary.experiences ?? []).length > 0
        ? primary.experiences
        : fallback.experiences,
    education:
      (primary.education ?? []).length > 0
        ? primary.education
        : fallback.education,
    projects:
      (primary.projects ?? []).length > 0
        ? primary.projects
        : fallback.projects,
    certifications:
      (primary.certifications ?? []).length > 0
        ? primary.certifications
        : fallback.certifications,
    honors:
      (primary.honors ?? []).length > 0 ? primary.honors : fallback.honors,
    volunteering:
      (primary.volunteering ?? []).length > 0
        ? primary.volunteering
        : fallback.volunteering,
    services:
      (primary.services ?? []).length > 0
        ? primary.services
        : fallback.services,
    links: (primary.links ?? []).length > 0 ? primary.links : fallback.links,
  };
};

const normalizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const supportsUrl = (sourceText: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (sourceText.includes(trimmed)) return true;
  const withoutScheme = trimmed.replace(/^https?:\/\//i, "");
  return sourceText.includes(withoutScheme);
};

const supportsValue = (
  sourceIndex: string,
  sourceText: string,
  value: string,
) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (URL_DETECT_REGEX.test(trimmed)) {
    return supportsUrl(sourceText, trimmed);
  }
  const normalized = normalizeForMatch(trimmed);
  if (normalized.length < 3) return false;
  return (
    sourceIndex.includes(` ${normalized} `) || sourceIndex.includes(normalized)
  );
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const supportsSkillValue = (
  sourceIndex: string,
  sourceText: string,
  value: string,
) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const normalized = normalizeForMatch(trimmed);
  if (!normalized) return false;
  const rawPattern =
    trimmed.length <= 2
      ? new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i")
      : new RegExp(escapeRegex(trimmed), "i");
  if (rawPattern.test(sourceText)) return true;
  return (
    sourceIndex.includes(` ${normalized} `) || sourceIndex.includes(normalized)
  );
};

const filterScrapedProfileToSource = (
  scraped: ScrapedProfile,
  sourceText: string,
): ScrapedProfile => {
  const sourceIndex = ` ${normalizeForMatch(sourceText)} `;
  const keepText = (value: string) =>
    supportsValue(sourceIndex, sourceText, value) ? value : "";

  const profile = scraped.profile
    ? {
        ...scraped.profile,
        fullName: keepText(scraped.profile.fullName ?? ""),
        headline: keepText(scraped.profile.headline ?? ""),
        targetRole: keepText(scraped.profile.targetRole ?? ""),
        jobField: keepText(scraped.profile.jobField ?? ""),
        jobType: keepText(scraped.profile.jobType ?? ""),
        email: keepText(scraped.profile.email ?? ""),
        phone: keepText(scraped.profile.phone ?? ""),
        location: keepText(scraped.profile.location ?? ""),
        website: keepText(scraped.profile.website ?? ""),
        summary: keepText(scraped.profile.summary ?? ""),
        headshotUrl: "",
      }
    : undefined;

  const filterHighlights = (items?: string[]) =>
    (items ?? []).filter((item) =>
      supportsValue(sourceIndex, sourceText, item),
    );

  const experiences = (scraped.experiences ?? [])
    .map((item) => {
      const title = keepText(item.title ?? "");
      const company = keepText(item.company ?? "");
      const location = keepText(item.location ?? "");
      const startDate = keepText(item.startDate ?? "");
      const endDate = keepText(item.endDate ?? "");
      const summary = keepText(item.summary ?? "");
      const highlights = filterHighlights(item.highlights);
      const hasAny = Boolean(
        title || company || summary || highlights.length > 0,
      );
      if (!hasAny) return null;
      return {
        ...item,
        title,
        company,
        location,
        startDate,
        endDate,
        summary,
        highlights,
      };
    })
    .filter(isNonNull);

  const projects = (scraped.projects ?? [])
    .map((item) => {
      const name = keepText(item.name ?? "");
      const role = keepText(item.role ?? "");
      const description = keepText(item.description ?? "");
      const startDate = keepText(item.startDate ?? "");
      const endDate = keepText(item.endDate ?? "");
      const url = supportsUrl(sourceText, item.url ?? "")
        ? (item.url ?? "")
        : "";
      const hasAny = Boolean(name || role || description);
      if (!hasAny) return null;
      return {
        ...item,
        name,
        role,
        description,
        startDate,
        endDate,
        url,
      };
    })
    .filter(isNonNull);

  const education = (scraped.education ?? [])
    .map((item) => {
      const school = keepText(item.school ?? "");
      const degree = keepText(item.degree ?? "");
      const field = keepText(item.field ?? "");
      const startDate = keepText(item.startDate ?? "");
      const endDate = keepText(item.endDate ?? "");
      const notes = keepText(item.notes ?? "");
      const hasAny = Boolean(school || degree || field);
      if (!hasAny) return null;
      return {
        ...item,
        school,
        degree,
        field,
        startDate,
        endDate,
        notes,
      };
    })
    .filter(isNonNull);

  const certifications = (scraped.certifications ?? [])
    .map((item) => {
      const name = keepText(item.name ?? "");
      const issuer = keepText(item.issuer ?? "");
      const issueDate = keepText(item.issueDate ?? "");
      const expirationDate = keepText(item.expirationDate ?? "");
      const credentialId = keepText(item.credentialId ?? "");
      const credentialUrl = supportsUrl(sourceText, item.credentialUrl ?? "")
        ? (item.credentialUrl ?? "")
        : "";
      if (!name) return null;
      return {
        ...item,
        name,
        issuer,
        issueDate,
        expirationDate,
        credentialId,
        credentialUrl,
      };
    })
    .filter(isNonNull);

  const honors = (scraped.honors ?? [])
    .map((item) => {
      const title = keepText(item.title ?? "");
      const issuer = keepText(item.issuer ?? "");
      const date = keepText(item.date ?? "");
      const description = keepText(item.description ?? "");
      if (!title) return null;
      return {
        ...item,
        title,
        issuer,
        date,
        description,
      };
    })
    .filter(isNonNull);

  const volunteering = (scraped.volunteering ?? [])
    .map((item) => {
      const role = keepText(item.role ?? "");
      const organization = keepText(item.organization ?? "");
      const cause = keepText(item.cause ?? "");
      const startDate = keepText(item.startDate ?? "");
      const endDate = keepText(item.endDate ?? "");
      const summary = keepText(item.summary ?? "");
      const hasAny = Boolean(role || organization || summary);
      if (!hasAny) return null;
      return {
        ...item,
        role,
        organization,
        cause,
        startDate,
        endDate,
        summary,
      };
    })
    .filter(isNonNull);

  const services = (scraped.services ?? [])
    .map((item) => {
      const name = keepText(item.name ?? "");
      const description = keepText(item.description ?? "");
      if (!name) return null;
      return {
        ...item,
        name,
        description,
      };
    })
    .filter(isNonNull);

  const skills = (scraped.skills ?? []).filter((skill) =>
    supportsSkillValue(sourceIndex, sourceText, skill),
  );

  const links = (scraped.links ?? []).filter((link) =>
    supportsUrl(sourceText, link.url ?? ""),
  );

  return normalizeScrapedProfile({
    profile,
    skills,
    experiences,
    projects,
    education,
    certifications,
    honors,
    volunteering,
    services,
    links,
  });
};

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

const coerceParsedResume = (
  value: unknown,
): Record<string, unknown> | null => {
  if (!value) return null;
  if (Array.isArray(value)) {
    const list = value as unknown[];
    const firstObject = list.find(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
    return firstObject ?? null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const unwrapKeys = ["resume", "data", "result", "output", "payload"];
    for (const key of unwrapKeys) {
      const candidate = record[key];
      if (candidate && typeof candidate === "object") {
        return candidate as Record<string, unknown>;
      }
    }
    return record;
  }
  return null;
};

const coerceString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value as string | number | boolean);

const coerceImageUrl = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = [
      "url",
      "imageUrl",
      "displayImage",
      "displayImageUrl",
      "profilePicture",
      "profilePictureUrl",
      "pictureUrl",
      "photoUrl",
      "avatarUrl",
      "image",
      "picture",
      "photo",
    ];
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return "";
};

const normalizeKey = (value: string) => value.trim().toLowerCase();

const dedupeByKey = <T>(items: T[], getKey: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isNonNull = <T>(value: T | null): value is T => value !== null;

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
      return typeof record.name === "string"
        ? record.name.trim()
        : typeof record.skill === "string"
          ? record.skill.trim()
          : "";
    })
    .filter(Boolean);
  return dedupeByKey(mapped, (skill) => normalizeKey(skill));
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
  const headshotUrl =
    coerceImageUrl(record.headshotUrl) ||
    coerceImageUrl(record.headshot) ||
    coerceImageUrl(record.avatarUrl) ||
    coerceImageUrl(record.avatar) ||
    coerceImageUrl(record.photoUrl) ||
    coerceImageUrl(record.photo) ||
    coerceImageUrl(record.pictureUrl) ||
    coerceImageUrl(record.picture) ||
    coerceImageUrl(record.imageUrl) ||
    coerceImageUrl(record.image) ||
    coerceImageUrl(record.profilePicture) ||
    coerceImageUrl(record.profilePictureUrl);
  const profile = {
    fullName: coerceString(record.fullName ?? record.name ?? ""),
    headline: coerceString(record.headline ?? record.title ?? ""),
    targetRole: coerceString(record.targetRole ?? ""),
    jobField: coerceString(record.jobField ?? ""),
    jobType: coerceString(record.jobType ?? ""),
    email: coerceString(record.email ?? ""),
    phone: coerceString(record.phone ?? ""),
    location: coerceString(record.location ?? ""),
    website: coerceString(record.website ?? record.portfolio ?? ""),
    summary: coerceString(record.summary ?? record.about ?? ""),
    headshotUrl,
  };
  const hasAny = Object.values(profile).some((field) => field.trim());
  return hasAny ? profile : undefined;
};

const normalizeExperiences = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = coerceString(
        record.title ?? record.role ?? record.position ?? "",
      );
      const company = coerceString(
        record.company ?? record.employer ?? record.organization ?? "",
      );
      const location = coerceString(record.location ?? "");
      const startDate = coerceString(
        record.startDate ?? record.start ?? record.from ?? "",
      );
      const endDate = coerceString(
        record.endDate ?? record.end ?? record.to ?? "",
      );
      const summary = coerceString(
        record.summary ?? record.description ?? record.details ?? "",
      );
      const highlights = normalizeHighlights(
        record.highlights ?? record.bullets ?? record.achievements ?? "",
      );
      const hasAny = Boolean(
        title ||
        company ||
        location ||
        startDate ||
        endDate ||
        summary ||
        highlights.length > 0,
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
    .filter(isNonNull);
};

const normalizeEducation = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const school = coerceString(
        record.school ?? record.institution ?? record.university ?? "",
      );
      const degree = coerceString(record.degree ?? record.qualification ?? "");
      const field = coerceString(record.field ?? record.major ?? "");
      const startDate = coerceString(
        record.startDate ?? record.start ?? record.from ?? "",
      );
      const endDate = coerceString(
        record.endDate ?? record.end ?? record.to ?? "",
      );
      const notes = coerceString(
        record.notes ?? record.description ?? record.details ?? "",
      );
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
    .filter(isNonNull);
};

const normalizeProjects = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = coerceString(record.name ?? record.title ?? "");
      const role = coerceString(record.role ?? record.position ?? "");
      const description = coerceString(
        record.description ?? record.summary ?? record.details ?? "",
      );
      const startDate = coerceString(
        record.startDate ?? record.start ?? record.from ?? "",
      );
      const endDate = coerceString(
        record.endDate ?? record.end ?? record.to ?? "",
      );
      const url = coerceString(record.url ?? record.link ?? "");
      const hasAny = Boolean(
        name || role || description || startDate || endDate || url,
      );
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `proj-${index + 1}`,
        name,
        role,
        description,
        startDate,
        endDate,
        url,
      };
    })
    .filter(isNonNull);
};

const normalizeCertifications = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = coerceString(record.name ?? record.title ?? "");
      const issuer = coerceString(
        record.issuer ?? record.organization ?? record.authority ?? "",
      );
      const issueDate = coerceString(
        record.issueDate ?? record.issued ?? record.date ?? "",
      );
      const expirationDate = coerceString(
        record.expirationDate ?? record.expires ?? "",
      );
      const credentialId = coerceString(
        record.credentialId ?? record.credential ?? "",
      );
      const credentialUrl = coerceString(
        record.credentialUrl ?? record.url ?? "",
      );
      const hasAny = Boolean(
        name ||
        issuer ||
        issueDate ||
        expirationDate ||
        credentialId ||
        credentialUrl,
      );
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `cert-${index + 1}`,
        name,
        issuer,
        issueDate,
        expirationDate,
        credentialId,
        credentialUrl,
      };
    })
    .filter(isNonNull);
};

const normalizeHonors = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = coerceString(record.title ?? record.name ?? "");
      const issuer = coerceString(
        record.issuer ?? record.organization ?? record.awarder ?? "",
      );
      const date = coerceString(record.date ?? record.year ?? "");
      const description = coerceString(
        record.description ?? record.summary ?? "",
      );
      const hasAny = Boolean(title || issuer || date || description);
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `honor-${index + 1}`,
        title,
        issuer,
        date,
        description,
      };
    })
    .filter(isNonNull);
};

const normalizeVolunteering = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = coerceString(record.role ?? record.title ?? "");
      const organization = coerceString(
        record.organization ?? record.org ?? record.company ?? "",
      );
      const cause = coerceString(record.cause ?? record.category ?? "");
      const startDate = coerceString(
        record.startDate ?? record.start ?? record.from ?? "",
      );
      const endDate = coerceString(
        record.endDate ?? record.end ?? record.to ?? "",
      );
      const summary = coerceString(record.summary ?? record.description ?? "");
      const hasAny = Boolean(
        role || organization || cause || startDate || endDate || summary,
      );
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `vol-${index + 1}`,
        role,
        organization,
        cause,
        startDate,
        endDate,
        summary,
      };
    })
    .filter(isNonNull);
};

const normalizeServices = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = coerceString(record.name ?? record.title ?? "");
      const description = coerceString(
        record.description ?? record.summary ?? "",
      );
      const hasAny = Boolean(name || description);
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `service-${index + 1}`,
        name,
        description,
      };
    })
    .filter(isNonNull);
};

const normalizeLinks = (value: unknown) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = coerceString(record.label ?? record.name ?? "");
      const url = coerceString(record.url ?? record.link ?? record.href ?? "");
      const hasAny = Boolean(label || url);
      if (!hasAny) return null;
      return {
        id: typeof record.id === "string" ? record.id : `link-${index + 1}`,
        label,
        url,
      };
    })
    .filter(isNonNull);
};

function normalizeScrapedProfile(value: unknown): ScrapedProfile {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const skills = normalizeSkillsList(record.skills ?? record.skillset ?? []);
  const experiences = normalizeExperiences(
    record.experiences ?? record.experience ?? [],
  );
  const education = normalizeEducation(
    record.education ?? record.educations ?? [],
  );
  const projects = normalizeProjects(record.projects ?? record.project ?? []);
  const certifications = normalizeCertifications(
    record.certifications ?? record.licenses ?? [],
  );
  const honors = normalizeHonors(record.honors ?? record.awards ?? []);
  const volunteering = normalizeVolunteering(
    record.volunteering ?? record.volunteer ?? [],
  );
  const services = normalizeServices(record.services ?? []);
  const links = normalizeLinks(
    record.links ?? record.websites ?? record.urls ?? [],
  );
  return {
    profile: normalizeProfile(record.profile ?? record.contact ?? {}),
    skills: skills.length > 0 ? skills : undefined,
    experiences: experiences.length > 0 ? experiences : undefined,
    education: education.length > 0 ? education : undefined,
    projects: projects.length > 0 ? projects : undefined,
    certifications: certifications.length > 0 ? certifications : undefined,
    honors: honors.length > 0 ? honors : undefined,
    volunteering: volunteering.length > 0 ? volunteering : undefined,
    services: services.length > 0 ? services : undefined,
    links: links.length > 0 ? links : undefined,
  };
}

const buildSection = (label: string, content: string, limit: number) => {
  if (!content) return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `${label}\n${trimmed.slice(0, limit)}`;
};

function applyProfileHints(
  scraped: ScrapedProfile,
  profileHints: ResumeProfileHints,
  summaryHint: string,
): ScrapedProfile {
  const profile = { ...(scraped.profile ?? {}) };
  const applyIfMissing = (
    key: keyof NonNullable<ScrapedProfile["profile"]>,
    value: string | undefined,
  ) => {
    if (!value?.trim()) return;
    if (profile[key]?.trim()) return;
    profile[key] = value.trim();
  };

  applyIfMissing("fullName", profileHints.fullName);
  applyIfMissing("headline", profileHints.headline);
  applyIfMissing("email", profileHints.email);
  applyIfMissing("phone", profileHints.phone);
  applyIfMissing("location", profileHints.location);
  applyIfMissing("website", profileHints.website);
  applyIfMissing("summary", summaryHint);

  const hasProfile = Object.values(profile).some(
    (value) => typeof value === "string" && value.trim(),
  );

  return {
    ...scraped,
    profile: hasProfile ? profile : scraped.profile,
  };
}

const buildPrompt = ({
  rawText,
  source,
  maxChars,
  sections,
  profileHints,
  summaryHint,
}: {
  rawText: string;
  source?: string;
  maxChars: number;
  sections: ResumeSections;
  profileHints: ResumeProfileHints;
  summaryHint: string;
}) => {
  const instructions = [
    "You are extracting structured resume data from a resume.",
    "Return ONLY valid JSON that matches this shape:",
    '{ "profile": { "fullName": "", "headline": "", "targetRole": "", "jobField": "", "jobType": "", "email": "", "phone": "", "location": "", "website": "", "summary": "" }, "skills": [""], "experiences": [ { "id": "exp-1", "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "summary": "", "highlights": [""] } ], "education": [ { "id": "edu-1", "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "notes": "" } ], "projects": [ { "id": "proj-1", "name": "", "role": "", "description": "", "startDate": "", "endDate": "", "url": "" } ], "certifications": [ { "id": "cert-1", "name": "", "issuer": "", "issueDate": "", "expirationDate": "", "credentialId": "", "credentialUrl": "" } ], "honors": [ { "id": "honor-1", "title": "", "issuer": "", "date": "", "description": "" } ], "volunteering": [ { "id": "vol-1", "role": "", "organization": "", "cause": "", "startDate": "", "endDate": "", "summary": "" } ], "services": [ { "id": "service-1", "name": "", "description": "" } ], "links": [ { "id": "link-1", "label": "", "url": "" } ] }',
    "Use empty strings when data is missing.",
    "Do not invent facts. Only use what is in the resume text.",
    "If a role has bullet points, put them in highlights for that role.",
    "If a role has paragraph text, put it in summary.",
    "Extract every experience and project that appears; keep the order.",
    "Do not drop entries just because a date or detail is missing.",
    "Use PROFILE_HINTS and SUMMARY_HINT if provided.",
    "Prefer SECTION blocks when present.",
    "Infer jobField or targetRole only if explicitly stated.",
    "Set jobType only if the resume says full-time, part-time, contract, freelance, or internship.",
    "If you are unsure, return empty strings/arrays but still return valid JSON.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const profileSection = (sections.profile ?? []).join("\n").trim();
  const summarySection = (sections.summary ?? []).join("\n").trim();
  const experienceSection = (sections.experience ?? []).join("\n").trim();
  const projectsSection = (sections.projects ?? []).join("\n").trim();
  const educationSection = (sections.education ?? []).join("\n").trim();
  const skillsSection = (sections.skills ?? []).join("\n").trim();
  const certificationsSection = (sections.certifications ?? [])
    .join("\n")
    .trim();
  const honorsSection = (sections.honors ?? []).join("\n").trim();
  const volunteeringSection = (sections.volunteering ?? []).join("\n").trim();
  const servicesSection = (sections.services ?? []).join("\n").trim();
  const linksSection = (sections.links ?? []).join("\n").trim();

  const hasStructuredSections = [
    experienceSection,
    projectsSection,
    educationSection,
    skillsSection,
    certificationsSection,
    honorsSection,
    volunteeringSection,
    servicesSection,
    linksSection,
  ].some(Boolean);

  const profileHintsLine =
    Object.keys(profileHints).length > 0
      ? `PROFILE_HINTS: ${JSON.stringify(profileHints)}`
      : "";
  const summaryHintLine = summaryHint ? `SUMMARY_HINT: ${summaryHint}` : "";

  const budget = Math.max(3000, maxChars - 800);
  const sectionLimit = (fraction: number) =>
    Math.max(200, Math.floor(budget * fraction));

  const sectionBlocks = [
    profileHintsLine,
    summaryHintLine,
    buildSection("PROFILE_SECTION", profileSection, sectionLimit(0.06)),
    buildSection("SUMMARY_SECTION", summarySection, sectionLimit(0.06)),
    buildSection("EXPERIENCE_SECTION", experienceSection, sectionLimit(0.3)),
    buildSection("PROJECTS_SECTION", projectsSection, sectionLimit(0.12)),
    buildSection("EDUCATION_SECTION", educationSection, sectionLimit(0.12)),
    buildSection("SKILLS_SECTION", skillsSection, sectionLimit(0.1)),
    buildSection(
      "CERTIFICATIONS_SECTION",
      certificationsSection,
      sectionLimit(0.05),
    ),
    buildSection("HONORS_SECTION", honorsSection, sectionLimit(0.04)),
    buildSection(
      "VOLUNTEERING_SECTION",
      volunteeringSection,
      sectionLimit(0.04),
    ),
    buildSection("SERVICES_SECTION", servicesSection, sectionLimit(0.03)),
    buildSection("LINKS_SECTION", linksSection, sectionLimit(0.03)),
  ].filter(Boolean);

  const sectionPayload = hasStructuredSections
    ? sectionBlocks.join("\n\n")
    : [
        profileHintsLine,
        summaryHintLine,
        "RESUME_TEXT:",
        trimToLimit(rawText, maxChars),
      ]
        .filter(Boolean)
        .join("\n");

  const sectionsPayload = [source ? `SOURCE: ${source}` : "", sectionPayload]
    .filter(Boolean)
    .join("\n\n");

  return [instructions, sectionsPayload].join("\n");
};

export const extractResumeProfile = async ({
  rawText,
  source,
}: {
  rawText: string;
  source?: string;
}): Promise<ScrapedProfile> => {
  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_RESUME_MODEL ?? env.EDENAI_MODEL ?? "gpt-4o";
  const maxTokens =
    env.EDENAI_RESUME_MAX_TOKENS ??
    Math.min(env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS);
  const maxChars =
    env.EDENAI_RESUME_MAX_PROMPT_CHARS ??
    Math.min(
      env.EDENAI_MAX_PROMPT_CHARS ?? DEFAULT_PROMPT_LIMIT,
      DEFAULT_PROMPT_LIMIT,
    );
  const rawLines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cleanedLines = cleanResumeLines(rawText);
  const baseLines = cleanedLines.length > 0 ? cleanedLines : rawLines;
  const normalizedText = baseLines.join("\n");
  const sections = splitResumeSections(baseLines);
  const profileLines =
    sections.profile && sections.profile.length > 0
      ? sections.profile
      : baseLines.slice(0, 8);
  const contactHints = extractContactHints(baseLines);
  const profileHints = {
    ...contactHints,
    ...extractProfileHints(profileLines),
  };
  const summaryHint = buildSummaryHint(sections.summary ?? [], profileLines);
  const fallbackScraped = buildScrapedFromSections(
    sections,
    profileHints,
    summaryHint,
  );
  const useAi = env.EDENAI_RESUME_USE_AI !== "false";
  if (!useAi) {
    return fallbackScraped;
  }
  if (!env.EDENAI_API_KEY) {
    throw new Error("AI is not configured.");
  }
  const prompt = buildPrompt({
    rawText: normalizedText,
    source,
    maxChars,
    sections,
    profileHints,
    summaryHint,
  });

  void logAiEvent({
    level: "debug",
    operation: "resume_import",
    provider,
    model,
    request: {
      rawTextLength: rawText.length,
      normalizedTextLength: normalizedText.length,
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
    body: JSON.stringify({
      providers: provider,
      text: prompt,
      temperature: 0.1,
      max_tokens: maxTokens,
      model,
    }),
  });

  const responseText = await response.text();
  void logAiEvent({
    level: "debug",
    operation: "resume_import",
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
  const rawOutput =
    extractTextFromPayload(providerPayload) ??
    Object.values(payload)
      .map((value) => extractTextFromPayload(value))
      .find((value) => value);

  if (typeof rawOutput !== "string" || !rawOutput.trim()) {
    throw new Error("AI response was empty.");
  }

  let parsed: unknown = null;
  for (const candidate of extractJsonCandidates(rawOutput)) {
    const attempt = tryParseJson(candidate);
    if (attempt) {
      parsed = attempt;
      break;
    }
  }
  const coerced = coerceParsedResume(parsed);
  if (!coerced) {
    void logAiEvent({
      level: "error",
      operation: "resume_import",
      provider,
      model,
      response: {
        parseError: "invalid_json_shape",
        rawPreview: formatPreview(rawOutput),
        rawTailPreview: formatTailPreview(rawOutput),
      },
    });
  }

  const normalized = normalizeScrapedProfile(coerced ?? {});
  const filteredAi = filterScrapedProfileToSource(normalized, normalizedText);
  const merged = mergeScrapedProfiles(fallbackScraped, filteredAi);
  const mergedWithHints = applyProfileHints(merged, profileHints, summaryHint);
  const validated = scrapedProfileSchema.safeParse(mergedWithHints);
  if (!validated.success) {
    void logAiEvent({
      level: "error",
      operation: "resume_import",
      provider,
      model,
      response: {
        parseError: "schema_mismatch",
        rawPreview: formatPreview(rawOutput),
        rawTailPreview: formatTailPreview(rawOutput),
      },
    });
    throw new Error("AI response did not match the expected format.");
  }

  return validated.data;
};

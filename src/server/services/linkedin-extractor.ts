import { load } from "cheerio";
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

const EDUCATION_DATE_REGEX =
  /\b(?:\d{4})\s*(?:-|to)\s*(?:Present|\d{4})\b/i;

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

const PROFILE_SECTION_HEADERS = new Set([
  "about",
  "activity",
  "experience",
  "education",
  "skills",
  "recommendations",
  "interests",
  "projects",
  "certifications",
  "licenses",
  "honors",
  "publications",
  "volunteering",
  "courses",
]);

const PROFILE_NOISE = [
  "skip to",
  "home",
  "my network",
  "jobs",
  "messaging",
  "notifications",
  "me",
  "for business",
  "resources",
  "analytics",
  "show all",
  "get started",
  "open to",
  "add profile section",
  "enhance profile",
  "private to you",
  "connections",
  "followers",
  "message",
  "connect",
  "people you may know",
  "who your viewers also viewed",
  "visit our help center",
];

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

const normalizeKey = (value: string) => value.trim().toLowerCase();

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

const isProfileNoiseLine = (line: string) => {
  const normalized = normalizeKey(line);
  if (!normalized) return true;
  if (PROFILE_SECTION_HEADERS.has(normalized)) return false;
  return PROFILE_NOISE.some((noise) => normalized.includes(noise));
};

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

const looksLikeName = (line: string) => {
  if (!line || line.length < 3 || line.length > 70) return false;
  if (/\d/.test(line)) return false;
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][a-zA-Z'.-]*$/.test(word));
};

const looksLikeLocation = (line: string) => {
  const normalized = line.trim();
  if (!normalized) return false;
  if (EXPERIENCE_DATE_REGEX.test(normalized)) return false;
  if (normalized.includes("·")) return false;
  if (normalized.length > 90) return false;
  if (normalized.includes(",")) return true;
  return /(area|united states|remote)/i.test(normalized);
};

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-");

const htmlToText = (value: string) => {
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  return decodeHtml(stripped)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

const splitSummaryHighlights = (text: string) => {
  if (!text) return { summary: "", highlights: [] as string[] };
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const highlights: string[] = [];
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (/^[-*•]/.test(line)) {
      highlights.push(line.replace(/^[-*•]\s*/, "").trim());
    }
    summaryLines.push(line);
  }
  return { summary: summaryLines.join("\n").trim(), highlights };
};

const parseExperienceFromHtml = (html: string) => {
  if (!html) return [];
  const $ = load(html);
  const items = $('li[id*="EXPERIENCE"]');
  const fallbackItems =
    items.length > 0 ? items : $("li.pvs-list__paged-list-item");

  const experiences: {
    id?: string;
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    summary: string;
    highlights: string[];
  }[] = [];

  fallbackItems.each((_, element) => {
    const item = $(element);
    const itemId = item.attr("id") ?? "";
    const title = item
      .find(".t-bold span[aria-hidden='true']")
      .first()
      .text()
      .trim();
    const companyLine = item
      .find("span.t-14.t-normal span[aria-hidden='true']")
      .first()
      .text()
      .trim();
    const company = companyLine.split("·")[0]?.trim() ?? "";

    const dateRaw = item
      .find(".pvs-entity__caption-wrapper")
      .first()
      .text()
      .trim();
    const dateText = dateRaw.split("·")[0]?.trim() ?? dateRaw;
    const { startDate, endDate } = parseDateRange(dateText);

    const locationCandidates = item
      .find("span.t-14.t-normal.t-black--light span[aria-hidden='true']")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const location =
      locationCandidates.find(
        (value) => !EXPERIENCE_DATE_REGEX.test(value),
      ) ?? "";

    let descriptionText = "";
    const descriptionChunks: string[] = [];
    const scopedBlocks = item.find(
      ".pvs-entity__sub-components .t-14.t-normal.t-black",
    );
    const descriptionBlocks =
      scopedBlocks.length > 0
        ? scopedBlocks
        : item.find("div.t-14.t-normal.t-black");
    descriptionBlocks.each((_, block) => {
      const blockNode = $(block);
      const hiddenSpans = blockNode.find("span.visually-hidden");
      if (hiddenSpans.length > 0) {
        hiddenSpans.each((_, span) => {
          const htmlSource = $(span).html();
          if (htmlSource) descriptionChunks.push(htmlToText(htmlSource));
        });
        return;
      }
      const visibleSpans = blockNode.find("span[aria-hidden='true']");
      visibleSpans.each((_, span) => {
        const htmlSource = $(span).html();
        if (htmlSource) descriptionChunks.push(htmlToText(htmlSource));
      });
    });

    if (descriptionChunks.length > 0) {
      descriptionText = dedupeByKey(descriptionChunks, (value) =>
        normalizeKey(value),
      ).join("\n");
    }

    const { summary, highlights } = splitSummaryHighlights(descriptionText);

    const hasAny = Boolean(
      title || company || location || startDate || endDate || summary,
    );
    if (!hasAny) return;

    experiences.push({
      id: itemId,
      title,
      company,
      location,
      startDate,
      endDate,
      summary,
      highlights,
    });
  });

  return dedupeByKey(experiences, (item) =>
    normalizeKey(
      item.id
        ? item.id
        : `${item.title}|${item.company}|${item.startDate}|${item.endDate}`,
    ),
  );
};

const parseEducationFromHtml = (html: string) => {
  if (!html) return [];
  const $ = load(html);
  const items = $('li[id*="EDUCATION"]');
  const fallbackItems =
    items.length > 0 ? items : $("li.pvs-list__paged-list-item");

  const education: {
    school: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    notes: string;
  }[] = [];

  fallbackItems.each((_, element) => {
    const item = $(element);
    const school = item
      .find(".t-bold span[aria-hidden='true']")
      .first()
      .text()
      .trim();
    if (!school) return;

    const detailLines = item
      .find("span.t-14.t-normal span[aria-hidden='true']")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const degreeLine =
      detailLines.find(
        (line) =>
          line !== school &&
          !EDUCATION_DATE_REGEX.test(line) &&
          !looksLikeLocation(line),
      ) ?? "";
    const { degree, field } = degreeLine
      ? splitDegreeField(degreeLine)
      : { degree: "", field: "" };

    const dateRaw = item
      .find(".pvs-entity__caption-wrapper")
      .first()
      .text()
      .trim();
    const { startDate, endDate } = parseEducationDateRange(dateRaw);

    let notes = "";
    const notesContainer = item.find(".pvs-entity__sub-components").first();
    if (notesContainer.length > 0) {
      const hiddenSpan = notesContainer.find("span.visually-hidden").first();
      const htmlSource = hiddenSpan.length
        ? hiddenSpan.html()
        : notesContainer.find("span[aria-hidden='true']").first().html();
      if (htmlSource) {
        notes = htmlToText(htmlSource);
      }
    }

    education.push({
      school,
      degree,
      field,
      startDate,
      endDate,
      notes,
    });
  });

  return dedupeByKey(education, (item) =>
    normalizeKey(
      `${item.school}|${item.degree}|${item.field}|${item.startDate}|${item.endDate}`,
    ),
  );
};

const parseSkillsFromHtml = (html: string) => {
  if (!html) return [];
  const $ = load(html);
  const results = new Map<string, { name: string; endorsements?: number }>();

  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const parseEndorsements = (value: string) => {
    const match = value.replace(/,/g, "").match(/\d+/);
    if (!match) return null;
    const parsed = Number.parseInt(match[0] ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const isSkillName = (value: string) => {
    const lowered = value.toLowerCase();
    if (!value) return false;
    if (lowered.includes("endorsement")) return false;
    if (lowered.includes("skills")) return false;
    if (lowered.includes("show all")) return false;
    if (lowered.includes("see all")) return false;
    if (lowered.includes("industry knowledge")) return false;
    if (lowered.includes("tools") && lowered.includes("technolog")) return false;
    return true;
  };
  const addSkill = (nameRaw: string, endorsements?: number | null) => {
    const name = normalize(nameRaw);
    if (!isSkillName(name)) return;
    const key = name.toLowerCase();
    if (!key) return;
    const existing = results.get(key);
    const nextValue = {
      name,
      endorsements:
        typeof endorsements === "number" && Number.isFinite(endorsements)
          ? endorsements
          : undefined,
    };
    if (!existing) {
      results.set(key, nextValue);
      return;
    }
    const existingCount = existing.endorsements ?? 0;
    const nextCount = nextValue.endorsements ?? 0;
    if (nextCount > existingCount) {
      results.set(key, nextValue);
    }
  };

  const sections = $("section");
  let skillsSection: ReturnType<typeof $> = $();
  sections.each((_, element) => {
    if (skillsSection.length > 0) return;
    const heading = $(element).find("h2, h3, span").first().text().trim();
    if (heading.toLowerCase().includes("skills")) {
      skillsSection = $(element);
    }
  });
  const items = (skillsSection.length ? skillsSection : $.root()).find("li");
  items.each((_, element) => {
    const elementNode = $(element);
    const boldSpan = elementNode
      .find(".t-bold span[aria-hidden='true']")
      .first()
      .text()
      .trim();
    const rawText = boldSpan || elementNode.text();
    if (!rawText) return;
    const lines = rawText
      .split("\n")
      .map((line) => normalize(line))
      .filter(Boolean);
    if (!lines.length) return;

    const endorsementLine = lines.find((line) =>
      line.toLowerCase().includes("endorsement"),
    );
    const endorsements = endorsementLine
      ? parseEndorsements(endorsementLine)
      : null;
    const nameCandidate =
      lines.find(
        (line) =>
          !line.toLowerCase().includes("endorsement") &&
          !line.toLowerCase().includes("skills"),
      ) ?? lines[0];
    addSkill(nameCandidate ?? "", endorsements);
  });

  return Array.from(results.values())
    .sort((a, b) => (b.endorsements ?? 0) - (a.endorsements ?? 0))
    .map((item) => item.name);
};

const parseRecommendationsFromHtml = (html: string) => {
  if (!html) return "";
  const $ = load(html);
  const blocks: string[] = [];
  const sections = $("section");
  let recSection: ReturnType<typeof $> = $();
  sections.each((_, element) => {
    if (recSection.length > 0) return;
    const heading = $(element).find("h2, h3, span").first().text().trim();
    if (heading.toLowerCase().includes("recommendations")) {
      recSection = $(element);
    }
  });

  const items = (recSection.length ? recSection : $.root()).find("li");

  items.each((_, element) => {
    const item = $(element);
    const hidden = item.find("span.visually-hidden").first();
    const htmlSource = hidden.length
      ? hidden.html()
      : item.find("span[aria-hidden='true']").first().html();
    if (!htmlSource) return;
    const text = htmlToText(htmlSource);
    if (text.length < 40) return;
    if (text.toLowerCase().includes("recommendations")) return;
    blocks.push(text);
  });

  return dedupeByKey(blocks, (value) => normalizeKey(value)).join("\n");
};

const parseProfileFromHtml = (html: string) => {
  if (!html) return undefined;
  const $ = load(html);
  const main = $("main").first();
  const header = main.length ? main : $.root();

  const name =
    header.find("h1.text-heading-xlarge").first().text().trim() ||
    header.find("h1").first().text().trim();
  const headline = header
    .find(".text-body-medium")
    .first()
    .text()
    .trim();
  const location = header
    .find(".text-body-small")
    .filter((_, el) => {
      const text = $(el).text();
      return looksLikeLocation(text);
    })
    .first()
    .text()
    .trim();

  let summary = "";
  const aboutSection = header
    .find("section")
    .filter((_, el) => {
      const heading = $(el).find("h2, h3, span").first().text().trim();
      return heading.toLowerCase() === "about";
    })
    .first();
  if (aboutSection.length > 0) {
    const htmlSource = aboutSection.html();
    const rawText = htmlSource
      ? htmlToText(htmlSource)
      : aboutSection.text().replace(/\s+/g, " ").trim();
    const lines = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^about$/i.test(line))
      .filter((line) => !/^(see|show)\s+more$/i.test(line));
    const normalized = lines
      .map((line) => line.replace(/^about\s+/i, "").trim())
      .filter(Boolean);
    const deduped = dedupeByKey(normalized, (value) => normalizeKey(value));
    summary = deduped.join("\n").trim();
  }

  const profile = {
    fullName: name,
    headline,
    targetRole: "",
    jobField: "",
    jobType: "",
    email: "",
    phone: "",
    location,
    website: "",
    summary,
  };

  return normalizeProfile(profile);
};

const parseExperienceFallback = (text: string) => {
  if (!text) return [];
  const lines = normalizeSectionText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const findPrevIndex = (
    start: number,
    predicate: (line: string) => boolean,
  ) => {
    for (let i = start; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line || isNoiseLine(line)) continue;
      if (predicate(line)) return i;
    }
    return -1;
  };

  const dateIndices = lines
    .map((line, index) => (EXPERIENCE_DATE_REGEX.test(line) ? index : -1))
    .filter((index) => index >= 0);

  if (dateIndices.length === 0) return [];

  const markers: {
    titleIndex: number;
    companyIndex: number;
    dateIndex: number;
  }[] = [];

  for (let idx = 0; idx < dateIndices.length; idx += 1) {
    const dateIndex = dateIndices[idx];
    const beforeDateIndex = findPrevIndex(dateIndex - 1, () => true);
    if (beforeDateIndex < 0) continue;

    let titleIndex = -1;
    let companyIndex = -1;

    if (looksLikeCompanyLine(lines[beforeDateIndex])) {
      companyIndex = beforeDateIndex;
      titleIndex = findPrevIndex(companyIndex - 1, (line) => {
        if (isBulletLine(line)) return false;
        if (EXPERIENCE_DATE_REGEX.test(line)) return false;
        if (looksLikeCompanyLine(line)) return false;
        if (looksLikeLocation(line)) return false;
        return true;
      });
    } else {
      titleIndex = beforeDateIndex;
      companyIndex = findPrevIndex(titleIndex - 1, (line) =>
        looksLikeCompanyLine(line),
      );
      if (companyIndex < 0) {
        companyIndex = findPrevIndex(titleIndex - 1, (line) => {
          if (isBulletLine(line)) return false;
          if (EXPERIENCE_DATE_REGEX.test(line)) return false;
          if (looksLikeLocation(line)) return false;
          return true;
        });
      }
    }

    markers.push({ titleIndex, companyIndex, dateIndex });
  }

  if (markers.length === 0) return [];

  const dedupedMarkers: typeof markers = [];
  const seenMarkerKeys = new Set<string>();
  for (const marker of markers) {
    const title = marker.titleIndex >= 0 ? lines[marker.titleIndex] : "";
    const company =
      marker.companyIndex >= 0
        ? stripCompanySuffix(lines[marker.companyIndex])
        : "";
    const { startDate, endDate } = parseDateRange(lines[marker.dateIndex]);
    const key = normalizeKey(`${title}|${company}|${startDate}|${endDate}`);
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
    const title =
      marker.titleIndex >= 0 ? lines[marker.titleIndex] : "";
    const company =
      marker.companyIndex >= 0
        ? stripCompanySuffix(lines[marker.companyIndex])
        : "";
    const { startDate, endDate } = parseDateRange(lines[marker.dateIndex]);
    const nextStart = nextMarker
      ? Math.min(
          nextMarker.titleIndex >= 0 ? nextMarker.titleIndex : lines.length,
          nextMarker.companyIndex >= 0 ? nextMarker.companyIndex : lines.length,
          nextMarker.dateIndex,
        )
      : lines.length;

    const detailStart = marker.dateIndex + 1;
    const detailEnd = Math.max(detailStart, nextStart - 1);
    const details = lines.slice(detailStart, detailEnd + 1);

    let location = "";
    const summaryLines: string[] = [];
    const highlights: string[] = [];
    const seenDetail = new Set<string>();

    for (const detail of details) {
      if (!detail || isNoiseLine(detail)) continue;
      if (detail === title || detail === company) continue;
      if (EXPERIENCE_DATE_REGEX.test(detail)) continue;
      const normalizedDetail = normalizeKey(detail);
      if (normalizedDetail && seenDetail.has(normalizedDetail)) continue;
      if (normalizedDetail) seenDetail.add(normalizedDetail);
      if (isBulletLine(detail)) {
        highlights.push(detail.replace(/^[-*•]\s+/, "").trim());
        summaryLines.push(detail);
        continue;
      }
      if (!location && looksLikeLocation(detail)) {
        location = detail;
        continue;
      }
      summaryLines.push(detail);
    }

    const summary = summaryLines.join("\n").trim();

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

const parseProfileSummary = (lines: string[]) => {
  const startIndex = lines.findIndex(
    (line) => normalizeKey(line) === "about",
  );
  if (startIndex === -1) return "";

  const summaryLines: string[] = [];
  const seen = new Set<string>();
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const normalized = normalizeKey(line);
    if (PROFILE_SECTION_HEADERS.has(normalized)) break;
    if (isProfileNoiseLine(line)) continue;
    if (normalized && seen.has(normalized)) continue;
    if (normalized) seen.add(normalized);
    summaryLines.push(line);
  }

  return summaryLines.join(" ").trim();
};

const parseProfileFallback = (profileText: string) => {
  if (!profileText) return undefined;
  const lines = normalizeSectionText(profileText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const nameCandidates = lines.filter(
    (line) => !isProfileNoiseLine(line) && looksLikeName(line),
  );
  const fullName =
    nameCandidates.sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
    )[0] ?? "";
  const nameIndex = fullName ? lines.indexOf(fullName) : -1;

  const findNextLine = (
    start: number,
    predicate: (line: string) => boolean,
  ) => {
    for (let i = start; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || isProfileNoiseLine(line)) continue;
      if (predicate(line)) return line;
    }
    return "";
  };

  const headline =
    nameIndex >= 0
      ? findNextLine(nameIndex + 1, (line) => {
          if (line === fullName) return false;
          if (looksLikeName(line)) return false;
          if (looksLikeLocation(line)) return false;
          return true;
        })
      : "";

  const location =
    nameIndex >= 0
      ? findNextLine(nameIndex + 1, (line) => looksLikeLocation(line))
      : "";

  const summary = parseProfileSummary(lines);

  const profile = {
    fullName,
    headline,
    targetRole: "",
    jobField: "",
    jobType: "",
    email: "",
    phone: "",
    location,
    website: "",
    summary,
  };

  return normalizeProfile(profile);
};

function parseEducationDateRange(line: string) {
  const match = line.match(
    /(\b\d{4})\s*(?:-|to)\s*(Present|\d{4})/i,
  );
  if (!match) return { startDate: "", endDate: "" };
  return { startDate: match[1], endDate: match[2] };
}

function looksLikeDegreeLine(line: string) {
  const normalized = normalizeKey(line);
  if (!normalized) return false;
  return EDU_DEGREE_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );
}

function splitDegreeField(line: string) {
  const commaParts = line
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length > 1) {
    return { degree: commaParts[0], field: commaParts.slice(1).join(", ") };
  }
  const inParts = line.split(/\s+in\s+/i).map((part) => part.trim());
  if (inParts.length > 1) {
    return { degree: inParts[0], field: inParts.slice(1).join(" in ") };
  }
  return { degree: line.trim(), field: "" };
}

const parseEducationFallback = (educationText: string) => {
  if (!educationText) return [];
  const lines = normalizeSectionText(educationText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: {
    school: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    notes: string;
  }[] = [];

  const isEducationNoise = (line: string) => {
    const normalized = normalizeKey(line);
    if (!normalized) return true;
    if (normalized === "education") return true;
    if (normalized.startsWith("show all")) return true;
    return false;
  };

  let current: (typeof entries)[number] | null = null;
  for (const line of lines) {
    if (isEducationNoise(line)) continue;
    if (EDUCATION_DATE_REGEX.test(line)) {
      const { startDate, endDate } = parseEducationDateRange(line);
      if (current && !current.startDate && startDate) {
        current.startDate = startDate;
        current.endDate = endDate;
      }
      continue;
    }

    if (!looksLikeDegreeLine(line) && !looksLikeLocation(line)) {
      if (current?.school) entries.push(current);
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

    if (!current) continue;
    if (looksLikeDegreeLine(line)) {
      const { degree, field } = splitDegreeField(line);
      if (!current.degree) current.degree = degree;
      if (!current.field && field) current.field = field;
      continue;
    }

    if (!current.notes) current.notes = line;
  }

  if (current?.school) entries.push(current);

  return dedupeByKey(entries, (item) => normalizeKey(item.school));
};

const parseLinksFallback = (profileText: string) => {
  if (!profileText) return [];
  const urlMatches = profileText.match(
    /(https?:\/\/[^\s]+|www\.[^\s]+)/gi,
  );
  if (!urlMatches) return [];
  const seen = new Set<string>();
  return urlMatches
    .map((url) => url.trim().replace(/[),.]+$/, ""))
    .filter((url) => {
      const normalized = url.toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((url, index) => ({
      id: `link-${index + 1}`,
      label: "Website",
      url: url.startsWith("http") ? url : `https://${url}`,
    }));
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

const buildAlgorithmicPrompt = ({
  seed,
  url,
  profileText,
  experienceText,
  educationText,
  skillsText,
  recommendationsText,
  maxChars,
}: {
  seed: ScrapedProfile;
  url: string;
  profileText: string;
  experienceText: string;
  educationText: string;
  skillsText: string;
  recommendationsText: string;
  maxChars: number;
}) => {
  const instructions = [
    "You are normalizing a structured LinkedIn extraction.",
    "Use ALGO_EXTRACT_JSON as the source of truth.",
    "Only fill missing fields using RAW sections when provided.",
    "Do not invent new roles, schools, or skills that are not in ALGO_EXTRACT_JSON or RAW sections.",
    "Return ONLY valid JSON that matches this shape:",
    '{ "profile": { "fullName": "", "headline": "", "targetRole": "", "jobField": "", "jobType": "", "email": "", "phone": "", "location": "", "website": "", "summary": "" }, "skills": [""] , "experiences": [ { "id": "exp-1", "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "summary": "", "highlights": [""] } ], "education": [ { "id": "edu-1", "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "notes": "" } ], "links": [ { "id": "link-1", "label": "", "url": "" } ] }',
    "Keep summaries and highlights exactly as given; only trim whitespace and remove duplicates.",
    "Use ASCII only. Do not include markdown or commentary.",
  ].join("\n");

  const sections: string[] = [
    `SOURCE_URL: ${url}`,
    `ALGO_EXTRACT_JSON\n${JSON.stringify(seed)}`,
  ];

  const includeProfile =
    !seed.profile?.fullName ||
    !seed.profile?.headline ||
    !seed.profile?.summary;
  if (includeProfile && profileText) {
    sections.push(buildSection("PROFILE_PAGE", profileText, maxChars));
  }

  if ((!seed.experiences || seed.experiences.length === 0) && experienceText) {
    sections.push(buildSection("EXPERIENCE_DETAILS", experienceText, maxChars));
  }

  if ((!seed.education || seed.education.length === 0) && educationText) {
    sections.push(buildSection("EDUCATION_DETAILS", educationText, maxChars));
  }

  // Skills are sourced only from SKILLS_ENDORSEMENTS_JSON.

  if (recommendationsText) {
    sections.push(
      buildSection("RECOMMENDATIONS_DETAILS", recommendationsText, maxChars),
    );
  }

  return [instructions, ...sections].join("\n\n");
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
    "industry knowledge",
    "tools & technologies",
    "tools and technologies",
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
    .map((item, index) => {
      if (typeof item === "string") {
        return { name: item.trim(), endorsements: undefined, index };
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name.trim()
          : typeof record.skill === "string"
            ? record.skill.trim()
            : "";
      if (!name) return null;
      const rawEndorsements =
        typeof record.endorsements === "number"
          ? record.endorsements
          : typeof record.endorsements === "string"
            ? Number.parseInt(record.endorsements, 10)
            : undefined;
      const endorsements =
        typeof rawEndorsements === "number" && Number.isFinite(rawEndorsements)
          ? rawEndorsements
          : undefined;
      return { name, endorsements, index };
    })
    .filter(Boolean) as Array<{
    name: string;
    endorsements?: number;
    index: number;
  }>;

  const hasEndorsements = mapped.some(
    (item) => typeof item.endorsements === "number",
  );
  const sorted = hasEndorsements
    ? [...mapped].sort((a, b) => {
        const diff = (b.endorsements ?? 0) - (a.endorsements ?? 0);
        return diff !== 0 ? diff : a.index - b.index;
      })
    : mapped;

  const seen = new Set<string>();
  return sorted
    .map((item) => item.name)
    .filter((skill) => {
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
  "new feed updates",
  "my network",
  "jobs",
  "messaging",
  "notifications",
  "for business",
  "claim 1 free month",
  "about",
  "accessibility",
  "talent solutions",
  "professional community policies",
  "careers",
  "marketing solutions",
  "privacy",
  "terms",
  "ad choices",
  "advertising",
  "sales solutions",
  "mobile",
  "small business",
  "safety center",
  "questions?",
  "manage your account",
  "recommendation transparency",
  "view",
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
  rawHtml,
  rawHtmlBySection,
  rawDetails,
  url,
}: {
  rawText: string;
  rawHtml?: string;
  rawHtmlBySection?: Record<string, string>;
  rawDetails?: Record<string, unknown>;
  url: string;
}): Promise<ScrapedProfile> => {
  const maxPromptChars = env.EDENAI_MAX_PROMPT_CHARS ?? DEFAULT_PROMPT_LIMIT;
  const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const markers = SECTION_MARKERS.filter((marker) => rawText.includes(marker));
  const rawSectionLimit = Math.min(maxPromptChars, 5000);
  const htmlContent = rawHtml?.trim() ?? "";
  const detailHtml = rawHtmlBySection ?? {};
  const details = (rawDetails ?? {}) as {
    profile?: Record<string, unknown>;
    experiences?: Array<Record<string, unknown>>;
    education?: Array<Record<string, unknown>>;
    skills?: Array<Record<string, unknown>>;
    recommendations?: string[] | string;
  };
  const experienceHtml = detailHtml.experience ?? htmlContent;
  const educationHtml = detailHtml.education ?? "";
  const skillsHtml = detailHtml.skills ?? "";
  const recommendationsHtml = detailHtml.recommendations ?? "";
  const tokenBudget = Math.max(maxTokens, MIN_SECTION_TOKENS.full);

  void logAiEvent({
    level: "debug",
    operation: "linkedin_extract",
    provider,
    model,
    request: {
      rawTextLength: rawText.length,
      rawHtmlLength: htmlContent.length,
      detailHtmlLengths: {
        experience: experienceHtml.length,
        education: educationHtml.length,
        skills: skillsHtml.length,
        recommendations: recommendationsHtml.length,
      },
      maxPromptChars,
      maxTokens,
      tokenBudget: { full: tokenBudget },
      markers,
    },
  });

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
  const skillsJson = extractMarkerLine(rawText, "SKILLS_ENDORSEMENTS_JSON");

  const htmlExperiences =
    experienceHtml && experienceHtml.includes("EXPERIENCE")
      ? parseExperienceFromHtml(experienceHtml)
      : [];
  const htmlEducation = educationHtml
    ? parseEducationFromHtml(educationHtml)
    : [];
  const htmlSkills = skillsHtml ? parseSkillsFromHtml(skillsHtml) : [];
  const htmlRecommendations = recommendationsHtml
    ? parseRecommendationsFromHtml(recommendationsHtml)
    : "";
  const htmlProfile = htmlContent ? parseProfileFromHtml(htmlContent) : undefined;
  const htmlTextFallback = htmlContent ? htmlToText(htmlContent) : "";

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
      htmlExperienceCount: htmlExperiences.length,
      htmlEducationCount: htmlEducation.length,
      htmlSkillsCount: htmlSkills.length,
      htmlRecommendationsLength: htmlRecommendations.length,
    },
  });

  const experienceSource =
    experienceText || profileText || rawText || htmlTextFallback;
  const educationSource =
    educationText || profileText || rawText || htmlTextFallback;
  const profileSource = profileText || rawText || htmlTextFallback;
  const recommendationSource =
    (Array.isArray(details.recommendations)
      ? details.recommendations.join("\n")
      : typeof details.recommendations === "string"
        ? details.recommendations
        : "") ||
    htmlRecommendations ||
    recommendationsText;

  const mergedProfile = mergeProfiles(
    { profile: details.profile ?? htmlProfile },
    { profile: parseProfileFallback(profileSource) },
  );
  const candidateProfile = normalizeProfile(mergedProfile);
  const fallbackProfile = parseProfileFallback(profileSource);
  const chooseLonger = (a?: string, b?: string) => {
    const aValue = a?.trim() ?? "";
    const bValue = b?.trim() ?? "";
    if (!aValue) return bValue;
    if (!bValue) return aValue;
    return bValue.length > aValue.length ? bValue : aValue;
  };
  const algorithmicProfile = candidateProfile
    ? {
        ...candidateProfile,
        summary: chooseLonger(candidateProfile.summary, fallbackProfile?.summary),
      }
    : fallbackProfile;
  const rawDetailExperiences =
    Array.isArray(details.experiences) && details.experiences.length > 0
      ? details.experiences
      : null;
  const algorithmicExperiences = (
    rawDetailExperiences
      ? rawDetailExperiences
      : htmlExperiences.length > 0
        ? htmlExperiences
        : parseExperienceFallback(experienceSource)
  ).map((item, index) => ({
    id:
      typeof item.id === "string" && item.id.trim()
        ? item.id
        : `exp-${index + 1}`,
    title: typeof item.title === "string" ? item.title : "",
    company: typeof item.company === "string" ? item.company : "",
    location: typeof item.location === "string" ? item.location : "",
    startDate: typeof item.startDate === "string" ? item.startDate : "",
    endDate: typeof item.endDate === "string" ? item.endDate : "",
    summary: typeof item.summary === "string" ? item.summary : "",
    highlights: Array.isArray(item.highlights)
      ? item.highlights.filter((value) => typeof value === "string")
      : [],
  }));
  const algorithmicEducation = (
    Array.isArray(details.education) && details.education.length > 0
      ? details.education
      : htmlEducation.length > 0
        ? htmlEducation
        : parseEducationFallback(educationSource)
  ).map((item, index) => ({
    id:
      typeof item.id === "string" && item.id.trim()
        ? item.id
        : `edu-${index + 1}`,
    school: typeof item.school === "string" ? item.school : "",
    degree: typeof item.degree === "string" ? item.degree : "",
    field: typeof item.field === "string" ? item.field : "",
    startDate: typeof item.startDate === "string" ? item.startDate : "",
    endDate: typeof item.endDate === "string" ? item.endDate : "",
    notes: typeof item.notes === "string" ? item.notes : "",
  }));
  const jsonSkills =
    Array.isArray(details.skills) && details.skills.length > 0
      ? normalizeSkillsList(details.skills)
      : parseSkillsFallback(rawText);
  const algorithmicSkills = jsonSkills;
  const algorithmicLinks = parseLinksFallback(profileSource);

  let collected: ScrapedProfile = {
    profile: algorithmicProfile,
    experiences: algorithmicExperiences.length
      ? algorithmicExperiences
      : undefined,
    education: algorithmicEducation.length ? algorithmicEducation : undefined,
    skills: algorithmicSkills.length ? algorithmicSkills : undefined,
    links: algorithmicLinks.length ? algorithmicLinks : undefined,
  };

  void logAiEvent({
    level: "debug",
    operation: "linkedin_extract_algorithmic",
    provider,
    model,
    meta: {
      hasProfile: Boolean(collected.profile?.fullName),
      experienceCount: algorithmicExperiences.length,
      educationCount: algorithmicEducation.length,
      skillsCount: algorithmicSkills.length,
      linksCount: algorithmicLinks.length,
    },
  });

  const algoEmpty =
    !collected.profile &&
    !(collected.experiences && collected.experiences.length > 0) &&
    !(collected.education && collected.education.length > 0) &&
    !(collected.skills && collected.skills.length > 0);

  if (env.EDENAI_API_KEY) {
    const prompt = algoEmpty
      ? buildPrompt(rawText, url, maxPromptChars)
      : buildAlgorithmicPrompt({
          seed: collected,
          url,
          profileText: profileSource,
          experienceText,
          educationText,
          skillsText,
          recommendationsText: recommendationSource,
          maxChars: rawSectionLimit,
        });
    const result = await callEdenSection({
      operation: algoEmpty ? "linkedin_extract_full" : "linkedin_structure",
      prompt,
      provider,
      model,
      maxTokens: tokenBudget,
    });
    if (result) {
      collected = mergeScrapedProfiles(collected, result);
    }
  }

  if (jsonSkills.length > 0) {
    collected.skills = jsonSkills;
  } else {
    collected.skills = [];
  }

  if (algorithmicExperiences.length > 0) {
    collected.experiences = algorithmicExperiences;
  }

  if (algorithmicEducation.length > 0) {
    collected.education = algorithmicEducation;
  }

  if (algorithmicLinks.length > 0) {
    collected.links = mergeLinks(algorithmicLinks, collected.links ?? []);
  }

  const mergedSkills =
    algorithmicSkills.length > 0
      ? mergeSkills(algorithmicSkills, collected.skills ?? [])
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

import { jsonrepair } from "jsonrepair";
import { z } from "zod";

import { env } from "~/env";
import {
  resumeProfileSchema,
  type ResumeDraft,
  type ScrapedProfile,
} from "~/lib/resume/types";
import {
  formatPreview,
  formatTailPreview,
  logAiEvent,
} from "~/server/services/ai-logger";

const experienceUpdateSchema = z
  .object({
    title: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    summary: z.string().optional(),
    highlights: z.array(z.string()).optional(),
  })
  .partial();

const educationUpdateSchema = z
  .object({
    school: z.string().optional(),
    degree: z.string().optional(),
    field: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    notes: z.string().optional(),
  })
  .partial();

const projectUpdateSchema = z
  .object({
    name: z.string().optional(),
    role: z.string().optional(),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    url: z.string().optional(),
  })
  .partial();

const certificationUpdateSchema = z
  .object({
    name: z.string().optional(),
    issuer: z.string().optional(),
    issueDate: z.string().optional(),
    expirationDate: z.string().optional(),
    credentialId: z.string().optional(),
    credentialUrl: z.string().optional(),
  })
  .partial();

const honorUpdateSchema = z
  .object({
    title: z.string().optional(),
    issuer: z.string().optional(),
    date: z.string().optional(),
    description: z.string().optional(),
  })
  .partial();

const volunteerUpdateSchema = z
  .object({
    role: z.string().optional(),
    organization: z.string().optional(),
    cause: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    summary: z.string().optional(),
  })
  .partial();

const serviceUpdateSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .partial();

const linkUpdateSchema = z
  .object({
    label: z.string().optional(),
    url: z.string().optional(),
  })
  .partial();

const consultantUpdateSchema = z
  .object({
    profile: resumeProfileSchema.partial().optional(),
    skills: z.array(z.string()).optional(),
    experiences: z.array(experienceUpdateSchema).optional(),
    education: z.array(educationUpdateSchema).optional(),
    projects: z.array(projectUpdateSchema).optional(),
    certifications: z.array(certificationUpdateSchema).optional(),
    honors: z.array(honorUpdateSchema).optional(),
    volunteering: z.array(volunteerUpdateSchema).optional(),
    services: z.array(serviceUpdateSchema).optional(),
    links: z.array(linkUpdateSchema).optional(),
  })
  .partial();

const consultantResponseSchema = z.object({
  assistant: z.string().optional(),
  updates: consultantUpdateSchema.optional(),
  followUps: z.array(z.string()).optional(),
});

type ConsultantResponse = z.infer<typeof consultantResponseSchema>;

const DEFAULT_MAX_TOKENS = 640;
const normalizeKey = (value?: string) => (value ?? "").trim().toLowerCase();

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

const sanitizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const sanitizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];

const hasUpdateValue = (value: unknown) =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

const sanitizeProfileUpdates = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const next: Partial<ResumeDraft["profile"]> = {};
  const fields: Array<keyof ResumeDraft["profile"]> = [
    "fullName",
    "headline",
    "targetRole",
    "jobField",
    "jobType",
    "email",
    "phone",
    "location",
    "website",
    "summary",
  ];
  for (const field of fields) {
    const cleaned = sanitizeString(record[field as string]);
    if (cleaned) next[field] = cleaned;
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

const sanitizeExperienceUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    title: sanitizeString(record.title),
    company: sanitizeString(record.company),
    location: sanitizeString(record.location),
    startDate: sanitizeString(record.startDate),
    endDate: sanitizeString(record.endDate),
    summary: sanitizeString(record.summary),
    highlights: sanitizeStringArray(record.highlights),
  };
  return Object.values(next).some(hasUpdateValue)
    ? next
    : null;
};

const sanitizeEducationUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    school: sanitizeString(record.school),
    degree: sanitizeString(record.degree),
    field: sanitizeString(record.field),
    startDate: sanitizeString(record.startDate),
    endDate: sanitizeString(record.endDate),
    notes: sanitizeString(record.notes),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeProjectUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    name: sanitizeString(record.name),
    role: sanitizeString(record.role),
    description: sanitizeString(record.description),
    startDate: sanitizeString(record.startDate),
    endDate: sanitizeString(record.endDate),
    url: sanitizeString(record.url),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeCertificationUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    name: sanitizeString(record.name),
    issuer: sanitizeString(record.issuer),
    issueDate: sanitizeString(record.issueDate),
    expirationDate: sanitizeString(record.expirationDate),
    credentialId: sanitizeString(record.credentialId),
    credentialUrl: sanitizeString(record.credentialUrl),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeHonorUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    title: sanitizeString(record.title),
    issuer: sanitizeString(record.issuer),
    date: sanitizeString(record.date),
    description: sanitizeString(record.description),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeVolunteerUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    role: sanitizeString(record.role),
    organization: sanitizeString(record.organization),
    cause: sanitizeString(record.cause),
    startDate: sanitizeString(record.startDate),
    endDate: sanitizeString(record.endDate),
    summary: sanitizeString(record.summary),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeServiceUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    name: sanitizeString(record.name),
    description: sanitizeString(record.description),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeLinkUpdate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {
    label: sanitizeString(record.label),
    url: sanitizeString(record.url),
  };
  return Object.values(next).some(hasUpdateValue) ? next : null;
};

const sanitizeUpdateArray = <T>(
  value: unknown,
  sanitizer: (value: unknown) => T | null,
) => {
  if (!Array.isArray(value)) return [];
  const cleaned: T[] = [];
  for (const item of value) {
    const next = sanitizer(item);
    if (next) cleaned.push(next);
  }
  return cleaned;
};

const sanitizeConsultantUpdates = (value: unknown) => {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const updates: z.infer<typeof consultantUpdateSchema> = {};

  const profile = sanitizeProfileUpdates(record.profile);
  if (profile) updates.profile = profile;

  const skills = sanitizeStringArray(record.skills);
  if (skills.length > 0) updates.skills = skills;

  const education = sanitizeUpdateArray(
    record.education,
    sanitizeEducationUpdate,
  );
  if (education.length > 0) updates.education = education;

  const projects = sanitizeUpdateArray(
    record.projects,
    sanitizeProjectUpdate,
  );
  if (projects.length > 0) updates.projects = projects;

  const certifications = sanitizeUpdateArray(
    record.certifications,
    sanitizeCertificationUpdate,
  );
  if (certifications.length > 0) updates.certifications = certifications;

  const honors = sanitizeUpdateArray(record.honors, sanitizeHonorUpdate);
  if (honors.length > 0) updates.honors = honors;

  const volunteering = sanitizeUpdateArray(
    record.volunteering,
    sanitizeVolunteerUpdate,
  );
  if (volunteering.length > 0) updates.volunteering = volunteering;

  const services = sanitizeUpdateArray(record.services, sanitizeServiceUpdate);
  if (services.length > 0) updates.services = services;

  const links = sanitizeUpdateArray(record.links, sanitizeLinkUpdate);
  if (links.length > 0) updates.links = links;

  const experiences = sanitizeUpdateArray(
    record.experiences,
    sanitizeExperienceUpdate,
  );
  if (experiences.length > 0) {
    const projectNames = new Set(
      projects.map((item) => normalizeKey(item.name)).filter(Boolean),
    );
    const certificationNames = new Set(
      certifications.map((item) => normalizeKey(item.name)).filter(Boolean),
    );
    const honorTitles = new Set(
      honors.map((item) => normalizeKey(item.title)).filter(Boolean),
    );
    const serviceNames = new Set(
      services.map((item) => normalizeKey(item.name)).filter(Boolean),
    );
    const linkTokens = new Set(
      links
        .flatMap((item) => [item.label, item.url])
        .map((value) => normalizeKey(value))
        .filter(Boolean),
    );
    const volunteerPairs = new Set(
      volunteering
        .map((item) =>
          `${normalizeKey(item.role)}::${normalizeKey(item.organization)}`,
        )
        .filter((value) => value !== "::"),
    );
    const volunteerRoles = new Set(
      volunteering.map((item) => normalizeKey(item.role)).filter(Boolean),
    );
    const volunteerOrgs = new Set(
      volunteering
        .map((item) => normalizeKey(item.organization))
        .filter(Boolean),
    );

    const filteredExperiences = experiences.filter((item) => {
      const titleKey = normalizeKey(item.title);
      const companyKey = normalizeKey(item.company);
      if (!titleKey && !companyKey) return false;

      const pairKey = `${titleKey}::${companyKey}`;
      if (volunteerPairs.has(pairKey)) return false;
      if (titleKey && projectNames.has(titleKey) && !companyKey) return false;
      if (titleKey && certificationNames.has(titleKey)) return false;
      if (titleKey && honorTitles.has(titleKey)) return false;
      if (titleKey && serviceNames.has(titleKey) && !companyKey) return false;
      if (titleKey && linkTokens.has(titleKey)) return false;
      if (companyKey && linkTokens.has(companyKey)) return false;
      if (titleKey && volunteerRoles.has(titleKey) && volunteerOrgs.has(companyKey)) {
        return false;
      }

      const summaryKey = normalizeKey(item.summary);
      if (
        summaryKey.includes("volunteer") ||
        summaryKey.includes("certification") ||
        summaryKey.includes("certificate") ||
        summaryKey.includes("award") ||
        summaryKey.includes("honor") ||
        summaryKey.includes("service")
      ) {
        return false;
      }

      return true;
    });

    if (filteredExperiences.length > 0) {
      updates.experiences = filteredExperiences;
    }
  }

  return updates;
};

const normalizeConsultantResponse = (
  rawText: string,
): ConsultantResponse | null => {
  let parsed: unknown = null;
  for (const candidate of extractJsonCandidates(rawText)) {
    const attempt = tryParseJson(candidate);
    if (attempt) {
      parsed = attempt;
      break;
    }
  }
  if (!parsed) return null;
  const normalized = consultantResponseSchema.safeParse(parsed);
  if (normalized.success) return normalized.data;

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const cleaned = {
    assistant: sanitizeString(record.assistant) || undefined,
    updates: sanitizeConsultantUpdates(record.updates),
    followUps: sanitizeStringArray(record.followUps),
  };
  const cleanedNormalized = consultantResponseSchema.safeParse(cleaned);
  return cleanedNormalized.success ? cleanedNormalized.data : null;
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

const summarizeDraft = (draft: ResumeDraft) => {
  const profile = {
    fullName: draft.profile.fullName,
    headline: draft.profile.headline,
    targetRole: draft.profile.targetRole,
    jobField: draft.profile.jobField,
    jobType: draft.profile.jobType,
    location: draft.profile.location,
    summary: draft.profile.summary,
  };

  const experiences = draft.experiences
    .filter((item) => item.title || item.company)
    .slice(0, 12)
    .map((item) => ({
      title: item.title,
      company: item.company,
      location: item.location,
      startDate: item.startDate,
      endDate: item.endDate,
    }));

  const education = draft.education
    .filter((item) => item.school)
    .slice(0, 12)
    .map((item) => ({
      school: item.school,
      degree: item.degree,
      field: item.field,
      startDate: item.startDate,
      endDate: item.endDate,
    }));

  const projects = draft.projects
    .filter((item) => item.name)
    .slice(0, 12)
    .map((item) => ({
      name: item.name,
      role: item.role,
      startDate: item.startDate,
      endDate: item.endDate,
      url: item.url,
    }));

  const certifications = draft.certifications
    .filter((item) => item.name)
    .slice(0, 12)
    .map((item) => ({
      name: item.name,
      issuer: item.issuer,
      issueDate: item.issueDate,
      expirationDate: item.expirationDate,
    }));

  const honors = draft.honors
    .filter((item) => item.title)
    .slice(0, 12)
    .map((item) => ({
      title: item.title,
      issuer: item.issuer,
      date: item.date,
    }));

  const volunteering = draft.volunteering
    .filter((item) => item.role || item.organization)
    .slice(0, 12)
    .map((item) => ({
      role: item.role,
      organization: item.organization,
      cause: item.cause,
      startDate: item.startDate,
      endDate: item.endDate,
    }));

  const services = draft.services
    .filter((item) => item.name)
    .slice(0, 12)
    .map((item) => ({
      name: item.name,
      description: item.description,
    }));

  const links = draft.links
    .filter((item) => item.url || item.label)
    .slice(0, 12)
    .map((item) => ({
      label: item.label,
      url: item.url,
    }));

  return {
    profile,
    skills: draft.skills.slice(0, 40),
    experiences,
    education,
    projects,
    certifications,
    honors,
    volunteering,
    services,
    links,
  };
};

const buildPrompt = ({
  draft,
  scraped,
  messages,
  strict,
}: {
  draft: ResumeDraft;
  scraped?: ScrapedProfile | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  strict?: boolean;
}) => {
  const snapshot = summarizeDraft(draft);
  const history = messages
    .slice(-6)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");

  return [
    "You are an expert resume consultant.",
    "Your job: extract new resume info from the user's message and update the resume draft.",
    "Do not invent facts. Only use what the user said.",
    "The user may mention multiple categories in one paragraph (jobs, projects, certifications, honors, volunteering, services, links, skills). Capture each in the right array.",
    "Split multi-sentence messages into distinct items when they refer to different roles or projects.",
    "If the user mentions multiple items, split them into multiple entries.",
    "Infer the right category: role + company or job dates -> experience; 'built/launched/shipped' -> project; 'certified/license' -> certification; awards -> honors; volunteer roles -> volunteering.",
    "Each item must appear in exactly one category. Do not duplicate items across arrays.",
    "Only add to experiences if it is a job with a title or company. Do not place projects, certifications, honors, volunteering, services, or links in experiences.",
    "If the user provides contact info, put email/phone into profile updates.",
    "If the user gives a project or role without a name, derive a short name or title from their wording (do not invent).",
    "If the user asks you to look something up, ask for the exact wording instead of guessing.",
    "Use the existing snapshot to avoid duplicates. Update matching items if the user clarifies them.",
    "If a new item is missing a date or key detail, add a follow-up question asking for it.",
    "If the latest user message answers earlier follow-ups, do not repeat them.",
    strict
      ? "Return a single JSON object only. No code fences, no extra text."
      : "Return ONLY JSON in this shape:",
    '{ "assistant": "", "updates": { "profile": {}, "skills": [], "experiences": [], "education": [], "projects": [], "certifications": [], "honors": [], "volunteering": [], "services": [], "links": [] }, "followUps": [""] }',
    "Use ASCII only. Markdown is allowed for bullets in summaries.",
    "Do not include ids in updates.",
    `CURRENT_SNAPSHOT: ${JSON.stringify(snapshot)}`,
    scraped ? `SCRAPED_AVAILABLE: true` : "SCRAPED_AVAILABLE: false",
    history ? `CONVERSATION:\n${history}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const runConsultantIntake = async ({
  draft,
  scraped,
  messages,
  strict = false,
}: {
  draft: ResumeDraft;
  scraped?: ScrapedProfile | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  strict?: boolean;
}): Promise<ConsultantResponse> => {
  if (!env.EDENAI_API_KEY) {
    throw new Error("AI is not configured.");
  }

  const provider = env.EDENAI_PROVIDER ?? "openai";
  const model = env.EDENAI_MODEL ?? "gpt-4o";
  const maxTokens = env.EDENAI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS;
  const input = buildPrompt({ draft, scraped, messages, strict });

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
    operation: "consultant_intake",
    provider,
    model,
    request: {
      promptPreview: formatPreview(input),
    },
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

  const normalized = normalizeConsultantResponse(rawText);
  if (!normalized) {
    void logAiEvent({
      level: "error",
      operation: "consultant_intake",
      provider,
      model,
      response: {
        parseError: "schema_mismatch",
        rawPreview: formatPreview(rawText),
        rawTailPreview: formatTailPreview(rawText),
      },
    });
    if (!strict) {
      return runConsultantIntake({
        draft,
        scraped,
        messages,
        strict: true,
      });
    }
    throw new Error("AI response did not match the expected format.");
  }

  return normalized;
};

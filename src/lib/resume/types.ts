import { z } from "zod";

export const resumeExperienceSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

export const resumeEducationSchema = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string().optional(),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

export const resumeLinkSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
});

export const resumeProfileSchema = z.object({
  fullName: z.string(),
  headline: z.string().optional(),
  targetRole: z.string().optional(),
  jobField: z.string().optional(),
  jobType: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  summary: z.string().optional(),
});

export const resumeDraftSchema = z.object({
  profile: resumeProfileSchema,
  skills: z.array(z.string()),
  experiences: z.array(resumeExperienceSchema),
  education: z.array(resumeEducationSchema),
  links: z.array(resumeLinkSchema),
});

export const scrapedProfileSchema = z.object({
  profile: resumeProfileSchema.partial().optional(),
  skills: z.array(z.string()).optional(),
  experiences: z.array(resumeExperienceSchema).optional(),
  education: z.array(resumeEducationSchema).optional(),
  links: z.array(resumeLinkSchema).optional(),
});

export type ResumeDraft = z.infer<typeof resumeDraftSchema>;
export type ScrapedProfile = z.infer<typeof scrapedProfileSchema>;

const normalizeText = (value: string) => value.trim();

const uniqueList = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const createId = () => Math.random().toString(36).slice(2, 10);

export const createEmptyDraft = (): ResumeDraft => ({
  profile: {
    fullName: "",
    headline: "",
    targetRole: "",
    jobField: "",
    jobType: "",
    email: "",
    phone: "",
    location: "",
    website: "",
    summary: "",
  },
  skills: [],
  experiences: [
    {
      id: createId(),
      title: "",
      company: "",
      location: "",
      startDate: "",
      endDate: "",
      summary: "",
      highlights: [],
    },
  ],
  education: [
    {
      id: createId(),
      school: "",
      degree: "",
      field: "",
      startDate: "",
      endDate: "",
      notes: "",
    },
  ],
  links: [
    {
      id: createId(),
      label: "Portfolio",
      url: "",
    },
  ],
});

export const applyScrapedProfile = (
  draft: ResumeDraft,
  scraped: ScrapedProfile | null,
): ResumeDraft => {
  if (!scraped) return draft;

  const profile = { ...draft.profile };
  for (const [key, value] of Object.entries(scraped.profile ?? {})) {
    if (!value) continue;
    const field = key as keyof ResumeDraft["profile"];
    if (!profile[field]) {
      profile[field] = value as string;
    }
  }

  return {
    ...draft,
    profile,
    skills: mergeSkills(draft.skills, scraped.skills ?? []),
    experiences:
      draft.experiences.some((item) => item.title || item.company)
        ? draft.experiences
        : (scraped.experiences ?? draft.experiences),
    education:
      draft.education.some((item) => item.school)
        ? draft.education
        : (scraped.education ?? draft.education),
    links:
      draft.links.some((item) => item.url)
        ? draft.links
        : (scraped.links ?? draft.links),
  };
};

export const mergeSkills = (current: string[], additions: string[]) =>
  uniqueList([...current, ...additions].map(normalizeText));

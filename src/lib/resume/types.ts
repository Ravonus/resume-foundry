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

export const resumeProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  url: z.string().optional(),
});

export const resumeServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const resumeCertificationSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().optional(),
  issueDate: z.string().optional(),
  expirationDate: z.string().optional(),
  credentialId: z.string().optional(),
  credentialUrl: z.string().optional(),
});

export const resumeHonorSchema = z.object({
  id: z.string(),
  title: z.string(),
  issuer: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
});

export const resumeVolunteerSchema = z.object({
  id: z.string(),
  role: z.string(),
  organization: z.string().optional(),
  cause: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  summary: z.string().optional(),
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
  headshotUrl: z.string().optional(),
});

export const resumeDraftSchema = z.object({
  profile: resumeProfileSchema,
  skills: z.array(z.string()),
  experiences: z.array(resumeExperienceSchema),
  education: z.array(resumeEducationSchema),
  projects: z.array(resumeProjectSchema),
  certifications: z.array(resumeCertificationSchema),
  honors: z.array(resumeHonorSchema),
  volunteering: z.array(resumeVolunteerSchema),
  services: z.array(resumeServiceSchema),
  links: z.array(resumeLinkSchema),
});

export const scrapedProfileSchema = z.object({
  profile: resumeProfileSchema.partial().optional(),
  skills: z.array(z.string()).optional(),
  experiences: z.array(resumeExperienceSchema).optional(),
  education: z.array(resumeEducationSchema).optional(),
  projects: z.array(resumeProjectSchema).optional(),
  certifications: z.array(resumeCertificationSchema).optional(),
  honors: z.array(resumeHonorSchema).optional(),
  volunteering: z.array(resumeVolunteerSchema).optional(),
  services: z.array(resumeServiceSchema).optional(),
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
    headshotUrl: "",
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
  projects: [
    {
      id: createId(),
      name: "",
      role: "",
      description: "",
      startDate: "",
      endDate: "",
      url: "",
    },
  ],
  certifications: [
    {
      id: createId(),
      name: "",
      issuer: "",
      issueDate: "",
      expirationDate: "",
      credentialId: "",
      credentialUrl: "",
    },
  ],
  honors: [
    {
      id: createId(),
      title: "",
      issuer: "",
      date: "",
      description: "",
    },
  ],
  volunteering: [
    {
      id: createId(),
      role: "",
      organization: "",
      cause: "",
      startDate: "",
      endDate: "",
      summary: "",
    },
  ],
  services: [
    {
      id: createId(),
      name: "",
      description: "",
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
    if (typeof value !== "string" || !value.trim()) continue;
    const field = key as keyof ResumeDraft["profile"];
    const currentValue = profile[field];
    if (typeof currentValue !== "string" || !currentValue.trim()) {
      profile[field] = value;
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
    projects:
      draft.projects.some((item) => item.name)
        ? draft.projects
        : (scraped.projects ?? draft.projects),
    certifications:
      draft.certifications.some((item) => item.name)
        ? draft.certifications
        : (scraped.certifications ?? draft.certifications),
    honors:
      draft.honors.some((item) => item.title)
        ? draft.honors
        : (scraped.honors ?? draft.honors),
    volunteering:
      draft.volunteering.some((item) => item.role || item.organization)
        ? draft.volunteering
        : (scraped.volunteering ?? draft.volunteering),
    services:
      draft.services.some((item) => item.name)
        ? draft.services
        : (scraped.services ?? draft.services),
    links:
      draft.links.some((item) => item.url)
        ? draft.links
        : (scraped.links ?? draft.links),
  };
};

export const mergeSkills = (current: string[], additions: string[]) =>
  uniqueList([...current, ...additions].map(normalizeText));

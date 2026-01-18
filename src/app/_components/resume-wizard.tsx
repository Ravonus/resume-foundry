"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Image from "next/image";

import {
  applyScrapedProfile,
  createEmptyDraft,
  mergeSkills,
  type ResumeDraft,
  type ScrapedProfile,
} from "~/lib/resume/types";
import {
  parseInlineMarkdown,
  parseSummaryBlocks,
  type InlineToken,
} from "~/lib/resume/summary-format";
import { buildResumePdfHtml } from "~/lib/resume/pdf-template";

import { ThemeToggle } from "./theme-toggle";

type Step =
  | {
    id: string;
    kind: "text" | "email" | "tel";
    label: string;
    field: keyof ResumeDraft["profile"];
    placeholder?: string;
    hint?: string;
  }
  | {
    id: string;
    kind: "textarea";
    label: string;
    field: keyof ResumeDraft["profile"];
    placeholder?: string;
    hint?: string;
  }
  | {
    id: string;
    kind:
    | "skills"
    | "experience"
    | "education"
    | "projects"
    | "certifications"
    | "honors"
    | "volunteering"
    | "services"
    | "links";
    label: string;
    hint?: string;
  }
  | {
    id: string;
    kind: "headshot";
    label: string;
    hint?: string;
  }
  | {
      id: string;
      kind: "confirm-skill";
      label: string;
      skill: string;
      hint?: string;
    }
  | {
    id: string;
    kind: "dynamic";
    label: string;
    key: string;
    inputType: "text" | "textarea" | "choice";
    placeholder?: string;
    options?: string[];
    hint?: string;
    prefill?: string;
  }
  | {
    id: string;
    kind: "review";
    label: string;
    hint?: string;
  };

type NavItem = {
  id: string;
  label: string;
  meta?: string;
  stepIndex: number;
  kind:
  | "step"
  | "experience"
  | "education"
  | "project"
  | "certification"
  | "honor"
  | "volunteer"
  | "service"
  | "skill"
  | "link";
  refId?: string;
  searchText: string;
};

type DynamicStep = Extract<Step, { kind: "dynamic" }>;

type ResumeWizardProps = {
  edenEnabled?: boolean;
};

type ResumeTheme = {
  accent: string;
  accentSoft: string;
  accentInk: string;
};

type ExperienceAiSuggestion = {
  id: string;
  createdAt: number;
  prompt: string;
  summary: string;
  highlights: string[];
  source?: "auto" | "prompt";
};

type ExperienceAiHistory = Record<string, ExperienceAiSuggestion[]>;

type SummaryAiSuggestion = {
  id: string;
  createdAt: number;
  prompt: string;
  summary: string;
  source?: "auto" | "prompt";
};

type SummaryAiHistory = SummaryAiSuggestion[];

type ConsultantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type ConsultantUpdates = Partial<{
  profile: Partial<ResumeDraft["profile"]>;
  skills: string[];
  experiences: Array<Partial<ResumeDraft["experiences"][number]>>;
  education: Array<Partial<ResumeDraft["education"][number]>>;
  projects: Array<Partial<ResumeDraft["projects"][number]>>;
  certifications: Array<Partial<ResumeDraft["certifications"][number]>>;
  honors: Array<Partial<ResumeDraft["honors"][number]>>;
  volunteering: Array<Partial<ResumeDraft["volunteering"][number]>>;
  services: Array<Partial<ResumeDraft["services"][number]>>;
  links: Array<Partial<ResumeDraft["links"][number]>>;
}>;

const DEFAULT_RESUME_THEME: ResumeTheme = {
  accent: "#1f5c7a",
  accentSoft: "#d9e6ef",
  accentInk: "#f6fbff",
};

const baseSteps: Step[] = [
  {
    id: "name",
    kind: "text",
    label: "Name on your resume",
    field: "fullName",
    placeholder: "Jordan Rivera",
  },
  {
    id: "headline",
    kind: "text",
    label: "Headline",
    field: "headline",
    placeholder: "Senior Product Designer",
  },
  {
    id: "headshot",
    kind: "headshot",
    label: "Headshot / avatar",
    hint: "Optional. Square images work best.",
  },
  {
    id: "target-role",
    kind: "text",
    label: "Target role",
    field: "targetRole",
    placeholder: "Product Designer, Growth Lead, Data Analyst",
  },
  {
    id: "job-field",
    kind: "text",
    label: "Target field",
    field: "jobField",
    placeholder: "Product design, data science, growth marketing",
  },
  {
    id: "job-type",
    kind: "text",
    label: "Job type",
    field: "jobType",
    placeholder: "Full-time, contract, freelance",
    hint: "Optional.",
  },
  {
    id: "email",
    kind: "email",
    label: "Best email",
    field: "email",
    placeholder: "you@email.com",
  },
  {
    id: "phone",
    kind: "tel",
    label: "Phone number",
    field: "phone",
    placeholder: "(555) 123-4567",
    hint: "Optional.",
  },
  {
    id: "location",
    kind: "text",
    label: "Location",
    field: "location",
    placeholder: "Austin, TX",
  },
  {
    id: "summary",
    kind: "textarea",
    label: "Summary",
    field: "summary",
    placeholder: "Two or three lines on your impact and goals.",
  },
  {
    id: "skills",
    kind: "skills",
    label: "Key skills",
    hint: "Enter to add. Click a pill to remove. Press Enter on empty to continue.",
  },
  {
    id: "experience",
    kind: "experience",
    label: "Experience",
  },
  {
    id: "education",
    kind: "education",
    label: "Education",
  },
  {
    id: "projects",
    kind: "projects",
    label: "Projects",
    hint: "Optional.",
  },
  {
    id: "certifications",
    kind: "certifications",
    label: "Licenses & certifications",
  },
  {
    id: "honors",
    kind: "honors",
    label: "Honors & awards",
  },
  {
    id: "volunteering",
    kind: "volunteering",
    label: "Volunteering",
  },
  {
    id: "services",
    kind: "services",
    label: "Services",
  },
  {
    id: "links",
    kind: "links",
    label: "Links",
  },
  {
    id: "review",
    kind: "review",
    label: "Review and generate",
    hint: "Free PDF + DOCX + MD + TXT export.",
  },
];

const normalizeSkill = (value: string) => value.trim().toLowerCase();

const createItemId = () => Math.random().toString(36).slice(2, 10);

const AUTO_REWRITE_TAG = "Auto rewrite v3";
const HEADSHOT_MAX_BYTES = 2_000_000;
const SLUG_MAX_LENGTH = 48;
const SITE_DOMAIN_BASE =
  process.env.NEXT_PUBLIC_SITE_DOMAIN_BASE ?? "mog.garden";

const isSafeHref = (value: string) => /^https?:\/\//i.test(value);

const stripInlineMarkdown = (value: string) =>
  parseInlineMarkdown(value)
    .map((token) => token.text)
    .join("");

const slugify = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, SLUG_MAX_LENGTH);
};

const formatSummaryText = (value: string) => {
  const blocks = parseSummaryBlocks(value);
  if (blocks.length === 0) return "";
  return blocks
    .map((block) => {
      if (block.type === "list") {
        return block.lines
          .map((line) => `- ${stripInlineMarkdown(line)}`)
          .join("\n");
      }
      return block.lines.map(stripInlineMarkdown).join("\n");
    })
    .join("\n\n")
    .trim();
};

const compactText = (value: string) => value.replace(/\s+/g, " ").trim();

const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
};

const buildMarkdownResume = (draft: ResumeDraft) => {
  const lines: string[] = [];
  const profile = draft.profile;
  const name = profile.fullName?.trim() || "Resume";
  const headline = profile.headline?.trim() ?? "";
  const headshotUrl = profile.headshotUrl?.trim() ?? "";
  const contactParts = [
    profile.email?.trim(),
    profile.phone?.trim(),
    profile.location?.trim(),
    profile.website?.trim(),
    ...draft.links.map((link) => link.url?.trim()).filter(Boolean),
  ].filter(Boolean);

  if (headshotUrl) {
    lines.push(`![Headshot](${headshotUrl})`, "");
  }

  lines.push(`# ${name}`);
  if (headline) lines.push(`_${headline}_`);

  if (contactParts.length > 0) {
    lines.push("", contactParts.map((item) => `- ${item}`).join("\n"));
  }

  if (profile.summary?.trim()) {
    lines.push("", "## Summary", profile.summary.trim());
  }

  if (draft.skills.length > 0) {
    lines.push("", "## Skills", draft.skills.join(", "));
  }

  const experiences = draft.experiences.filter(
    (item) => item.title || item.company,
  );
  if (experiences.length > 0) {
    lines.push("", "## Experience");
    for (const exp of experiences) {
      const title = [exp.title, exp.company].filter(Boolean).join(" - ");
      if (title) lines.push(`### ${title}`);
      const metaParts = [
        [exp.startDate, exp.endDate].filter(Boolean).join(" - "),
        exp.location ?? "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(`_${metaParts.join(" | ")}_`);
      }
      if (exp.summary?.trim()) {
        lines.push(exp.summary.trim());
      }
      const highlights = (exp.highlights ?? [])
        .filter((value) => value.trim())
        .map((value) => `- ${value.trim()}`);
      if (highlights.length > 0) {
        lines.push(...highlights);
      }
      lines.push("");
    }
  }

  const education = draft.education.filter((item) => item.school);
  if (education.length > 0) {
    lines.push("## Education");
    for (const edu of education) {
      const title = [edu.school, edu.degree].filter(Boolean).join(" - ");
      if (title) lines.push(`### ${title}`);
      const metaParts = [
        edu.field ?? "",
        [edu.startDate, edu.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(`_${metaParts.join(" | ")}_`);
      }
      if (edu.notes?.trim()) {
        lines.push(edu.notes.trim());
      }
      lines.push("");
    }
  }

  const certifications = draft.certifications.filter((item) => item.name);
  if (certifications.length > 0) {
    lines.push("## Certifications");
    for (const cert of certifications) {
      if (cert.name) lines.push(`### ${cert.name}`);
      const metaParts = [
        cert.issuer ?? "",
        cert.issueDate ? `Issued ${cert.issueDate}` : "",
        cert.expirationDate ? `Expires ${cert.expirationDate}` : "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(`_${metaParts.join(" | ")}_`);
      }
      if (cert.credentialId?.trim()) {
        lines.push(`Credential ID: ${cert.credentialId.trim()}`);
      }
      if (cert.credentialUrl?.trim()) {
        lines.push(cert.credentialUrl.trim());
      }
      lines.push("");
    }
  }

  const honors = draft.honors.filter((item) => item.title);
  if (honors.length > 0) {
    lines.push("## Honors & Awards");
    for (const honor of honors) {
      if (honor.title) lines.push(`### ${honor.title}`);
      const metaParts = [honor.issuer ?? "", honor.date ?? ""]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(`_${metaParts.join(" | ")}_`);
      }
      if (honor.description?.trim()) {
        lines.push(honor.description.trim());
      }
      lines.push("");
    }
  }

  const volunteering = draft.volunteering.filter(
    (item) => item.role || item.organization,
  );
  if (volunteering.length > 0) {
    lines.push("## Volunteering");
    for (const item of volunteering) {
      const title = [item.role, item.organization]
        .filter(Boolean)
        .join(" - ");
      if (title) lines.push(`### ${title}`);
      const metaParts = [
        item.cause ?? "",
        [item.startDate, item.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(`_${metaParts.join(" | ")}_`);
      }
      if (item.summary?.trim()) {
        lines.push(item.summary.trim());
      }
      lines.push("");
    }
  }

  const services = draft.services.filter((item) => item.name);
  if (services.length > 0) {
    lines.push("## Services");
    for (const service of services) {
      if (service.name) lines.push(`### ${service.name}`);
      if (service.description?.trim()) {
        lines.push(service.description.trim());
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
};

const normalizeTagMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const skillMatchesText = (skill: string, text: string) => {
  const trimmed = skill.trim();
  if (!trimmed) return false;
  if (trimmed.length <= 3 || /[+#]/.test(trimmed)) {
    const pattern = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i");
    return pattern.test(text);
  }
  const normalizedSkill = normalizeTagMatch(trimmed);
  if (!normalizedSkill) return false;
  const normalizedText = normalizeTagMatch(text);
  if (!normalizedText) return false;
  return normalizedText.includes(normalizedSkill);
};

const buildAnchorIds = <T,>(
  items: T[],
  prefix: string,
  getLabel: (item: T, index: number) => string,
) => {
  const used = new Set<string>();
  return items.map((item, index) => {
    const base = slugify(getLabel(item, index));
    let candidate = base ? `${prefix}-${base}` : `${prefix}-${index + 1}`;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = base
        ? `${prefix}-${base}-${counter}`
        : `${prefix}-${index + 1}-${counter}`;
      counter += 1;
    }
    used.add(candidate);
    return candidate;
  });
};

const buildSkillTags = (skills: string[], text: string, limit = 6) =>
  skills.filter((skill) => skillMatchesText(skill, text)).slice(0, limit);

const buildSitePrompt = ({
  draft,
  steps,
  dynamicAnswers,
  consultantMessages,
}: {
  draft: ResumeDraft;
  steps: Step[];
  dynamicAnswers: Record<string, string>;
  consultantMessages: ConsultantMessage[];
}) => {
  const profile = draft.profile;
  const name = profile.fullName?.trim() ?? "";
  const targetRole = profile.targetRole?.trim() ?? "";
  const headline = profile.headline?.trim() ?? "";
  const roleLabel = targetRole ? targetRole : headline;
  const jobField = profile.jobField?.trim() ?? "";
  const jobType = profile.jobType?.trim() ?? "";
  const location = profile.location?.trim() ?? "";
  const subject = name
    ? roleLabel
      ? `${name} (${roleLabel})`
      : name
    : roleLabel || "this professional";

  const focusParts = [roleLabel, jobField, jobType].filter(Boolean);
  const focusLine = focusParts.length
    ? `Focus: ${focusParts.join(" | ")}`
    : "";
  const locationLine = location ? `Location: ${location}` : "";

  const summary = profile.summary?.trim()
    ? truncateText(
      compactText(formatSummaryText(profile.summary.trim())),
      600,
    )
    : "";
  const skills = draft.skills
    .map((skill) => skill.trim())
    .filter((skill) => skill && skill.length <= 40)
    .slice(0, 12);
  const skillsLine = skills.length
    ? `Core skills: ${skills.join(", ")}`
    : "";

  const experienceItems = draft.experiences.filter(
    (item) => item.title || item.company,
  );
  const projectItems = draft.projects.filter((item) => item.name);
  const experienceAnchors = buildAnchorIds(
    experienceItems,
    "exp",
    (item) => item.company || item.title || "",
  );
  const projectAnchors = buildAnchorIds(
    projectItems,
    "proj",
    (item) => item.name || "",
  );

  const experienceLines = experienceItems
    .slice(0, 3)
    .map((item) => {
      const title = [item.title, item.company].filter(Boolean).join(" - ");
      if (!title) return "";
      const metaParts = [
        [item.startDate, item.endDate].filter(Boolean).join(" - "),
        item.location ?? "",
      ]
        .map((value) => compactText(value))
        .filter(Boolean);
      const meta = metaParts.length ? ` (${metaParts.join(" | ")})` : "";
      const detailParts: string[] = [];
      if (item.summary?.trim()) {
        detailParts.push(
          compactText(stripInlineMarkdown(item.summary.trim())),
        );
      }
      const highlights = (item.highlights ?? [])
        .map((value) => compactText(stripInlineMarkdown(value)))
        .filter(Boolean)
        .slice(0, 3);
      if (highlights.length > 0) {
        detailParts.push(highlights.join("; "));
      }
      const detail = detailParts.length
        ? `: ${truncateText(detailParts.join(" "), 280)}`
        : "";
      return `- ${title}${meta}${detail}`;
    })
    .filter(Boolean);

  const projectLines = projectItems
    .slice(0, 2)
    .map((item) => {
      const name = item.name.trim();
      if (!name) return "";
      const role = item.role?.trim() ?? "";
      const detailParts: string[] = [];
      if (item.description?.trim()) {
        detailParts.push(
          compactText(stripInlineMarkdown(item.description.trim())),
        );
      }
      if (item.url?.trim()) {
        detailParts.push(item.url.trim());
      }
      const detail = detailParts.length
        ? `: ${truncateText(detailParts.join(" "), 240)}`
        : "";
      const roleLabel = role ? ` (${role})` : "";
      return `- ${name}${roleLabel}${detail}`;
    })
    .filter(Boolean);

  const tagSkills = draft.skills
    .map((skill) => skill.trim())
    .filter((skill) => skill && skill.length <= 40);

  const anchorHintLines = [
    ...experienceItems.map((item, index) => {
      const label = [item.title, item.company].filter(Boolean).join(" - ");
      if (!label) return "";
      return `- ${experienceAnchors[index]}: ${label}`;
    }),
    ...projectItems.map((item, index) => {
      const label = item.name?.trim() ?? "";
      if (!label) return "";
      return `- ${projectAnchors[index]}: ${label}`;
    }),
  ].filter(Boolean);

  const tagHintLines = [
    ...experienceItems.map((item, index) => {
      const text = [
        item.title,
        item.company,
        item.summary,
        ...(item.highlights ?? []),
      ]
        .filter(Boolean)
        .join(" ");
      const tags = buildSkillTags(tagSkills, text, 8);
      if (tags.length === 0) return "";
      return `- ${experienceAnchors[index]} tags: ${tags.join(", ")}`;
    }),
    ...projectItems.map((item, index) => {
      const text = [item.name, item.role, item.description]
        .filter(Boolean)
        .join(" ");
      const tags = buildSkillTags(tagSkills, text, 8);
      if (tags.length === 0) return "";
      return `- ${projectAnchors[index]} tags: ${tags.join(", ")}`;
    }),
  ].filter(Boolean);

  const skillIndexLines = (() => {
    const mapping = new Map<string, string>();
    for (const line of tagHintLines) {
      const match = /^- ([^ ]+) tags: (.+)$/.exec(line);
      if (!match) continue;
      const anchor = match[1] ?? "";
      const tags = (match[2] ?? "").split(",").map((tag) => tag.trim());
      for (const tag of tags) {
        if (!tag || mapping.has(tag)) continue;
        mapping.set(tag, anchor);
      }
    }
    return skills
      .map((skill) => {
        const anchor = mapping.get(skill);
        return anchor ? `- ${skill} -> #${anchor}` : "";
      })
      .filter(Boolean)
      .slice(0, 12);
  })();

  const dynamicNotes = steps
    .filter((step): step is DynamicStep => step.kind === "dynamic")
    .map((step) => {
      const answer = dynamicAnswers[step.key];
      if (!answer?.trim()) return "";
      return `- ${step.label}: ${truncateText(compactText(answer), 220)}`;
    })
    .filter(Boolean)
    .slice(0, 4);

  const userNotes = consultantMessages
    .filter((message) => message.role === "user")
    .map((message) => compactText(message.content))
    .filter(Boolean)
    .slice(-3)
    .map((note) => `- ${truncateText(note, 220)}`);

  const notes = [...dynamicNotes, ...userNotes].slice(0, 6);

  const lines = [
    `Create a bold one-page portfolio site for ${subject}.`,
    "Style: strong typography, high-contrast colors, tasteful motion, and a confident, premium layout.",
    "Goal: convert recruiters/clients with proof blocks, clear impact, and a crisp call-to-action.",
    "Use the resume markdown as the source of truth. Do not invent facts.",
    "Add anchorId and tags for experience and project items; do not use highlights.",
    "AnchorId format: exp-<slug> for experience and proj-<slug> for projects.",
    "Tags must come from core skills and should match the related experience/project text.",
    anchorHintLines.length ? "AnchorId suggestions:" : "",
    ...anchorHintLines,
    tagHintLines.length ? "Tag suggestions:" : "",
    ...tagHintLines,
    skillIndexLines.length
      ? "Skill Index links (skill -> anchor):"
      : "",
    ...skillIndexLines,
    focusLine,
    locationLine,
    summary ? `Summary: ${summary}` : "",
    skillsLine,
    experienceLines.length ? "Experience summary:" : "",
    ...experienceLines,
    projectLines.length ? "Projects:" : "",
    ...projectLines,
    notes.length ? "User notes:" : "",
    ...notes,
  ].filter(Boolean);

  return lines.join("\n");
};

const buildTextResume = (draft: ResumeDraft) => {
  const lines: string[] = [];
  const profile = draft.profile;
  const name = profile.fullName?.trim() || "Resume";
  const headline = profile.headline?.trim() ?? "";
  const headshotUrl = profile.headshotUrl?.trim() ?? "";
  const contactParts = [
    profile.email?.trim(),
    profile.phone?.trim(),
    profile.location?.trim(),
    profile.website?.trim(),
    ...draft.links.map((link) => link.url?.trim()).filter(Boolean),
  ].filter(Boolean);

  if (headshotUrl) {
    lines.push(`Headshot: ${headshotUrl}`, "");
  }

  lines.push(name);
  if (headline) lines.push(headline);
  if (contactParts.length > 0) {
    lines.push(contactParts.join(" | "));
  }

  if (profile.summary?.trim()) {
    lines.push("", "SUMMARY");
    lines.push(formatSummaryText(profile.summary.trim()));
  }

  if (draft.skills.length > 0) {
    lines.push("", "SKILLS");
    lines.push(draft.skills.join(", "));
  }

  const experiences = draft.experiences.filter(
    (item) => item.title || item.company,
  );
  if (experiences.length > 0) {
    lines.push("", "EXPERIENCE");
    for (const exp of experiences) {
      const title = [exp.title, exp.company].filter(Boolean).join(" - ");
      if (title) lines.push(title);
      const metaParts = [
        [exp.startDate, exp.endDate].filter(Boolean).join(" - "),
        exp.location ?? "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(metaParts.join(" | "));
      }
      if (exp.summary?.trim()) {
        lines.push(formatSummaryText(exp.summary.trim()));
      }
      const highlights = (exp.highlights ?? [])
        .filter((value) => value.trim())
        .map((value) => `- ${stripInlineMarkdown(value.trim())}`);
      if (highlights.length > 0) {
        lines.push(...highlights);
      }
      lines.push("");
    }
  }

  const education = draft.education.filter((item) => item.school);
  if (education.length > 0) {
    lines.push("EDUCATION");
    for (const edu of education) {
      const title = [edu.school, edu.degree].filter(Boolean).join(" - ");
      if (title) lines.push(title);
      const metaParts = [
        edu.field ?? "",
        [edu.startDate, edu.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(metaParts.join(" | "));
      }
      if (edu.notes?.trim()) {
        lines.push(stripInlineMarkdown(edu.notes.trim()));
      }
      lines.push("");
    }
  }

  const certifications = draft.certifications.filter((item) => item.name);
  if (certifications.length > 0) {
    lines.push("CERTIFICATIONS");
    for (const cert of certifications) {
      if (cert.name) lines.push(cert.name);
      const metaParts = [
        cert.issuer ?? "",
        cert.issueDate ? `Issued ${cert.issueDate}` : "",
        cert.expirationDate ? `Expires ${cert.expirationDate}` : "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(metaParts.join(" | "));
      }
      if (cert.credentialId?.trim()) {
        lines.push(`Credential ID: ${cert.credentialId.trim()}`);
      }
      if (cert.credentialUrl?.trim()) {
        lines.push(cert.credentialUrl.trim());
      }
      lines.push("");
    }
  }

  const honors = draft.honors.filter((item) => item.title);
  if (honors.length > 0) {
    lines.push("HONORS & AWARDS");
    for (const honor of honors) {
      if (honor.title) lines.push(honor.title);
      const metaParts = [honor.issuer ?? "", honor.date ?? ""]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(metaParts.join(" | "));
      }
      if (honor.description?.trim()) {
        lines.push(formatSummaryText(honor.description.trim()));
      }
      lines.push("");
    }
  }

  const volunteering = draft.volunteering.filter(
    (item) => item.role || item.organization,
  );
  if (volunteering.length > 0) {
    lines.push("VOLUNTEERING");
    for (const item of volunteering) {
      const title = [item.role, item.organization]
        .filter(Boolean)
        .join(" - ");
      if (title) lines.push(title);
      const metaParts = [
        item.cause ?? "",
        [item.startDate, item.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        lines.push(metaParts.join(" | "));
      }
      if (item.summary?.trim()) {
        lines.push(formatSummaryText(item.summary.trim()));
      }
      lines.push("");
    }
  }

  const services = draft.services.filter((item) => item.name);
  if (services.length > 0) {
    lines.push("SERVICES");
    for (const service of services) {
      if (service.name) lines.push(service.name);
      if (service.description?.trim()) {
        lines.push(formatSummaryText(service.description.trim()));
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
};

const renderInlineTokens = (
  tokens: InlineToken[],
  keyPrefix: string,
) =>
  tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "bold":
        return <strong key={key}>{token.text}</strong>;
      case "italic":
        return <em key={key}>{token.text}</em>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-[var(--surface-muted)] px-1 py-0.5 font-mono text-[11px]"
          >
            {token.text}
          </code>
        );
      case "link":
        return token.href && isSafeHref(token.href) ? (
          <a
            key={key}
            href={token.href}
            className="text-[var(--accent)] underline"
          >
            {token.text}
          </a>
        ) : (
          <span key={key}>{token.text}</span>
        );
      default:
        return <span key={key}>{token.text}</span>;
    }
  });

const buildExperienceNarrative = (summary: string, highlights: string[]) => {
  const trimmedSummary = summary.trim();
  const cleanedHighlights = normalizeHighlights(highlights);
  const parts: string[] = [];
  if (trimmedSummary) parts.push(trimmedSummary);
  if (cleanedHighlights.length > 0) {
    parts.push(cleanedHighlights.map((item) => `- ${item}`).join("\n"));
  }
  return parts.join("\n");
};

const parseExperienceNarrative = (text: string) => {
  const blocks = parseSummaryBlocks(text);
  const summaryParts: string[] = [];
  const highlights: string[] = [];
  for (const block of blocks) {
    if (block.type === "list") {
      highlights.push(
        ...block.lines.map((line) => line.trim()).filter(Boolean),
      );
      continue;
    }
    const content = block.lines.join("\n").trim();
    if (content) summaryParts.push(content);
  }
  return {
    summary: summaryParts.join("\n\n"),
    highlights,
  };
};

const renderSummaryBlocks = (
  text: string,
  options: {
    paragraphClassName?: string;
    listClassName?: string;
    itemClassName?: string;
  } = {},
) => {
  const blocks = parseSummaryBlocks(text);
  if (blocks.length === 0) return null;
  const {
    paragraphClassName = "whitespace-pre-line",
    listClassName = "list-disc space-y-1 pl-4",
    itemClassName = "",
  } = options;

  return blocks.map((block, index) => {
    if (block.type === "list") {
      return (
        <ul key={`summary-list-${index}`} className={listClassName}>
          {block.lines.map((line, lineIndex) => (
            <li
              key={`summary-item-${index}-${lineIndex}`}
              className={itemClassName}
            >
              {renderInlineTokens(
                parseInlineMarkdown(line),
                `summary-item-${index}-${lineIndex}`,
              )}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={`summary-para-${index}`} className={paragraphClassName}>
        {block.lines.map((line, lineIndex) => (
          <span key={`summary-line-${index}-${lineIndex}`}>
            {renderInlineTokens(
              parseInlineMarkdown(line),
              `summary-line-${index}-${lineIndex}`,
            )}
            {lineIndex < block.lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
  });
};

const normalizeSummaryText = (value?: string) => (value ?? "").trim();

const normalizeHighlights = (items?: string[]) =>
  (items ?? []).map((item) => item.trim()).filter(Boolean);

const areArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((item, index) => item === right[index]);

const hashText = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const buildScrapedKey = (scraped: ScrapedProfile) => {
  try {
    return hashText(JSON.stringify({ tag: AUTO_REWRITE_TAG, scraped }));
  } catch {
    return `scrape-${Date.now()}`;
  }
};

const hasSummaryContent = (draft: ResumeDraft) =>
  Boolean(normalizeSummaryText(draft.profile.summary)) ||
  draft.experiences.some(
    (exp) =>
      Boolean(normalizeSummaryText(exp.summary)) ||
      normalizeHighlights(exp.highlights).length > 0,
  );

const applyAutoRewrite = (
  current: ResumeDraft,
  baseline: ResumeDraft,
  polished: ResumeDraft,
): ResumeDraft => {
  const baselineSummary = normalizeSummaryText(baseline.profile.summary);
  const currentSummary = normalizeSummaryText(current.profile.summary);
  const polishedSummary = normalizeSummaryText(polished.profile.summary);
  const nextProfile =
    currentSummary === baselineSummary &&
      polishedSummary &&
      polishedSummary !== currentSummary
      ? { ...current.profile, summary: polishedSummary }
      : current.profile;

  const nextExperiences = current.experiences.map((exp) => {
    const baselineExp = baseline.experiences.find((item) => item.id === exp.id);
    const polishedExp = polished.experiences.find((item) => item.id === exp.id);
    if (!baselineExp || !polishedExp) return exp;

    const baselineExpSummary = normalizeSummaryText(baselineExp.summary);
    const currentExpSummary = normalizeSummaryText(exp.summary);
    const polishedExpSummary = normalizeSummaryText(polishedExp.summary);

    const baselineHighlights = normalizeHighlights(baselineExp.highlights);
    const currentHighlights = normalizeHighlights(exp.highlights);
    const polishedHighlights = normalizeHighlights(polishedExp.highlights);

    const summary =
      currentExpSummary === baselineExpSummary &&
        polishedExpSummary &&
        polishedExpSummary !== currentExpSummary
        ? polishedExpSummary
        : exp.summary;

    const highlights =
      areArraysEqual(currentHighlights, baselineHighlights) &&
        polishedHighlights.length > 0 &&
        !areArraysEqual(polishedHighlights, currentHighlights)
        ? polishedHighlights
        : exp.highlights ?? [];

    return {
      ...exp,
      summary,
      highlights,
    };
  });

  return { ...current, profile: nextProfile, experiences: nextExperiences };
};

const seedAutoRewriteHistory = (
  currentHistory: ExperienceAiHistory,
  baseline: ResumeDraft,
  polished: ResumeDraft,
): ExperienceAiHistory => {
  const next = { ...currentHistory };
  const createdAt = Date.now();

  for (const polishedExp of polished.experiences) {
    const baselineExp = baseline.experiences.find(
      (item) => item.id === polishedExp.id,
    );
    if (!baselineExp) continue;

    const baselineSummary = normalizeSummaryText(baselineExp.summary);
    const baselineHighlights = normalizeHighlights(baselineExp.highlights);
    const polishedSummary = normalizeSummaryText(polishedExp.summary);
    const polishedHighlights = normalizeHighlights(polishedExp.highlights);

    const hasContent =
      Boolean(polishedSummary) || polishedHighlights.length > 0;
    if (!hasContent) continue;
    const hasChange =
      (polishedSummary && polishedSummary !== baselineSummary) ||
      !areArraysEqual(polishedHighlights, baselineHighlights);
    if (!hasChange) continue;

    const existing = next[polishedExp.id] ?? [];
    if (
      existing.some(
        (entry) => entry.source === "auto" && entry.prompt === AUTO_REWRITE_TAG,
      )
    ) {
      continue;
    }

    const entry: ExperienceAiSuggestion = {
      id: createItemId(),
      createdAt,
      prompt: AUTO_REWRITE_TAG,
      summary: polishedSummary,
      highlights: polishedHighlights,
      source: "auto",
    };

    next[polishedExp.id] = [entry, ...existing].slice(0, 10);
  }

  return next;
};

const seedAutoRewriteSummary = (
  currentHistory: SummaryAiHistory,
  baseline: ResumeDraft,
  polished: ResumeDraft,
): SummaryAiHistory => {
  const baselineSummary = normalizeSummaryText(baseline.profile.summary);
  const polishedSummary = normalizeSummaryText(polished.profile.summary);
  if (!polishedSummary || polishedSummary === baselineSummary) {
    return currentHistory;
  }
  if (
    currentHistory.some(
      (entry) => entry.source === "auto" && entry.prompt === AUTO_REWRITE_TAG,
    )
  ) {
    return currentHistory;
  }
  const entry: SummaryAiSuggestion = {
    id: createItemId(),
    createdAt: Date.now(),
    prompt: AUTO_REWRITE_TAG,
    summary: polishedSummary,
    source: "auto",
  };
  return [entry, ...currentHistory].slice(0, 10);
};

const createBlankExperience = () => ({
  id: createItemId(),
  title: "",
  company: "",
  location: "",
  startDate: "",
  endDate: "",
  summary: "",
  highlights: [],
});

const createBlankEducation = () => ({
  id: createItemId(),
  school: "",
  degree: "",
  field: "",
  startDate: "",
  endDate: "",
  notes: "",
});

const createBlankProject = () => ({
  id: createItemId(),
  name: "",
  role: "",
  description: "",
  startDate: "",
  endDate: "",
  url: "",
});

const createBlankLink = () => ({
  id: createItemId(),
  label: "",
  url: "",
});

const createBlankCertification = () => ({
  id: createItemId(),
  name: "",
  issuer: "",
  issueDate: "",
  expirationDate: "",
  credentialId: "",
  credentialUrl: "",
});

const createBlankHonor = () => ({
  id: createItemId(),
  title: "",
  issuer: "",
  date: "",
  description: "",
});

const createBlankVolunteer = () => ({
  id: createItemId(),
  role: "",
  organization: "",
  cause: "",
  startDate: "",
  endDate: "",
  summary: "",
});

const createBlankService = () => ({
  id: createItemId(),
  name: "",
  description: "",
});

const isExperienceEmpty = (
  experience: ResumeDraft["experiences"][number],
) =>
  !experience.title &&
  !experience.company &&
  !experience.location &&
  !experience.startDate &&
  !experience.endDate &&
  !experience.summary;

const isEducationEmpty = (education: ResumeDraft["education"][number]) =>
  !education.school &&
  !education.degree &&
  !education.field &&
  !education.startDate &&
  !education.endDate &&
  !education.notes;

const isProjectEmpty = (project: ResumeDraft["projects"][number]) =>
  !project.name &&
  !project.role &&
  !project.description &&
  !project.startDate &&
  !project.endDate &&
  !project.url;

const isLinkEmpty = (link: ResumeDraft["links"][number]) =>
  !link.label && !link.url;

const isCertificationEmpty = (
  cert: ResumeDraft["certifications"][number],
) =>
  !cert.name &&
  !cert.issuer &&
  !cert.issueDate &&
  !cert.expirationDate &&
  !cert.credentialId &&
  !cert.credentialUrl;

const isHonorEmpty = (honor: ResumeDraft["honors"][number]) =>
  !honor.title && !honor.issuer && !honor.date && !honor.description;

const isVolunteerEmpty = (item: ResumeDraft["volunteering"][number]) =>
  !item.role &&
  !item.organization &&
  !item.cause &&
  !item.startDate &&
  !item.endDate &&
  !item.summary;

const isServiceEmpty = (service: ResumeDraft["services"][number]) =>
  !service.name && !service.description;

const parseRoleInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const divider = " at ";
  const index = lower.indexOf(divider);
  if (index > -1) {
    return {
      title: trimmed.slice(0, index).trim(),
      company: trimmed.slice(index + divider.length).trim(),
    };
  }
  return { title: trimmed, company: "" };
};

const cleanDraft = (draft: ResumeDraft) => ({
  ...draft,
  experiences: draft.experiences.filter((item) => !isExperienceEmpty(item)),
  education: draft.education.filter((item) => !isEducationEmpty(item)),
  projects: draft.projects.filter((item) => !isProjectEmpty(item)),
  certifications: draft.certifications.filter(
    (item) => !isCertificationEmpty(item),
  ),
  honors: draft.honors.filter((item) => !isHonorEmpty(item)),
  volunteering: draft.volunteering.filter((item) => !isVolunteerEmpty(item)),
  services: draft.services.filter((item) => !isServiceEmpty(item)),
  links: draft.links.filter((item) => !isLinkEmpty(item)),
});

const stripHeadshotFromDraft = (draft: ResumeDraft) => ({
  ...draft,
  profile: { ...draft.profile, headshotUrl: "" },
});

const stripHeadshotFromScraped = (scraped: ScrapedProfile | null) => {
  if (!scraped?.profile) return scraped;
  return {
    ...scraped,
    profile: { ...scraped.profile, headshotUrl: "" },
  };
};

const normalizeExperiences = (
  items: ResumeDraft["experiences"] | undefined,
) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankExperience()];
  }
  return items.map((item) => ({
    ...createBlankExperience(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeEducation = (items: ResumeDraft["education"] | undefined) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankEducation()];
  }
  return items.map((item) => ({
    ...createBlankEducation(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeProjects = (items: ResumeDraft["projects"] | undefined) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankProject()];
  }
  return items.map((item) => ({
    ...createBlankProject(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeLinks = (items: ResumeDraft["links"] | undefined) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankLink()];
  }
  return items.map((item) => ({
    ...createBlankLink(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeCertifications = (
  items: ResumeDraft["certifications"] | undefined,
) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankCertification()];
  }
  return items.map((item) => ({
    ...createBlankCertification(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeHonors = (items: ResumeDraft["honors"] | undefined) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankHonor()];
  }
  return items.map((item) => ({
    ...createBlankHonor(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeVolunteering = (
  items: ResumeDraft["volunteering"] | undefined,
) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankVolunteer()];
  }
  return items.map((item) => ({
    ...createBlankVolunteer(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeServices = (items: ResumeDraft["services"] | undefined) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [createBlankService()];
  }
  return items.map((item) => ({
    ...createBlankService(),
    ...item,
    id: item.id ?? createItemId(),
  }));
};

const normalizeDraft = (value: ResumeDraft) => {
  const base = createEmptyDraft();
  return {
    ...base,
    ...value,
    profile: { ...base.profile, ...(value.profile ?? {}) },
    skills: Array.isArray(value.skills) ? value.skills : base.skills,
    experiences: normalizeExperiences(value.experiences),
    education: normalizeEducation(value.education),
    projects: normalizeProjects(value.projects),
    certifications: normalizeCertifications(value.certifications),
    honors: normalizeHonors(value.honors),
    volunteering: normalizeVolunteering(value.volunteering),
    services: normalizeServices(value.services),
    links: normalizeLinks(value.links),
  };
};

const normalizeKey = (value?: string) => (value ?? "").trim().toLowerCase();

const coerceText = (value?: string) => (value ?? "").trim();

const extractContactInfo = (text: string) => {
  const emailMatch =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text);
  const phoneMatch = /(?:\+?\d[\d\s().-]{7,}\d)/.exec(text);
  const email = emailMatch ? emailMatch[0].trim() : "";
  const phoneRaw = phoneMatch ? phoneMatch[0].trim() : "";
  const digits = phoneRaw.replace(/\D/g, "");
  const phone =
    digits.length >= 10
      ? phoneRaw.replace(/[^\d+().\s-]/g, "").trim()
      : "";
  return { email, phone };
};

const applyFallbackContact = (
  draft: ResumeDraft,
  contact: { email?: string; phone?: string },
) => {
  if (!contact.email && !contact.phone) return draft;
  const profile = { ...draft.profile };
  if (contact.email && !profile.email) profile.email = contact.email;
  if (contact.phone && !profile.phone) profile.phone = contact.phone;
  return { ...draft, profile };
};

const mergeConsultantUpdates = (
  current: ResumeDraft,
  updates: ConsultantUpdates,
) => {
  const draft = normalizeDraft(current);

  const profileUpdates = updates.profile ?? {};
  const profile = { ...draft.profile };
  for (const [key, value] of Object.entries(profileUpdates)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    profile[key as keyof ResumeDraft["profile"]] = trimmed;
  }

  const skills = mergeSkills(draft.skills, updates.skills ?? []);

  const mergeExperiences = (
    existing: ResumeDraft["experiences"],
    additions: Array<Partial<ResumeDraft["experiences"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.title)}::${normalizeKey(item.company)}`;
      if (key !== "::") {
        indexByKey.set(key, index);
      }
    });

    for (const addition of additions) {
      const title = coerceText(addition.title);
      const company = coerceText(addition.company);
      const location = coerceText(addition.location);
      const startDate = coerceText(addition.startDate);
      const endDate = coerceText(addition.endDate);
      let summary = coerceText(addition.summary);
      let highlights = normalizeHighlights(addition.highlights);
      if (!highlights.length && summary.includes("\n-")) {
        const parsed = parseExperienceNarrative(summary);
        summary = parsed.summary;
        highlights = parsed.highlights;
      }

      if (
        !title &&
        !company &&
        !location &&
        !startDate &&
        !endDate &&
        !summary &&
        highlights.length === 0
      ) {
        continue;
      }

      const key = `${normalizeKey(title)}::${normalizeKey(company)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          title: title || existingItem.title,
          company: company || existingItem.company,
          location: location || existingItem.location,
          startDate: startDate || existingItem.startDate,
          endDate: endDate || existingItem.endDate,
          summary: summary || existingItem.summary,
          highlights:
            highlights.length > 0 ? highlights : existingItem.highlights,
        };
        continue;
      }

      const newItem = {
        ...createBlankExperience(),
        title,
        company,
        location,
        startDate,
        endDate,
        summary,
        highlights,
      };

      const blankIndex = next.findIndex((item) => isExperienceEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") {
          indexByKey.set(key, blankIndex);
        }
      } else {
        next.push(newItem);
        if (key !== "::") {
          indexByKey.set(key, next.length - 1);
        }
      }
    }

    return next;
  };

  const mergeEducation = (
    existing: ResumeDraft["education"],
    additions: Array<Partial<ResumeDraft["education"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.school)}::${normalizeKey(item.degree)}`;
      if (key !== "::") indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const school = coerceText(addition.school);
      const degree = coerceText(addition.degree);
      const field = coerceText(addition.field);
      const startDate = coerceText(addition.startDate);
      const endDate = coerceText(addition.endDate);
      const notes = coerceText(addition.notes);
      if (!school && !degree && !field && !startDate && !endDate && !notes) {
        continue;
      }

      const key = `${normalizeKey(school)}::${normalizeKey(degree)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          school: school || existingItem.school,
          degree: degree || existingItem.degree,
          field: field || existingItem.field,
          startDate: startDate || existingItem.startDate,
          endDate: endDate || existingItem.endDate,
          notes: notes || existingItem.notes,
        };
        continue;
      }

      const newItem = {
        ...createBlankEducation(),
        school,
        degree,
        field,
        startDate,
        endDate,
        notes,
      };

      const blankIndex = next.findIndex((item) => isEducationEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key !== "::") indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  const mergeProjects = (
    existing: ResumeDraft["projects"],
    additions: Array<Partial<ResumeDraft["projects"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.name)}::${normalizeKey(item.role)}`;
      if (key !== "::") indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const name = coerceText(addition.name);
      const role = coerceText(addition.role);
      const description = coerceText(addition.description);
      const startDate = coerceText(addition.startDate);
      const endDate = coerceText(addition.endDate);
      const url = coerceText(addition.url);
      if (!name && !role && !description && !startDate && !endDate && !url) {
        continue;
      }

      const key = `${normalizeKey(name)}::${normalizeKey(role)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          name: name || existingItem.name,
          role: role || existingItem.role,
          description: description || existingItem.description,
          startDate: startDate || existingItem.startDate,
          endDate: endDate || existingItem.endDate,
          url: url || existingItem.url,
        };
        continue;
      }

      const newItem = {
        ...createBlankProject(),
        name,
        role,
        description,
        startDate,
        endDate,
        url,
      };

      const blankIndex = next.findIndex((item) => isProjectEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key !== "::") indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  const mergeCertifications = (
    existing: ResumeDraft["certifications"],
    additions: Array<Partial<ResumeDraft["certifications"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.name)}::${normalizeKey(item.issuer)}`;
      if (key !== "::") indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const name = coerceText(addition.name);
      const issuer = coerceText(addition.issuer);
      const issueDate = coerceText(addition.issueDate);
      const expirationDate = coerceText(addition.expirationDate);
      const credentialId = coerceText(addition.credentialId);
      const credentialUrl = coerceText(addition.credentialUrl);
      if (
        !name &&
        !issuer &&
        !issueDate &&
        !expirationDate &&
        !credentialId &&
        !credentialUrl
      ) {
        continue;
      }

      const key = `${normalizeKey(name)}::${normalizeKey(issuer)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          name: name || existingItem.name,
          issuer: issuer || existingItem.issuer,
          issueDate: issueDate || existingItem.issueDate,
          expirationDate: expirationDate || existingItem.expirationDate,
          credentialId: credentialId || existingItem.credentialId,
          credentialUrl: credentialUrl || existingItem.credentialUrl,
        };
        continue;
      }

      const newItem = {
        ...createBlankCertification(),
        name,
        issuer,
        issueDate,
        expirationDate,
        credentialId,
        credentialUrl,
      };

      const blankIndex = next.findIndex((item) => isCertificationEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key !== "::") indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  const mergeHonors = (
    existing: ResumeDraft["honors"],
    additions: Array<Partial<ResumeDraft["honors"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.title)}::${normalizeKey(item.issuer)}`;
      if (key !== "::") indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const title = coerceText(addition.title);
      const issuer = coerceText(addition.issuer);
      const date = coerceText(addition.date);
      const description = coerceText(addition.description);
      if (!title && !issuer && !date && !description) {
        continue;
      }

      const key = `${normalizeKey(title)}::${normalizeKey(issuer)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          title: title || existingItem.title,
          issuer: issuer || existingItem.issuer,
          date: date || existingItem.date,
          description: description || existingItem.description,
        };
        continue;
      }

      const newItem = {
        ...createBlankHonor(),
        title,
        issuer,
        date,
        description,
      };

      const blankIndex = next.findIndex((item) => isHonorEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key !== "::") indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  const mergeVolunteering = (
    existing: ResumeDraft["volunteering"],
    additions: Array<Partial<ResumeDraft["volunteering"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.role)}::${normalizeKey(item.organization)}`;
      if (key !== "::") indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const role = coerceText(addition.role);
      const organization = coerceText(addition.organization);
      const cause = coerceText(addition.cause);
      const startDate = coerceText(addition.startDate);
      const endDate = coerceText(addition.endDate);
      const summary = coerceText(addition.summary);
      if (
        !role &&
        !organization &&
        !cause &&
        !startDate &&
        !endDate &&
        !summary
      ) {
        continue;
      }

      const key = `${normalizeKey(role)}::${normalizeKey(organization)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          role: role || existingItem.role,
          organization: organization || existingItem.organization,
          cause: cause || existingItem.cause,
          startDate: startDate || existingItem.startDate,
          endDate: endDate || existingItem.endDate,
          summary: summary || existingItem.summary,
        };
        continue;
      }

      const newItem = {
        ...createBlankVolunteer(),
        role,
        organization,
        cause,
        startDate,
        endDate,
        summary,
      };

      const blankIndex = next.findIndex((item) => isVolunteerEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key !== "::") indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  const mergeServices = (
    existing: ResumeDraft["services"],
    additions: Array<Partial<ResumeDraft["services"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = normalizeKey(item.name);
      if (key) indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const name = coerceText(addition.name);
      const description = coerceText(addition.description);
      if (!name && !description) {
        continue;
      }

      const key = normalizeKey(name);
      if (key && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          name: name || existingItem.name,
          description: description || existingItem.description,
        };
        continue;
      }

      const newItem = {
        ...createBlankService(),
        name,
        description,
      };

      const blankIndex = next.findIndex((item) => isServiceEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key) indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key) indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  const mergeLinks = (
    existing: ResumeDraft["links"],
    additions: Array<Partial<ResumeDraft["links"][number]>>,
  ) => {
    const next = existing.map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    next.forEach((item, index) => {
      const key = `${normalizeKey(item.label)}::${normalizeKey(item.url)}`;
      if (key !== "::") indexByKey.set(key, index);
    });

    for (const addition of additions) {
      const label = coerceText(addition.label);
      const url = coerceText(addition.url);
      if (!label && !url) {
        continue;
      }

      const key = `${normalizeKey(label)}::${normalizeKey(url)}`;
      if (key !== "::" && indexByKey.has(key)) {
        const index = indexByKey.get(key) ?? 0;
        const existingItem = next[index];
        if (!existingItem) continue;
        next[index] = {
          ...existingItem,
          label: label || existingItem.label,
          url: url || existingItem.url,
        };
        continue;
      }

      const newItem = {
        ...createBlankLink(),
        label,
        url,
      };

      const blankIndex = next.findIndex((item) => isLinkEmpty(item));
      if (blankIndex >= 0) {
        next[blankIndex] = newItem;
        if (key !== "::") indexByKey.set(key, blankIndex);
      } else {
        next.push(newItem);
        if (key !== "::") indexByKey.set(key, next.length - 1);
      }
    }

    return next;
  };

  return {
    ...draft,
    profile,
    skills,
    experiences: mergeExperiences(draft.experiences, updates.experiences ?? []),
    education: mergeEducation(draft.education, updates.education ?? []),
    projects: mergeProjects(draft.projects, updates.projects ?? []),
    certifications: mergeCertifications(
      draft.certifications,
      updates.certifications ?? [],
    ),
    honors: mergeHonors(draft.honors, updates.honors ?? []),
    volunteering: mergeVolunteering(
      draft.volunteering,
      updates.volunteering ?? [],
    ),
    services: mergeServices(draft.services, updates.services ?? []),
    links: mergeLinks(draft.links, updates.links ?? []),
  };
};

const normalizeSteps = (stored?: Step[]) => {
  if (!stored || stored.length === 0) return baseSteps;
  const storedIds = new Set(stored.map((step) => step.id));
  const hasAllBase = baseSteps.every((step) => storedIds.has(step.id));
  if (!hasAllBase) return baseSteps;
  return stored;
};

const hasAllBaseSteps = (steps: Step[]) => {
  const ids = new Set(steps.map((step) => step.id));
  return baseSteps.every((step) => ids.has(step.id));
};

export function ResumeWizard({ edenEnabled = false }: ResumeWizardProps) {
  const STORAGE_KEY = "resumeWizardState.v1";
  const [draft, setDraft] = useState<ResumeDraft>(() => createEmptyDraft());
  const [scraped, setScraped] = useState<ScrapedProfile | null>(null);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [scrapeState, setScrapeState] = useState<
    "idle" | "queued" | "running" | "success" | "error"
  >("idle");
  const [scrapeError, setScrapeError] = useState("");
  const [scrapeJobId, setScrapeJobId] = useState<string | null>(null);
  const [scrapeQueuePosition, setScrapeQueuePosition] = useState<number | null>(
    null,
  );
  const [hasStarted, setHasStarted] = useState(false);
  const [steps, setSteps] = useState<Step[]>(baseSteps);
  const [currentStep, setCurrentStep] = useState(0);
  const [skillFollowupsAdded, setSkillFollowupsAdded] = useState(false);
  const [dynamicStepsAdded, setDynamicStepsAdded] = useState(false);
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicError, setDynamicError] = useState("");
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, string>>(
    {},
  );
  const [importMode, setImportMode] = useState<"linkedin" | "resume">(
    "linkedin",
  );
  const [showPasteLinkedIn, setShowPasteLinkedIn] = useState(false);
  const [linkedinText, setLinkedinText] = useState("");
  const [pasteState, setPasteState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [pasteError, setPasteError] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [uploadError, setUploadError] = useState("");
  const [headshotError, setHeadshotError] = useState("");
  const [siteSlug, setSiteSlug] = useState("");
  const [siteSlugTouched, setSiteSlugTouched] = useState(false);
  const [siteJobState, setSiteJobState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [siteJobError, setSiteJobError] = useState("");
  const [siteJobInfo, setSiteJobInfo] = useState<{
    jobId?: string;
    domain?: string;
  } | null>(null);
  const [activeExperienceId, setActiveExperienceId] = useState<string | null>(
    null,
  );
  const [activeEducationId, setActiveEducationId] = useState<string | null>(
    null,
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const [activeCertificationId, setActiveCertificationId] = useState<
    string | null
  >(null);
  const [activeHonorId, setActiveHonorId] = useState<string | null>(null);
  const [activeVolunteerId, setActiveVolunteerId] = useState<string | null>(
    null,
  );
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);
  const [experienceSearch, setExperienceSearch] = useState("");
  const [showExperienceAdd, setShowExperienceAdd] = useState(false);
  const [pendingExperienceFocus, setPendingExperienceFocus] = useState(false);
  const experienceAddInputRef = useRef<HTMLInputElement>(null);
  const experienceTitleRef = useRef<HTMLInputElement>(null);
  const [showEducationImport, setShowEducationImport] = useState(false);
  const [showProjectImport, setShowProjectImport] = useState(false);
  const [showLinkImport, setShowLinkImport] = useState(false);
  const [showCertificationImport, setShowCertificationImport] = useState(false);
  const [showHonorImport, setShowHonorImport] = useState(false);
  const [showVolunteerImport, setShowVolunteerImport] = useState(false);
  const [showServiceImport, setShowServiceImport] = useState(false);
  const educationAddInputRef = useRef<HTMLInputElement>(null);
  const projectAddInputRef = useRef<HTMLInputElement>(null);
  const linkAddInputRef = useRef<HTMLInputElement>(null);
  const certificationAddInputRef = useRef<HTMLInputElement>(null);
  const honorAddInputRef = useRef<HTMLInputElement>(null);
  const volunteerAddInputRef = useRef<HTMLInputElement>(null);
  const serviceAddInputRef = useRef<HTMLInputElement>(null);
  const [navQuery, setNavQuery] = useState("");
  const [educationSearch, setEducationSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [certificationSearch, setCertificationSearch] = useState("");
  const [honorSearch, setHonorSearch] = useState("");
  const [volunteerSearch, setVolunteerSearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [exportDocxState, setExportDocxState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [exportPdfState, setExportPdfState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [exportError, setExportError] = useState("");
  const [resumeTheme, setResumeTheme] = useState<ResumeTheme | null>(null);
  const [summaryAiOpen, setSummaryAiOpen] = useState(false);
  const [summaryAiVisible, setSummaryAiVisible] = useState(false);
  const [summaryAiPrompt, setSummaryAiPrompt] = useState("");
  const [summaryAiState, setSummaryAiState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [summaryAiError, setSummaryAiError] = useState("");
  const [summaryAiHistory, setSummaryAiHistory] =
    useState<SummaryAiHistory>([]);
  const [autoRewriteKey, setAutoRewriteKey] = useState<string | null>(null);
  const [consultantComplete, setConsultantComplete] = useState(false);
  const [consultantMessages, setConsultantMessages] = useState<
    ConsultantMessage[]
  >([]);
  const [consultantInput, setConsultantInput] = useState("");
  const [consultantState, setConsultantState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [consultantError, setConsultantError] = useState("");
  const [consultantActivePill, setConsultantActivePill] = useState<
    string | null
  >(null);
  const [consultantOpen, setConsultantOpen] = useState(false);
  const [consultantVisible, setConsultantVisible] = useState(false);
  const [experienceAiOpen, setExperienceAiOpen] = useState(false);
  const [experienceAiVisible, setExperienceAiVisible] = useState(false);
  const [experienceAiId, setExperienceAiId] = useState<string | null>(null);
  const [experienceAiPrompt, setExperienceAiPrompt] = useState("");
  const [experienceAiState, setExperienceAiState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [experienceAiError, setExperienceAiError] = useState("");
  const [experienceAiHistory, setExperienceAiHistory] =
    useState<ExperienceAiHistory>({});
  const summaryAiCloseTimeoutRef = useRef<number | null>(null);
  const consultantCloseTimeoutRef = useRef<number | null>(null);
  const experienceAiCloseTimeoutRef = useRef<number | null>(null);
  const autoRewriteInFlightRef = useRef<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<
    "launch" | "signal" | "studio" | null
  >(null);
  const [packageDeclined, setPackageDeclined] = useState(false);
  const [shareUnlocked, setShareUnlocked] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const isReviewStep = steps[currentStep]?.kind === "review";
  const showUpsell = hasStarted && consultantComplete && isReviewStep;
  const sharePost =
    "Just rebuilt my resume with Resume Foundry. Next up: a personal site that shows my work and impact. AI builds it, I tune it. #ResumeFoundry";

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("linkedinScrapeJobId")
        : null;
    if (stored) {
      setScrapeJobId(stored);
      setScrapeState("queued");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (scrapeJobId) {
      window.localStorage.setItem("linkedinScrapeJobId", scrapeJobId);
    } else {
      window.localStorage.removeItem("linkedinScrapeJobId");
    }
  }, [scrapeJobId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setIsHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as {
        draft?: ResumeDraft;
        scraped?: ScrapedProfile | null;
        steps?: Step[];
        currentStep?: number;
        dynamicAnswers?: Record<string, string>;
        skillFollowupsAdded?: boolean;
        dynamicStepsAdded?: boolean;
        hasStarted?: boolean;
        importMode?: "linkedin" | "resume";
        linkedinUrl?: string;
        experienceAiHistory?: ExperienceAiHistory;
        summaryAiHistory?: SummaryAiHistory;
        autoRewriteKey?: string | null;
        consultantMessages?: ConsultantMessage[];
        consultantComplete?: boolean;
      };

      if (parsed.draft) setDraft(normalizeDraft(parsed.draft));
      if (parsed.scraped !== undefined) setScraped(parsed.scraped ?? null);
      if (parsed.steps && parsed.steps.length > 0) {
        const nextSteps = normalizeSteps(parsed.steps);
        setSteps(nextSteps);
        if (
          typeof parsed.currentStep === "number" &&
          parsed.currentStep >= nextSteps.length
        ) {
          setCurrentStep(nextSteps.length - 1);
        }
      }
      if (typeof parsed.currentStep === "number") {
        setCurrentStep(Math.max(0, parsed.currentStep));
      }
      if (parsed.dynamicAnswers) setDynamicAnswers(parsed.dynamicAnswers);
      if (typeof parsed.skillFollowupsAdded === "boolean") {
        setSkillFollowupsAdded(parsed.skillFollowupsAdded);
      }
      if (typeof parsed.dynamicStepsAdded === "boolean") {
        setDynamicStepsAdded(parsed.dynamicStepsAdded);
      }
      if (typeof parsed.hasStarted === "boolean") {
        setHasStarted(parsed.hasStarted);
      }
      if (parsed.importMode === "linkedin" || parsed.importMode === "resume") {
        setImportMode(parsed.importMode);
      }
      if (parsed.linkedinUrl) setLinkedinUrl(parsed.linkedinUrl);
      if (parsed.experienceAiHistory) {
        setExperienceAiHistory(parsed.experienceAiHistory);
      }
      if (parsed.summaryAiHistory) {
        setSummaryAiHistory(parsed.summaryAiHistory);
      }
      if (typeof parsed.autoRewriteKey === "string") {
        setAutoRewriteKey(parsed.autoRewriteKey);
      }
      if (Array.isArray(parsed.consultantMessages)) {
        setConsultantMessages(parsed.consultantMessages);
      }
      if (typeof parsed.consultantComplete === "boolean") {
        setConsultantComplete(parsed.consultantComplete);
      }
    } catch {
      // ignore storage parse errors
    } finally {
      setIsHydrated(true);
    }
  }, [STORAGE_KEY]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    const payload = {
      draft,
      scraped,
      steps,
      currentStep,
      dynamicAnswers,
      skillFollowupsAdded,
      dynamicStepsAdded,
      hasStarted,
      importMode,
      linkedinUrl,
      experienceAiHistory,
      summaryAiHistory,
      autoRewriteKey,
      consultantMessages,
      consultantComplete,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    STORAGE_KEY,
    isHydrated,
    draft,
    scraped,
    steps,
    currentStep,
    dynamicAnswers,
    skillFollowupsAdded,
    dynamicStepsAdded,
    hasStarted,
    importMode,
    linkedinUrl,
    experienceAiHistory,
    summaryAiHistory,
    autoRewriteKey,
    consultantMessages,
    consultantComplete,
  ]);

  useEffect(() => {
    if (siteSlugTouched) return;
    const candidate = slugify(draft.profile.fullName ?? "");
    if (candidate) setSiteSlug(candidate);
  }, [draft.profile.fullName, siteSlugTouched]);

  useEffect(() => {
    if (steps.length === 0) {
      setSteps(baseSteps);
      setCurrentStep(0);
      return;
    }
    if (currentStep >= steps.length) {
      setCurrentStep(steps.length - 1);
    }
  }, [steps, currentStep]);

  useEffect(() => {
    if (!scraped) return;

    const baseline = normalizeDraft(
      applyScrapedProfile(createEmptyDraft(), scraped),
    );

    setDraft((current) => applyScrapedProfile(current, scraped));

    if (!edenEnabled || importMode === "resume") return;

    const scrapedKey = buildScrapedKey(scraped);
    if (
      autoRewriteKey === scrapedKey ||
      autoRewriteInFlightRef.current === scrapedKey
    ) {
      return;
    }

    if (!hasSummaryContent(baseline)) {
      setAutoRewriteKey(scrapedKey);
      return;
    }

    let active = true;
    const runAutoRewrite = async () => {
      autoRewriteInFlightRef.current = scrapedKey;
      try {
        const response = await fetch("/api/ai/polish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft: stripHeadshotFromDraft(baseline),
            scraped: stripHeadshotFromScraped(scraped),
          }),
        });

        if (!active) return;

        if (!response.ok) {
          setAutoRewriteKey(scrapedKey);
          return;
        }

        const data = (await response.json()) as { draft?: ResumeDraft };
        if (!data.draft) {
          setAutoRewriteKey(scrapedKey);
          return;
        }

        let polished = normalizeDraft(data.draft);
        const baselineSummary = normalizeSummaryText(baseline.profile.summary);
        const polishedSummary = normalizeSummaryText(polished.profile.summary);

        if (baselineSummary && polishedSummary === baselineSummary) {
          try {
            const summaryResponse = await fetch("/api/ai/summary", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                summary: baselineSummary,
                profile: baseline.profile,
                prompt:
                  "Rewrite with fresh wording and sentence structure. Do not reuse any sentence verbatim.",
              }),
            });
            if (summaryResponse.ok) {
              const summaryData = (await summaryResponse.json()) as {
                summary?: string;
              };
              const forcedSummary = normalizeSummaryText(summaryData.summary);
              if (forcedSummary && forcedSummary !== baselineSummary) {
                polished = {
                  ...polished,
                  profile: { ...polished.profile, summary: forcedSummary },
                };
              }
            }
          } catch {
            // ignore fallback failures
          }
        }

        if (!active) return;
        setDraft((current) => applyAutoRewrite(current, baseline, polished));
        setExperienceAiHistory((current) =>
          seedAutoRewriteHistory(current, baseline, polished),
        );
        setSummaryAiHistory((current) =>
          seedAutoRewriteSummary(current, baseline, polished),
        );
        setAutoRewriteKey(scrapedKey);
      } catch {
        if (!active) return;
        setAutoRewriteKey(scrapedKey);
      } finally {
        if (autoRewriteInFlightRef.current === scrapedKey) {
          autoRewriteInFlightRef.current = null;
        }
      }
    };

    void runAutoRewrite();
    return () => {
      active = false;
    };
  }, [
    scraped,
    edenEnabled,
    importMode,
    autoRewriteKey,
  ]);

  useEffect(() => {
    if (!hasStarted) return;
    const targetId = consultantComplete ? "questions" : "consultant";
    document.getElementById(targetId)?.scrollIntoView({ behavior: "auto" });
  }, [hasStarted, consultantComplete]);

  useEffect(() => {
    if (!showUpsell || typeof window === "undefined") return;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-scroll-pop]"),
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-pop", "true");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [showUpsell]);

  useEffect(() => {
    if (!summaryAiVisible) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSummaryAiOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [summaryAiVisible]);

  useEffect(() => {
    if (!summaryAiVisible || summaryAiOpen) return;
    if (summaryAiCloseTimeoutRef.current) {
      window.clearTimeout(summaryAiCloseTimeoutRef.current);
    }
    summaryAiCloseTimeoutRef.current = window.setTimeout(() => {
      setSummaryAiVisible(false);
      setSummaryAiPrompt("");
      setSummaryAiError("");
      setSummaryAiState("idle");
      summaryAiCloseTimeoutRef.current = null;
    }, 220);
    return () => {
      if (summaryAiCloseTimeoutRef.current) {
        window.clearTimeout(summaryAiCloseTimeoutRef.current);
      }
    };
  }, [summaryAiOpen, summaryAiVisible]);

  useEffect(() => {
    if (!consultantVisible) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setConsultantOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [consultantVisible]);

  useEffect(() => {
    if (!consultantVisible || consultantOpen) return;
    if (consultantCloseTimeoutRef.current) {
      window.clearTimeout(consultantCloseTimeoutRef.current);
    }
    consultantCloseTimeoutRef.current = window.setTimeout(() => {
      setConsultantVisible(false);
      setConsultantError("");
      setConsultantState("idle");
      consultantCloseTimeoutRef.current = null;
    }, 220);
    return () => {
      if (consultantCloseTimeoutRef.current) {
        window.clearTimeout(consultantCloseTimeoutRef.current);
      }
    };
  }, [consultantOpen, consultantVisible]);

  useEffect(() => {
    if (!experienceAiVisible) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setExperienceAiOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [experienceAiVisible]);

  useEffect(() => {
    if (!experienceAiVisible || experienceAiOpen) return;
    if (experienceAiCloseTimeoutRef.current) {
      window.clearTimeout(experienceAiCloseTimeoutRef.current);
    }
    experienceAiCloseTimeoutRef.current = window.setTimeout(() => {
      setExperienceAiVisible(false);
      setExperienceAiId(null);
      setExperienceAiPrompt("");
      setExperienceAiError("");
      setExperienceAiState("idle");
      experienceAiCloseTimeoutRef.current = null;
    }, 220);
    return () => {
      if (experienceAiCloseTimeoutRef.current) {
        window.clearTimeout(experienceAiCloseTimeoutRef.current);
      }
    };
  }, [experienceAiOpen, experienceAiVisible]);

  useEffect(() => {
    if (!scrapeJobId) return;

    let active = true;

    const poll = async () => {
      try {
        const response = await fetch(`/api/linkedin/scrape/${scrapeJobId}`);
        const data = (await response.json().catch(() => null)) as
          | {
            status?: string;
            position?: number | null;
            profile?: ScrapedProfile;
            error?: string;
          }
          | null;

        if (!active || !data) return;

        if (!response.ok) {
          setScrapeState("error");
          setScrapeError(data.error ?? "We could not read that profile.");
          setScrapeJobId(null);
          setScrapeQueuePosition(null);
          return;
        }

        if (data.status === "queued") {
          setScrapeState("queued");
          setScrapeQueuePosition(data.position ?? null);
          return;
        }

        if (data.status === "running") {
          setScrapeState("running");
          setScrapeQueuePosition(null);
          return;
        }

        if (data.status === "failed" || data.status === "requires_login") {
          const authWall =
            data.status === "requires_login" ||
            (typeof data.error === "string" &&
              data.error.toLowerCase().includes("auth_wall"));
          const timedOut =
            typeof data.error === "string" &&
            data.error.toLowerCase().includes("timeout");
          setScrapeState("error");
          setScrapeError(
            authWall
              ? "LinkedIn login required. Ask an admin to refresh the scraper session or upload a resume."
              : timedOut
                ? "LinkedIn took too long to load. Try again or upload a resume."
                : data.error ?? "We could not read that profile.",
          );
          setScrapeJobId(null);
          setScrapeQueuePosition(null);
          return;
        }

        if (data.status === "canceled") {
          setScrapeState("error");
          setScrapeError("Scrape canceled.");
          setScrapeJobId(null);
          setScrapeQueuePosition(null);
          return;
        }

        if (data.profile) {
          setScraped(data.profile);
          setScrapeState("success");
          setScrapeJobId(null);
          setScrapeQueuePosition(null);
          setHasStarted(true);
          setConsultantComplete(false);
          setConsultantMessages([]);
        }
      } catch (_error) {
        if (!active) return;
        setScrapeState("error");
        setScrapeError("We could not read that profile.");
        setScrapeJobId(null);
        setScrapeQueuePosition(null);
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 2500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [scrapeJobId]);

  useEffect(() => {
    setPasteError("");
    setUploadError("");
    setPasteState("idle");
    setUploadState("idle");
    if (importMode === "resume") {
      setShowPasteLinkedIn(false);
    }
  }, [importMode]);

  useEffect(() => {
    if (draft.experiences.length === 0) return;
    if (
      !activeExperienceId ||
      !draft.experiences.some((item) => item.id === activeExperienceId)
    ) {
      const first = draft.experiences[0];
      if (first) setActiveExperienceId(first.id);
    }
  }, [draft.experiences, activeExperienceId]);

  useEffect(() => {
    if (!pendingExperienceFocus) return;
    const handle = window.setTimeout(() => {
      experienceTitleRef.current?.focus();
      setPendingExperienceFocus(false);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [pendingExperienceFocus, activeExperienceId]);

  useEffect(() => {
    if (draft.education.length === 0) return;
    if (
      !activeEducationId ||
      !draft.education.some((item) => item.id === activeEducationId)
    ) {
      const first = draft.education[0];
      if (first) setActiveEducationId(first.id);
    }
  }, [draft.education, activeEducationId]);

  useEffect(() => {
    if (draft.projects.length === 0) return;
    if (
      !activeProjectId ||
      !draft.projects.some((item) => item.id === activeProjectId)
    ) {
      const first = draft.projects[0];
      if (first) setActiveProjectId(first.id);
    }
  }, [draft.projects, activeProjectId]);

  useEffect(() => {
    if (draft.links.length === 0) return;
    if (!activeLinkId || !draft.links.some((item) => item.id === activeLinkId)) {
      const first = draft.links[0];
      if (first) setActiveLinkId(first.id);
    }
  }, [draft.links, activeLinkId]);

  useEffect(() => {
    if (draft.certifications.length === 0) return;
    if (
      !activeCertificationId ||
      !draft.certifications.some((item) => item.id === activeCertificationId)
    ) {
      const first = draft.certifications[0];
      if (first) setActiveCertificationId(first.id);
    }
  }, [draft.certifications, activeCertificationId]);

  useEffect(() => {
    if (draft.honors.length === 0) return;
    if (!activeHonorId || !draft.honors.some((item) => item.id === activeHonorId)) {
      const first = draft.honors[0];
      if (first) setActiveHonorId(first.id);
    }
  }, [draft.honors, activeHonorId]);

  useEffect(() => {
    if (draft.volunteering.length === 0) return;
    if (
      !activeVolunteerId ||
      !draft.volunteering.some((item) => item.id === activeVolunteerId)
    ) {
      const first = draft.volunteering[0];
      if (first) setActiveVolunteerId(first.id);
    }
  }, [draft.volunteering, activeVolunteerId]);

  useEffect(() => {
    if (draft.services.length === 0) return;
    if (!activeServiceId || !draft.services.some((item) => item.id === activeServiceId)) {
      const first = draft.services[0];
      if (first) setActiveServiceId(first.id);
    }
  }, [draft.services, activeServiceId]);

  useEffect(() => {
    if (steps.length === 0) return;
    if (currentStep >= steps.length) {
      setCurrentStep(Math.max(0, steps.length - 1));
    }
  }, [currentStep, steps.length]);

  useEffect(() => {
    if (!hasAllBaseSteps(steps)) {
      setSteps(baseSteps);
      setCurrentStep(0);
      setSkillFollowupsAdded(false);
      setDynamicStepsAdded(false);
    }
  }, [steps]);

  const progress = useMemo(() => {
    return Math.round(((currentStep + 1) / steps.length) * 100);
  }, [currentStep, steps.length]);

  const handleScrape = async () => {
    if (!linkedinUrl.trim()) {
      setScrapeError("Paste a LinkedIn URL or continue without it.");
      setScrapeState("error");
      return;
    }

    setScrapeState("running");
    setScrapeError("");
    setScrapeQueuePosition(null);

    try {
      const response = await fetch("/api/linkedin/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkedinUrl.trim() }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
          jobId?: string;
          status?: "queued" | "running";
          position?: number | null;
          error?: string;
        }
        | null;

      if (!response.ok || !data?.jobId) {
        setScrapeState("error");
        setScrapeError(data?.error ?? "We could not queue that profile.");
        setScrapeQueuePosition(null);
        return;
      }

      setScrapeJobId(data.jobId);
      setScrapeState(data.status === "queued" ? "queued" : "running");
      setScrapeQueuePosition(data.position ?? null);
    } catch (_error) {
      setScrapeState("error");
      setScrapeError(
        "Scraper unavailable. Start the scraper service or upload a resume.",
      );
      setScrapeQueuePosition(null);
    }
  };

  const handleSkipLinkedIn = () => {
    setScrapeState("idle");
    setScrapeError("");
    setScrapeJobId(null);
    setScrapeQueuePosition(null);
    setHasStarted(true);
    setConsultantComplete(false);
    setConsultantMessages([]);
  };

  const handleStartOver = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem("linkedinScrapeJobId");
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    setDraft(createEmptyDraft());
    setScraped(null);
    setLinkedinUrl("");
    setScrapeState("idle");
    setScrapeError("");
    setScrapeJobId(null);
    setScrapeQueuePosition(null);
    setHasStarted(false);
    setSteps(baseSteps);
    setCurrentStep(0);
    setSkillFollowupsAdded(false);
    setDynamicStepsAdded(false);
    setDynamicAnswers({});
    setDynamicError("");
    setDynamicLoading(false);
    setImportMode("linkedin");
    setShowPasteLinkedIn(false);
    setLinkedinText("");
    setPasteState("idle");
    setPasteError("");
    setUploadFile(null);
    setUploadState("idle");
    setUploadError("");
    setHeadshotError("");
    setSiteSlug("");
    setSiteSlugTouched(false);
    setSiteJobState("idle");
    setSiteJobError("");
    setSiteJobInfo(null);
    setActiveExperienceId(null);
    setActiveEducationId(null);
    setActiveProjectId(null);
    setActiveLinkId(null);
    setExperienceSearch("");
    setEducationSearch("");
    setProjectSearch("");
    setLinkSearch("");
    setShowProjectImport(false);
    setExperienceAiOpen(false);
    setExperienceAiVisible(false);
    setExperienceAiId(null);
    setExperienceAiPrompt("");
    setExperienceAiState("idle");
    setExperienceAiError("");
    setExperienceAiHistory({});
    setSummaryAiOpen(false);
    setSummaryAiVisible(false);
    setSummaryAiPrompt("");
    setSummaryAiState("idle");
    setSummaryAiError("");
    setSummaryAiHistory([]);
    setAutoRewriteKey(null);
    setConsultantComplete(false);
    setConsultantMessages([]);
    setConsultantInput("");
    setConsultantError("");
    setConsultantState("idle");
    setConsultantActivePill(null);
    setConsultantOpen(false);
    setConsultantVisible(false);
    setSelectedPackage(null);
    setPackageDeclined(false);
    setShareUnlocked(false);
    setShareCopied(false);
    if (consultantCloseTimeoutRef.current) {
      window.clearTimeout(consultantCloseTimeoutRef.current);
      consultantCloseTimeoutRef.current = null;
    }
    if (experienceAiCloseTimeoutRef.current) {
      window.clearTimeout(experienceAiCloseTimeoutRef.current);
      experienceAiCloseTimeoutRef.current = null;
    }
    if (summaryAiCloseTimeoutRef.current) {
      window.clearTimeout(summaryAiCloseTimeoutRef.current);
      summaryAiCloseTimeoutRef.current = null;
    }
    autoRewriteInFlightRef.current = null;
  };

  const scrollToSection = (id: string) => {
    if (typeof window === "undefined") return;
    const target = document.getElementById(id);
    if (target) {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  };

  const handleSelectPackage = (value: "launch" | "signal" | "studio") => {
    setSelectedPackage(value);
    setPackageDeclined(false);
    setShareUnlocked(false);
    setShareCopied(false);
  };

  const handleDeclinePackage = () => {
    setPackageDeclined(true);
    setSelectedPackage(null);
    setShareUnlocked(false);
    setShareCopied(false);
  };

  const handleCopySharePost = async () => {
    try {
      await navigator.clipboard.writeText(sharePost);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  };

  const handlePasteImport = async () => {
    if (!edenEnabled) {
      setPasteError("AI import is unavailable.");
      setPasteState("error");
      return;
    }

    if (!linkedinText.trim()) {
      setPasteError("Paste your LinkedIn profile text first.");
      setPasteState("error");
      return;
    }

    setPasteState("loading");
    setPasteError("");

    try {
      const response = await fetch("/api/linkedin/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: linkedinText.trim(),
          url: linkedinUrl.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setPasteState("error");
        setPasteError(data?.error ?? "We could not parse that text.");
        return;
      }

      const data = (await response.json()) as { profile: ScrapedProfile };
      setScraped(data.profile);
      setPasteState("success");
      setHasStarted(true);
      setConsultantComplete(false);
      setConsultantMessages([]);
    } catch (_error) {
      setPasteState("error");
      setPasteError("We could not parse that text.");
    }
  };

  const handleFileImport = async () => {
    if (!edenEnabled) {
      setUploadError("AI import is unavailable.");
      setUploadState("error");
      return;
    }

    if (!uploadFile) {
      setUploadError("Choose a file to import.");
      setUploadState("error");
      return;
    }

    setUploadState("loading");
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      if (linkedinUrl.trim()) {
        formData.append("url", linkedinUrl.trim());
      }

      // Let the browser set the multipart boundary for FormData.
      const response = await fetch("/api/resume/import", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setUploadState("error");
        setUploadError(data?.error ?? "We could not parse that file.");
        return;
      }

      const data = (await response.json()) as { profile: ScrapedProfile };
      setScraped(data.profile);
      setUploadState("success");
      setHasStarted(true);
      setConsultantComplete(false);
      setConsultantMessages([]);
    } catch (_error) {
      setUploadState("error");
      setUploadError("We could not parse that file.");
    }
  };

  const requestSmartQuestions = async (
    currentDraft: ResumeDraft,
  ): Promise<DynamicStep[]> => {
    setDynamicLoading(true);
    setDynamicError("");

    try {
      const response = await fetch("/api/ai/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: stripHeadshotFromDraft(currentDraft),
          scraped: stripHeadshotFromScraped(scraped),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setDynamicError(
          data?.error ?? "We could not generate tailored questions.",
        );
        return [];
      }

      const data = (await response.json()) as {
        questions: Array<Omit<DynamicStep, "kind" | "id"> & { id?: string }>;
      };

      return (data.questions ?? []).map((question) => ({
        ...question,
        id: question.id ?? `dynamic-${question.key}`,
        kind: "dynamic",
      }));
    } catch (_error) {
      setDynamicError("We could not generate tailored questions.");
      return [];
    } finally {
      setDynamicLoading(false);
    }
  };

  const resolveTheme = async (cleaned: ResumeDraft) => {
    if (resumeTheme) return resumeTheme;
    try {
      const response = await fetch("/api/resume/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripHeadshotFromDraft(cleaned)),
      });
      if (!response.ok) {
        return DEFAULT_RESUME_THEME;
      }
      const data = (await response.json()) as { theme?: ResumeTheme };
      if (data.theme) {
        setResumeTheme(data.theme);
        return data.theme;
      }
    } catch {
      return DEFAULT_RESUME_THEME;
    }
    return DEFAULT_RESUME_THEME;
  };

  const handleExportDocx = async () => {
    if (exportDocxState === "loading") return;
    setExportDocxState("loading");
    setExportError("");

    const cleaned = cleanDraft(normalizeDraft(draft));
    const theme = await resolveTheme(cleaned);

    try {
      const response = await fetch("/api/resume/export/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: cleaned, theme }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setExportDocxState("error");
        setExportError(data?.error ?? "Could not generate your resume.");
        return;
      }

      const blob = await response.blob();
      const fileName =
        cleaned.profile.fullName?.trim().replace(/[^a-z0-9]+/gi, "_") ||
        "resume";
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportDocxState("success");
    } catch (_error) {
      setExportDocxState("error");
      setExportError("Could not generate your resume.");
    }
  };

  const handleExportPdf = async () => {
    if (exportPdfState === "loading") return;
    setExportPdfState("loading");
    setExportError("");

    const cleaned = cleanDraft(normalizeDraft(draft));
    const theme = await resolveTheme(cleaned);
    const html = buildResumePdfHtml(cleaned, theme);

    try {
      const printWindow = window.open("", "_blank", "width=900,height=1200");
      if (!printWindow) {
        setExportPdfState("error");
        setExportError("Pop-up blocked. Allow pop-ups to download PDF.");
        return;
      }
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
        setExportPdfState("success");
      }, 350);
    } catch (_error) {
      setExportPdfState("error");
      setExportError("Could not generate your PDF.");
    }
  };

  const downloadTextFile = (fileName: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    setExportError("");
    try {
      const cleaned = cleanDraft(normalizeDraft(draft));
      const fileName =
        cleaned.profile.fullName?.trim().replace(/[^a-z0-9]+/gi, "_") ||
        "resume";
      const markdown = buildMarkdownResume(cleaned);
      downloadTextFile(`${fileName}.md`, markdown, "text/markdown");
    } catch {
      setExportError("Could not generate your resume.");
    }
  };

  const handleExportText = () => {
    setExportError("");
    try {
      const cleaned = cleanDraft(normalizeDraft(draft));
      const fileName =
        cleaned.profile.fullName?.trim().replace(/[^a-z0-9]+/gi, "_") ||
        "resume";
      const text = buildTextResume(cleaned);
      downloadTextFile(`${fileName}.txt`, text, "text/plain");
    } catch {
      setExportError("Could not generate your resume.");
    }
  };

  const updateProfileField = (
    field: keyof ResumeDraft["profile"],
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      profile: { ...current.profile, [field]: value },
    }));
  };

  const handleHeadshotChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setHeadshotError("Use a PNG or JPG file.");
      return;
    }
    if (file.size > HEADSHOT_MAX_BYTES) {
      setHeadshotError("Headshot must be under 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.trim()) {
        updateProfileField("headshotUrl", reader.result);
        setHeadshotError("");
        return;
      }
      setHeadshotError("Could not read that image.");
    };
    reader.onerror = () => {
      setHeadshotError("Could not read that image.");
    };
    reader.readAsDataURL(file);
  };

  const handleHeadshotRemove = () => {
    updateProfileField("headshotUrl", "");
    setHeadshotError("");
  };

  const handleSiteSlugChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSiteSlugTouched(true);
    setSiteSlug(slugify(event.target.value));
    setSiteJobError("");
    if (siteJobState !== "idle") {
      setSiteJobState("idle");
      setSiteJobInfo(null);
    }
  };

  const handleStartSiteGeneration = async () => {
    if (siteJobState === "loading") return;
    const slug = siteSlug || slugify(draft.profile.fullName ?? "");
    if (!slug) {
      setSiteJobState("error");
      setSiteJobError("Add a site URL slug to continue.");
      return;
    }

    setSiteJobState("loading");
    setSiteJobError("");
    setSiteJobInfo(null);

    const cleaned = cleanDraft(normalizeDraft(draft));
    const markdown = buildMarkdownResume(cleaned);
    const text = buildTextResume(cleaned);
    const theme = await resolveTheme(cleaned);
    const prompt = buildSitePrompt({
      draft: cleaned,
      steps,
      dynamicAnswers,
      consultantMessages,
    });

    try {
      const response = await fetch("/api/site/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, text, slug, prompt, draft: cleaned, theme }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setSiteJobState("error");
        setSiteJobError(data?.error ?? "We could not start site generation.");
        return;
      }

      const data = (await response.json().catch(() => null)) as
        | { job?: { jobId?: string }; domain?: string }
        | null;
      const jobId =
        typeof data?.job?.jobId === "string" ? data.job.jobId : undefined;
      const domain =
        typeof data?.domain === "string"
          ? data.domain
          : `${slug}.${SITE_DOMAIN_BASE}`;
      setSiteJobInfo({ jobId, domain });
      setSiteJobState("success");
    } catch (_error) {
      setSiteJobState("error");
      setSiteJobError("We could not start site generation.");
    }
  };

  const restoreProfileSummary = () => {
    if (!scraped || typeof scraped.profile?.summary !== "string") return;
    updateProfileField("summary", scraped.profile.summary ?? "");
  };

  const openSummaryAi = () => {
    if (summaryAiCloseTimeoutRef.current) {
      window.clearTimeout(summaryAiCloseTimeoutRef.current);
      summaryAiCloseTimeoutRef.current = null;
    }
    const latestPrompt =
      summaryAiHistory.find((entry) => entry.source !== "auto")?.prompt ?? "";
    setSummaryAiPrompt(latestPrompt);
    setSummaryAiError("");
    setSummaryAiState("idle");
    setSummaryAiVisible(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        setSummaryAiOpen(true);
      });
    } else {
      setSummaryAiOpen(true);
    }
  };

  const closeSummaryAi = () => {
    setSummaryAiOpen(false);
  };

  const openConsultant = () => {
    if (consultantCloseTimeoutRef.current) {
      window.clearTimeout(consultantCloseTimeoutRef.current);
      consultantCloseTimeoutRef.current = null;
    }
    setConsultantError("");
    setConsultantState("idle");
    setConsultantVisible(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        setConsultantOpen(true);
      });
    } else {
      setConsultantOpen(true);
    }
  };

  const closeConsultant = () => {
    setConsultantOpen(false);
  };

  const updateExperience = <
    K extends keyof ResumeDraft["experiences"][number],
  >(
    index: number,
    field: K,
    value: ResumeDraft["experiences"][number][K],
  ) => {
    setDraft((current) => {
      const experiences = [...current.experiences];
      const target = experiences[index];
      if (!target) return current;
      experiences[index] = { ...target, [field]: value };
      return { ...current, experiences };
    });
  };

  const restoreExperienceFromScraped = (experienceId: string) => {
    const original = scraped?.experiences?.find(
      (item) => item.id === experienceId,
    );
    if (!original) return;
    setDraft((current) => ({
      ...current,
      experiences: current.experiences.map((exp) =>
        exp.id === experienceId
          ? {
            ...exp,
            summary: original.summary ?? "",
            highlights: original.highlights ?? [],
          }
          : exp,
      ),
    }));
  };


  const openExperienceAi = (experienceId: string) => {
    if (experienceAiCloseTimeoutRef.current) {
      window.clearTimeout(experienceAiCloseTimeoutRef.current);
      experienceAiCloseTimeoutRef.current = null;
    }
    const history = experienceAiHistory[experienceId] ?? [];
    const latestPrompt =
      history.find((entry) => entry.source !== "auto")?.prompt ?? "";
    setExperienceAiId(experienceId);
    setExperienceAiPrompt(latestPrompt);
    setExperienceAiError("");
    setExperienceAiState("idle");
    setExperienceAiVisible(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        setExperienceAiOpen(true);
      });
    } else {
      setExperienceAiOpen(true);
    }
  };

  const closeExperienceAi = () => {
    setExperienceAiOpen(false);
  };

  const applyExperienceSuggestion = (
    experienceId: string,
    suggestion: ExperienceAiSuggestion,
  ) => {
    setDraft((current) => {
      const experiences = current.experiences.map((exp) => {
        if (exp.id !== experienceId) return exp;
        const nextSummary = suggestion.summary?.trim() ?? "";
        const nextHighlights = suggestion.highlights
          .map((item) => item.trim())
          .filter(Boolean);
        return {
          ...exp,
          summary: nextSummary || exp.summary,
          highlights: nextHighlights.length > 0 ? nextHighlights : exp.highlights,
        };
      });
      return { ...current, experiences };
    });
  };

  const applySummarySuggestion = (suggestion: SummaryAiSuggestion) => {
    updateProfileField("summary", suggestion.summary);
  };

  const handleSummaryAiGenerate = async () => {
    if (summaryAiState === "loading") return;
    if (!edenEnabled) {
      setSummaryAiError("AI is unavailable right now.");
      setSummaryAiState("error");
      return;
    }

    setSummaryAiState("loading");
    setSummaryAiError("");

    try {
      const response = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: draft.profile.summary ?? "",
          profile: {
            headline: draft.profile.headline,
            targetRole: draft.profile.targetRole,
            jobField: draft.profile.jobField,
            jobType: draft.profile.jobType,
          },
          prompt: summaryAiPrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setSummaryAiState("error");
        setSummaryAiError(data?.error ?? "We could not rewrite the summary.");
        return;
      }

      const data = (await response.json()) as {
        summary?: string;
      };
      const entry: SummaryAiSuggestion = {
        id: createItemId(),
        createdAt: Date.now(),
        prompt: summaryAiPrompt.trim(),
        summary: data.summary?.trim() ?? "",
        source: "prompt",
      };
      setSummaryAiHistory((current) => [entry, ...current].slice(0, 10));
      setSummaryAiState("idle");
    } catch (_error) {
      setSummaryAiState("error");
      setSummaryAiError("We could not rewrite the summary.");
    }
  };

  const handleExperienceAiGenerate = async () => {
    if (experienceAiState === "loading") return;
    if (!edenEnabled) {
      setExperienceAiError("AI is unavailable right now.");
      setExperienceAiState("error");
      return;
    }
    if (!experienceAiId) return;
    const experience = draft.experiences.find(
      (item) => item.id === experienceAiId,
    );
    if (!experience) return;

    setExperienceAiState("loading");
    setExperienceAiError("");

    try {
      const response = await fetch("/api/ai/experience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experience,
          profile: {
            headline: draft.profile.headline,
            targetRole: draft.profile.targetRole,
            jobField: draft.profile.jobField,
            jobType: draft.profile.jobType,
          },
          prompt: experienceAiPrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setExperienceAiState("error");
        setExperienceAiError(data?.error ?? "We could not rewrite that role.");
        return;
      }

      const data = (await response.json()) as {
        suggestion?: { summary?: string; highlights?: string[] };
      };
      const suggestion = data?.suggestion ?? {};
      const entry: ExperienceAiSuggestion = {
        id: createItemId(),
        createdAt: Date.now(),
        prompt: experienceAiPrompt.trim(),
        summary: suggestion.summary?.trim() ?? "",
        highlights: (suggestion.highlights ?? []).filter(Boolean),
        source: "prompt",
      };

      setExperienceAiHistory((current) => {
        const existing = current[experienceAiId] ?? [];
        const next = [entry, ...existing].slice(0, 10);
        return { ...current, [experienceAiId]: next };
      });
      setExperienceAiState("idle");
    } catch (_error) {
      setExperienceAiState("error");
      setExperienceAiError("We could not rewrite that role.");
    }
  };

  const handleConsultantSend = async () => {
    if (consultantState === "loading") return;
    if (!edenEnabled) {
      setConsultantError("AI is unavailable right now.");
      setConsultantState("error");
      return;
    }
    const content = consultantInput.trim();
    if (!content) return;
    const fallbackContact = extractContactInfo(content);

    const userMessage: ConsultantMessage = {
      id: createItemId(),
      role: "user",
      content,
      createdAt: Date.now(),
    };

    const nextMessages = [...consultantMessages, userMessage];
    setConsultantMessages(nextMessages);
    setConsultantInput("");
    setConsultantState("loading");
    setConsultantError("");

    try {
      const response = await fetch("/api/ai/consultant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: stripHeadshotFromDraft(cleanDraft(draft)),
          scraped: stripHeadshotFromScraped(scraped),
          messages: nextMessages.map(({ role, content: msgContent }) => ({
            role,
            content: msgContent,
          })),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setConsultantState("error");
        setConsultantError(data?.error ?? "We could not reach the consultant.");
        return;
      }

      const data = (await response.json()) as {
        assistant?: string;
        updates?: ConsultantUpdates;
        followUps?: string[];
      };

      if (data.updates || fallbackContact.email || fallbackContact.phone) {
        setDraft((current) => {
          const merged = data.updates
            ? mergeConsultantUpdates(current, data.updates ?? {})
            : normalizeDraft(current);
          return applyFallbackContact(merged, fallbackContact);
        });
      }

      const assistantText = (data.assistant ?? "").trim();
      const followUps = (data.followUps ?? [])
        .map((item) => item.trim())
        .filter(Boolean);
      const assistantParts: string[] = [];
      if (assistantText) assistantParts.push(assistantText);
      if (followUps.length > 0) {
        assistantParts.push(`Follow-ups:\n- ${followUps.join("\n- ")}`);
      }

      const assistantMessage: ConsultantMessage = {
        id: createItemId(),
        role: "assistant",
        content: assistantParts.join("\n\n") || "Noted. Tell me more.",
        createdAt: Date.now(),
      };

      setConsultantMessages((current) => [...current, assistantMessage]);
      setConsultantState("idle");
    } catch (_error) {
      setConsultantState("error");
      setConsultantError("We could not reach the consultant.");
    }
  };

  const updateEducation = <
    K extends keyof ResumeDraft["education"][number],
  >(
    index: number,
    field: K,
    value: ResumeDraft["education"][number][K],
  ) => {
    setDraft((current) => {
      const education = [...current.education];
      const target = education[index];
      if (!target) return current;
      education[index] = { ...target, [field]: value };
      return { ...current, education };
    });
  };

  const updateProject = <K extends keyof ResumeDraft["projects"][number]>(
    index: number,
    field: K,
    value: ResumeDraft["projects"][number][K],
  ) => {
    setDraft((current) => {
      const projects = [...current.projects];
      const target = projects[index];
      if (!target) return current;
      projects[index] = { ...target, [field]: value };
      return { ...current, projects };
    });
  };

  const updateLink = <K extends keyof ResumeDraft["links"][number]>(
    index: number,
    field: K,
    value: ResumeDraft["links"][number][K],
  ) => {
    setDraft((current) => {
      const links = [...current.links];
      const target = links[index];
      if (!target) return current;
      links[index] = { ...target, [field]: value };
      return { ...current, links };
    });
  };

  const updateCertification = <
    K extends keyof ResumeDraft["certifications"][number],
  >(
    index: number,
    field: K,
    value: ResumeDraft["certifications"][number][K],
  ) => {
    setDraft((current) => {
      const certifications = [...current.certifications];
      const target = certifications[index];
      if (!target) return current;
      certifications[index] = { ...target, [field]: value };
      return { ...current, certifications };
    });
  };

  const updateHonor = <K extends keyof ResumeDraft["honors"][number]>(
    index: number,
    field: K,
    value: ResumeDraft["honors"][number][K],
  ) => {
    setDraft((current) => {
      const honors = [...current.honors];
      const target = honors[index];
      if (!target) return current;
      honors[index] = { ...target, [field]: value };
      return { ...current, honors };
    });
  };

  const updateVolunteer = <
    K extends keyof ResumeDraft["volunteering"][number],
  >(
    index: number,
    field: K,
    value: ResumeDraft["volunteering"][number][K],
  ) => {
    setDraft((current) => {
      const volunteering = [...current.volunteering];
      const target = volunteering[index];
      if (!target) return current;
      volunteering[index] = { ...target, [field]: value };
      return { ...current, volunteering };
    });
  };

  const updateService = <K extends keyof ResumeDraft["services"][number]>(
    index: number,
    field: K,
    value: ResumeDraft["services"][number][K],
  ) => {
    setDraft((current) => {
      const services = [...current.services];
      const target = services[index];
      if (!target) return current;
      services[index] = { ...target, [field]: value };
      return { ...current, services };
    });
  };

  const updateDynamicAnswer = (key: string, value: string) => {
    setDynamicAnswers((current) => ({ ...current, [key]: value }));
  };

  const handleExperienceSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const parsed = parseRoleInput(experienceSearch);
    if (!parsed) return;
    addExperienceItem(parsed);
    setExperienceSearch("");
    setShowExperienceAdd(false);
    setPendingExperienceFocus(true);
  };

  const handleAddBlankExperience = () => {
    addExperienceItem({});
    setExperienceSearch("");
    setShowExperienceAdd(false);
    setPendingExperienceFocus(true);
  };

  const openExperienceImport = () => {
    setExperienceSearch("");
    setShowExperienceAdd(true);
    window.setTimeout(() => {
      experienceAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankEducation = () => {
    addEducationItem({});
    setEducationSearch("");
    setShowEducationImport(false);
  };

  const openEducationImport = () => {
    setEducationSearch("");
    setShowEducationImport(true);
    window.setTimeout(() => {
      educationAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankProject = () => {
    addProjectItem({});
    setProjectSearch("");
    setShowProjectImport(false);
  };

  const openProjectImport = () => {
    setProjectSearch("");
    setShowProjectImport(true);
    window.setTimeout(() => {
      projectAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankLink = () => {
    addLinkItem({});
    setLinkSearch("");
    setShowLinkImport(false);
  };

  const openLinkImport = () => {
    setLinkSearch("");
    setShowLinkImport(true);
    window.setTimeout(() => {
      linkAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankCertification = () => {
    addCertificationItem({});
    setCertificationSearch("");
    setShowCertificationImport(false);
  };

  const openCertificationImport = () => {
    setCertificationSearch("");
    setShowCertificationImport(true);
    window.setTimeout(() => {
      certificationAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankHonor = () => {
    addHonorItem({});
    setHonorSearch("");
    setShowHonorImport(false);
  };

  const openHonorImport = () => {
    setHonorSearch("");
    setShowHonorImport(true);
    window.setTimeout(() => {
      honorAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankVolunteer = () => {
    addVolunteerItem({});
    setVolunteerSearch("");
    setShowVolunteerImport(false);
  };

  const openVolunteerImport = () => {
    setVolunteerSearch("");
    setShowVolunteerImport(true);
    window.setTimeout(() => {
      volunteerAddInputRef.current?.focus();
    }, 0);
  };

  const handleAddBlankService = () => {
    addServiceItem({});
    setServiceSearch("");
    setShowServiceImport(false);
  };

  const openServiceImport = () => {
    setServiceSearch("");
    setShowServiceImport(true);
    window.setTimeout(() => {
      serviceAddInputRef.current?.focus();
    }, 0);
  };

  const handleNavSelect = (item: NavItem) => {
    setCurrentStep(item.stepIndex);
    if (item.kind === "experience" && item.refId) {
      setActiveExperienceId(item.refId);
    }
    if (item.kind === "education" && item.refId) {
      setActiveEducationId(item.refId);
    }
    if (item.kind === "project" && item.refId) {
      setActiveProjectId(item.refId);
    }
    if (item.kind === "link" && item.refId) {
      setActiveLinkId(item.refId);
    }
    if (item.kind === "certification" && item.refId) {
      setActiveCertificationId(item.refId);
    }
    if (item.kind === "honor" && item.refId) {
      setActiveHonorId(item.refId);
    }
    if (item.kind === "volunteer" && item.refId) {
      setActiveVolunteerId(item.refId);
    }
    if (item.kind === "service" && item.refId) {
      setActiveServiceId(item.refId);
    }
    setShowExperienceAdd(false);
    setExperienceSearch("");
    setShowEducationImport(false);
    setEducationSearch("");
    setShowProjectImport(false);
    setProjectSearch("");
    setShowLinkImport(false);
    setLinkSearch("");
    setShowCertificationImport(false);
    setCertificationSearch("");
    setShowHonorImport(false);
    setHonorSearch("");
    setShowVolunteerImport(false);
    setVolunteerSearch("");
    setShowServiceImport(false);
    setServiceSearch("");
    setNavQuery("");
  };

  const handleEducationSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = educationSearch.trim();
    if (!trimmed) return;
    addEducationItem({ school: trimmed });
    setEducationSearch("");
    setShowEducationImport(false);
  };

  const handleProjectSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = projectSearch.trim();
    if (!trimmed) return;
    addProjectItem({ name: trimmed });
    setProjectSearch("");
    setShowProjectImport(false);
  };

  const handleLinkSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = linkSearch.trim();
    if (!trimmed) return;
    addLinkItem({ label: "Link", url: trimmed });
    setLinkSearch("");
    setShowLinkImport(false);
  };

  const handleCertificationSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = certificationSearch.trim();
    if (!trimmed) return;
    addCertificationItem({ name: trimmed });
    setCertificationSearch("");
    setShowCertificationImport(false);
  };

  const handleHonorSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = honorSearch.trim();
    if (!trimmed) return;
    addHonorItem({ title: trimmed });
    setHonorSearch("");
    setShowHonorImport(false);
  };

  const handleVolunteerSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = volunteerSearch.trim();
    if (!trimmed) return;
    addVolunteerItem({ role: trimmed });
    setVolunteerSearch("");
    setShowVolunteerImport(false);
  };

  const handleServiceSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = serviceSearch.trim();
    if (!trimmed) return;
    addServiceItem({ name: trimmed });
    setServiceSearch("");
    setShowServiceImport(false);
  };

  const addExperienceItem = (
    value: Partial<ResumeDraft["experiences"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const experiences = [...current.experiences];
      const blankIndex = experiences.findIndex((item) =>
        isExperienceEmpty(item),
      );
      if (blankIndex >= 0) {
        nextId = experiences[blankIndex]?.id ?? fallbackId;
        experiences[blankIndex] = {
          ...createBlankExperience(),
          ...value,
          id: nextId,
        };
      } else {
        experiences.push({
          ...createBlankExperience(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, experiences };
    });
    setActiveExperienceId(nextId);
  };

  const addEducationItem = (
    value: Partial<ResumeDraft["education"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const education = [...current.education];
      const blankIndex = education.findIndex((item) => isEducationEmpty(item));
      if (blankIndex >= 0) {
        nextId = education[blankIndex]?.id ?? fallbackId;
        education[blankIndex] = {
          ...createBlankEducation(),
          ...value,
          id: nextId,
        };
      } else {
        education.push({
          ...createBlankEducation(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, education };
    });
    setActiveEducationId(nextId);
  };

  const addProjectItem = (
    value: Partial<ResumeDraft["projects"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const projects = [...current.projects];
      const blankIndex = projects.findIndex((item) => isProjectEmpty(item));
      if (blankIndex >= 0) {
        nextId = projects[blankIndex]?.id ?? fallbackId;
        projects[blankIndex] = {
          ...createBlankProject(),
          ...value,
          id: nextId,
        };
      } else {
        projects.push({
          ...createBlankProject(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, projects };
    });
    setActiveProjectId(nextId);
  };

  const addLinkItem = (
    value: Partial<ResumeDraft["links"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const links = [...current.links];
      const blankIndex = links.findIndex((item) => isLinkEmpty(item));
      if (blankIndex >= 0) {
        nextId = links[blankIndex]?.id ?? fallbackId;
        links[blankIndex] = {
          ...createBlankLink(),
          ...value,
          id: nextId,
        };
      } else {
        links.push({
          ...createBlankLink(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, links };
    });
    setActiveLinkId(nextId);
  };

  const addCertificationItem = (
    value: Partial<ResumeDraft["certifications"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const certifications = [...current.certifications];
      const blankIndex = certifications.findIndex((item) =>
        isCertificationEmpty(item),
      );
      if (blankIndex >= 0) {
        nextId = certifications[blankIndex]?.id ?? fallbackId;
        certifications[blankIndex] = {
          ...createBlankCertification(),
          ...value,
          id: nextId,
        };
      } else {
        certifications.push({
          ...createBlankCertification(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, certifications };
    });
    setActiveCertificationId(nextId);
  };

  const addHonorItem = (
    value: Partial<ResumeDraft["honors"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const honors = [...current.honors];
      const blankIndex = honors.findIndex((item) => isHonorEmpty(item));
      if (blankIndex >= 0) {
        nextId = honors[blankIndex]?.id ?? fallbackId;
        honors[blankIndex] = {
          ...createBlankHonor(),
          ...value,
          id: nextId,
        };
      } else {
        honors.push({
          ...createBlankHonor(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, honors };
    });
    setActiveHonorId(nextId);
  };

  const addVolunteerItem = (
    value: Partial<ResumeDraft["volunteering"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const volunteering = [...current.volunteering];
      const blankIndex = volunteering.findIndex((item) =>
        isVolunteerEmpty(item),
      );
      if (blankIndex >= 0) {
        nextId = volunteering[blankIndex]?.id ?? fallbackId;
        volunteering[blankIndex] = {
          ...createBlankVolunteer(),
          ...value,
          id: nextId,
        };
      } else {
        volunteering.push({
          ...createBlankVolunteer(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, volunteering };
    });
    setActiveVolunteerId(nextId);
  };

  const addServiceItem = (
    value: Partial<ResumeDraft["services"][number]> & { id?: string },
  ) => {
    const fallbackId = value.id ?? createItemId();
    let nextId = fallbackId;
    setDraft((current) => {
      const services = [...current.services];
      const blankIndex = services.findIndex((item) => isServiceEmpty(item));
      if (blankIndex >= 0) {
        nextId = services[blankIndex]?.id ?? fallbackId;
        services[blankIndex] = {
          ...createBlankService(),
          ...value,
          id: nextId,
        };
      } else {
        services.push({
          ...createBlankService(),
          ...value,
          id: nextId,
        });
      }
      return { ...current, services };
    });
    setActiveServiceId(nextId);
  };

  const removeExperience = (id: string) => {
    setDraft((current) => {
      const experiences = current.experiences.filter((item) => item.id !== id);
      if (experiences.length === 0) {
        const next = createBlankExperience();
        setActiveExperienceId(next.id);
        return { ...current, experiences: [next] };
      }
      return { ...current, experiences };
    });
  };

  const removeEducation = (id: string) => {
    setDraft((current) => {
      const education = current.education.filter((item) => item.id !== id);
      if (education.length === 0) {
        const next = createBlankEducation();
        setActiveEducationId(next.id);
        return { ...current, education: [next] };
      }
      return { ...current, education };
    });
  };

  const removeProject = (id: string) => {
    setDraft((current) => {
      const projects = current.projects.filter((item) => item.id !== id);
      if (projects.length === 0) {
        const next = createBlankProject();
        setActiveProjectId(next.id);
        return { ...current, projects: [next] };
      }
      return { ...current, projects };
    });
  };

  const removeLink = (id: string) => {
    setDraft((current) => {
      const links = current.links.filter((item) => item.id !== id);
      if (links.length === 0) {
        const next = createBlankLink();
        setActiveLinkId(next.id);
        return { ...current, links: [next] };
      }
      return { ...current, links };
    });
  };

  const removeCertification = (id: string) => {
    setDraft((current) => {
      const certifications = current.certifications.filter(
        (item) => item.id !== id,
      );
      if (certifications.length === 0) {
        const next = createBlankCertification();
        setActiveCertificationId(next.id);
        return { ...current, certifications: [next] };
      }
      return { ...current, certifications };
    });
  };

  const removeHonor = (id: string) => {
    setDraft((current) => {
      const honors = current.honors.filter((item) => item.id !== id);
      if (honors.length === 0) {
        const next = createBlankHonor();
        setActiveHonorId(next.id);
        return { ...current, honors: [next] };
      }
      return { ...current, honors };
    });
  };

  const removeVolunteer = (id: string) => {
    setDraft((current) => {
      const volunteering = current.volunteering.filter(
        (item) => item.id !== id,
      );
      if (volunteering.length === 0) {
        const next = createBlankVolunteer();
        setActiveVolunteerId(next.id);
        return { ...current, volunteering: [next] };
      }
      return { ...current, volunteering };
    });
  };

  const removeService = (id: string) => {
    setDraft((current) => {
      const services = current.services.filter((item) => item.id !== id);
      if (services.length === 0) {
        const next = createBlankService();
        setActiveServiceId(next.id);
        return { ...current, services: [next] };
      }
      return { ...current, services };
    });
  };

  const handleNext = async (overrideDraft?: ResumeDraft) => {
    if (dynamicLoading) return;
    if (steps.length === 0) {
      setSteps(baseSteps);
      setCurrentStep(0);
      return;
    }
    if (currentStep >= steps.length) {
      setCurrentStep(steps.length - 1);
      return;
    }

    const current = steps[currentStep];
    if (!current) return;
    const workingDraft = normalizeDraft(
      overrideDraft ?? draft ?? createEmptyDraft(),
    );
    if (current.kind === "skills" && !skillFollowupsAdded) {
      const selected = (workingDraft.skills ?? []).map(normalizeSkill);
      const missing: string[] = [];
      for (const skill of scraped?.skills ?? []) {
        const normalized = normalizeSkill(skill);
        if (!normalized || selected.includes(normalized)) continue;
        if (!missing.some((item) => normalizeSkill(item) === normalized)) {
          missing.push(skill.trim());
        }
      }

      if (missing.length > 0) {
        const followups: Step[] = missing.slice(0, 6).map((skill) => ({
          id: `confirm-skill-${normalizeSkill(skill)}`,
          kind: "confirm-skill",
          label: `Keep "${skill}"?`,
          skill,
        }));
        const insertAt = currentStep + 1;
        const nextSteps = [
          ...steps.slice(0, insertAt),
          ...followups,
          ...steps.slice(insertAt),
        ];
        setSteps(nextSteps);
        setSkillFollowupsAdded(true);
        setCurrentStep(insertAt);
        return;
      }
      setSkillFollowupsAdded(true);
    }

    if (current.kind === "links" && !dynamicStepsAdded) {
      const followups = await requestSmartQuestions(workingDraft);
      setDynamicStepsAdded(true);

      if (followups.length > 0) {
        const reviewIndex = steps.findIndex((step) => step.kind === "review");
        const insertAt = reviewIndex === -1 ? steps.length : reviewIndex;
        const nextSteps = [
          ...steps.slice(0, insertAt),
          ...followups,
          ...steps.slice(insertAt),
        ];
        setSteps(nextSteps);
        setDynamicAnswers((currentAnswers) => {
          const nextAnswers = { ...currentAnswers };
          for (const question of followups) {
            if (question.prefill && !nextAnswers[question.key]) {
              nextAnswers[question.key] = question.prefill;
            }
          }
          return nextAnswers;
        });
        setCurrentStep(insertAt);
        return;
      }
    }

    if (currentStep >= steps.length - 1) {
      scrollToSection("website-upsell");
      return;
    }

    setCurrentStep((prev) => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep((prev) => prev - 1);
  };

  const handleConfirmSkill = (skill: string, include: boolean) => {
    if (include) {
      setDraft((current) => {
        const next = {
          ...current,
          skills: mergeSkills(current.skills, [skill]),
        };
        void handleNext(next);
        return next;
      });
      return;
    }
    void handleNext();
  };

  const handleArrayDone = () => {
    const cleaned = cleanDraft(draft);
    setDraft(cleaned);
    void handleNext(cleaned);
  };

  const safeStepIndex =
    steps.length > 0 ? Math.min(currentStep, steps.length - 1) : 0;
  const fallbackStep: Step = { id: "fallback", kind: "review", label: "Review" };
  const current = steps[safeStepIndex] ?? baseSteps[0] ?? fallbackStep;
  const isArrayStep =
    current.kind === "experience" ||
    current.kind === "education" ||
    current.kind === "projects" ||
    current.kind === "links" ||
    current.kind === "certifications" ||
    current.kind === "honors" ||
    current.kind === "volunteering" ||
    current.kind === "services";
  const isStepFilled = (step: Step) => {
    const hasValue = (value?: string) => Boolean((value ?? "").trim());
    switch (step.kind) {
      case "text":
      case "email":
      case "tel":
      case "textarea":
        return hasValue(draft.profile[step.field]);
      case "skills":
        return draft.skills.length > 0;
      case "experience":
        return draft.experiences.some((item) => !isExperienceEmpty(item));
      case "education":
        return draft.education.some((item) => !isEducationEmpty(item));
      case "projects":
        return draft.projects.some((item) => !isProjectEmpty(item));
      case "certifications":
        return draft.certifications.some((item) => !isCertificationEmpty(item));
      case "honors":
        return draft.honors.some((item) => !isHonorEmpty(item));
      case "volunteering":
        return draft.volunteering.some((item) => !isVolunteerEmpty(item));
      case "services":
        return draft.services.some((item) => !isServiceEmpty(item));
      case "links":
        return draft.links.some((item) => !isLinkEmpty(item));
      case "dynamic":
        return hasValue(dynamicAnswers[step.key]);
      case "confirm-skill":
        return draft.skills.some(
          (skill) => normalizeSkill(skill) === normalizeSkill(step.skill),
        );
      case "headshot":
        return hasValue(draft.profile.headshotUrl);
      case "review":
        return true;
      default:
        return false;
    }
  };
  const hasDraftData = Boolean(
    (draft.profile.fullName ?? "").trim() ||
    (draft.profile.headline ?? "").trim() ||
    (draft.profile.targetRole ?? "").trim() ||
    (draft.profile.jobField ?? "").trim() ||
    (draft.profile.jobType ?? "").trim() ||
    (draft.profile.email ?? "").trim() ||
    (draft.profile.location ?? "").trim() ||
    (draft.profile.summary ?? "").trim() ||
    (draft.profile.headshotUrl ?? "").trim() ||
    draft.skills.length > 0 ||
    draft.experiences.some((item) => !isExperienceEmpty(item)) ||
    draft.education.some((item) => !isEducationEmpty(item)) ||
    draft.projects.some((item) => !isProjectEmpty(item)) ||
    draft.certifications.some((item) => !isCertificationEmpty(item)) ||
    draft.honors.some((item) => !isHonorEmpty(item)) ||
    draft.volunteering.some((item) => !isVolunteerEmpty(item)) ||
    draft.services.some((item) => !isServiceEmpty(item)) ||
    draft.links.some((item) => !isLinkEmpty(item)),
  );
  const hasProgress =
    hasStarted ||
    Boolean(scraped) ||
    Boolean(scrapeJobId) ||
    currentStep > 0 ||
    skillFollowupsAdded ||
    dynamicStepsAdded ||
    hasDraftData;
  const reviewLine = [
    draft.profile.headline ?? draft.profile.targetRole ?? "Your headline",
    draft.profile.jobField ?? "Target field",
    draft.profile.jobType ?? "Job type",
    draft.profile.location ?? "Location",
  ].join(" | ");
  const nextLabel = dynamicLoading
    ? "Generating..."
    : currentStep === steps.length - 1
      ? "See website packages"
      : "Continue";
  const selectedPackageLabel =
    selectedPackage === "launch"
      ? "Launch"
      : selectedPackage === "signal"
        ? "Signal"
        : selectedPackage === "studio"
          ? "Studio"
          : null;
  const scrapedHeadshot = scraped?.profile?.headshotUrl ?? "";
  const activeExperienceIndex = draft.experiences.findIndex(
    (item) => item.id === activeExperienceId,
  );
  const activeExperience =
    activeExperienceIndex >= 0 ? draft.experiences[activeExperienceIndex] : null;
  const experienceCount = draft.experiences.filter(
    (item) => !isExperienceEmpty(item),
  ).length;
  const activeExperienceNarrative = activeExperience
    ? buildExperienceNarrative(
      activeExperience.summary ?? "",
      activeExperience.highlights ?? [],
    )
    : "";
  const activeEducationIndex = draft.education.findIndex(
    (item) => item.id === activeEducationId,
  );
  const activeEducation =
    activeEducationIndex >= 0 ? draft.education[activeEducationIndex] : null;
  const educationCount = draft.education.filter(
    (item) => !isEducationEmpty(item),
  ).length;
  const activeProjectIndex = draft.projects.findIndex(
    (item) => item.id === activeProjectId,
  );
  const activeProject =
    activeProjectIndex >= 0 ? draft.projects[activeProjectIndex] : null;
  const projectCount = draft.projects.filter((item) => !isProjectEmpty(item))
    .length;
  const activeLinkIndex = draft.links.findIndex(
    (item) => item.id === activeLinkId,
  );
  const activeLink = activeLinkIndex >= 0 ? draft.links[activeLinkIndex] : null;
  const linkCount = draft.links.filter((item) => !isLinkEmpty(item)).length;
  const activeCertificationIndex = draft.certifications.findIndex(
    (item) => item.id === activeCertificationId,
  );
  const activeCertification =
    activeCertificationIndex >= 0
      ? draft.certifications[activeCertificationIndex]
      : null;
  const certificationCount = draft.certifications.filter(
    (item) => !isCertificationEmpty(item),
  ).length;
  const activeHonorIndex = draft.honors.findIndex(
    (item) => item.id === activeHonorId,
  );
  const activeHonor =
    activeHonorIndex >= 0 ? draft.honors[activeHonorIndex] : null;
  const honorCount = draft.honors.filter((item) => !isHonorEmpty(item)).length;
  const activeVolunteerIndex = draft.volunteering.findIndex(
    (item) => item.id === activeVolunteerId,
  );
  const activeVolunteer =
    activeVolunteerIndex >= 0
      ? draft.volunteering[activeVolunteerIndex]
      : null;
  const volunteerCount = draft.volunteering.filter(
    (item) => !isVolunteerEmpty(item),
  ).length;
  const activeServiceIndex = draft.services.findIndex(
    (item) => item.id === activeServiceId,
  );
  const activeService =
    activeServiceIndex >= 0 ? draft.services[activeServiceIndex] : null;
  const serviceCount = draft.services.filter((item) => !isServiceEmpty(item))
    .length;
  const experienceAiActive = experienceAiId
    ? draft.experiences.find((item) => item.id === experienceAiId) ?? null
    : null;
  const experienceAiOriginal =
    experienceAiId && scraped?.experiences
      ? scraped.experiences.find((item) => item.id === experienceAiId) ?? null
      : null;
  const experienceAiEntries = experienceAiId
    ? experienceAiHistory[experienceAiId] ?? []
    : [];
  const summaryAiEntries = summaryAiHistory;
  const summaryAiOriginal = scraped?.profile?.summary ?? "";
  const aiExperienceList = draft.experiences.filter(
    (item) => !isExperienceEmpty(item),
  );

  const consultantSnapshot = useMemo(() => {
    const cleaned = cleanDraft(draft);
    const profileItems: string[] = [];
    const profile = draft.profile;
    if (profile.fullName) profileItems.push(`Name: ${profile.fullName}`);
    if (profile.headline) profileItems.push(`Headline: ${profile.headline}`);
    if (profile.targetRole) profileItems.push(`Target role: ${profile.targetRole}`);
    if (profile.jobField) profileItems.push(`Target field: ${profile.jobField}`);
    if (profile.jobType) profileItems.push(`Job type: ${profile.jobType}`);
    if (profile.email) profileItems.push(`Email: ${profile.email}`);
    if (profile.phone) profileItems.push(`Phone: ${profile.phone}`);
    if (profile.location) profileItems.push(`Location: ${profile.location}`);
    if (profile.website) profileItems.push(`Website: ${profile.website}`);

    const summaryText = (profile.summary ?? "").trim();
    const summaryLines = summaryText
      ? summaryText.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      : [];

    const skillItems: string[] = [];
    const skillSet = new Set<string>();
    for (const skill of draft.skills) {
      const trimmed = skill.trim();
      const normalized = normalizeSkill(trimmed);
      if (!trimmed || skillSet.has(normalized)) continue;
      skillSet.add(normalized);
      skillItems.push(trimmed);
    }

    const experienceItems = cleaned.experiences.map((item) => {
      if (item.title && item.company) return `${item.title} · ${item.company}`;
      return item.title ?? item.company ?? "Untitled role";
    });

    const educationItems = cleaned.education.map((item) => {
      if (item.school && item.degree) return `${item.school} · ${item.degree}`;
      return item.school ?? item.degree ?? "Untitled education";
    });

    const projectItems = cleaned.projects.map((item) => {
      if (item.name && item.role) return `${item.name} · ${item.role}`;
      return item.name ?? item.role ?? "Untitled project";
    });

    const certificationItems = cleaned.certifications.map((item) => {
      if (item.name && item.issuer) return `${item.name} · ${item.issuer}`;
      return item.name ?? item.issuer ?? "Untitled certification";
    });

    const honorItems = cleaned.honors.map((item) => {
      if (item.title && item.issuer) return `${item.title} · ${item.issuer}`;
      return item.title ?? item.issuer ?? "Untitled honor";
    });

    const volunteerItems = cleaned.volunteering.map((item) => {
      if (item.role && item.organization) return `${item.role} · ${item.organization}`;
      return item.role ?? item.organization ?? "Untitled volunteer role";
    });

    const serviceItems = cleaned.services.map((item) => {
      return item.name || "Untitled service";
    });

    const linkItems = cleaned.links.map((item) => {
      return item.label || item.url;
    });

    return {
      profileItems,
      summaryText,
      summaryLines,
      skillItems,
      experienceItems,
      educationItems,
      projectItems,
      certificationItems,
      honorItems,
      volunteerItems,
      serviceItems,
      linkItems,
    };
  }, [draft]);

  const consultantPills = useMemo(
    () => [
      {
        id: "profile",
        label: "Profile",
        count: consultantSnapshot.profileItems.length,
        items: consultantSnapshot.profileItems,
      },
      {
        id: "summary",
        label: "Summary",
        count: consultantSnapshot.summaryText ? 1 : 0,
        items: consultantSnapshot.summaryLines,
      },
      {
        id: "experience",
        label: "Jobs",
        count: consultantSnapshot.experienceItems.length,
        items: consultantSnapshot.experienceItems,
      },
      {
        id: "skills",
        label: "Skills",
        count: consultantSnapshot.skillItems.length,
        items: consultantSnapshot.skillItems,
      },
      {
        id: "education",
        label: "Education",
        count: consultantSnapshot.educationItems.length,
        items: consultantSnapshot.educationItems,
      },
      {
        id: "projects",
        label: "Projects",
        count: consultantSnapshot.projectItems.length,
        items: consultantSnapshot.projectItems,
      },
      {
        id: "certifications",
        label: "Certifications",
        count: consultantSnapshot.certificationItems.length,
        items: consultantSnapshot.certificationItems,
      },
      {
        id: "honors",
        label: "Honors",
        count: consultantSnapshot.honorItems.length,
        items: consultantSnapshot.honorItems,
      },
      {
        id: "volunteering",
        label: "Volunteering",
        count: consultantSnapshot.volunteerItems.length,
        items: consultantSnapshot.volunteerItems,
      },
      {
        id: "services",
        label: "Services",
        count: consultantSnapshot.serviceItems.length,
        items: consultantSnapshot.serviceItems,
      },
      {
        id: "links",
        label: "Links",
        count: consultantSnapshot.linkItems.length,
        items: consultantSnapshot.linkItems,
      },
    ],
    [consultantSnapshot],
  );

  const activeConsultantPill = consultantPills.find(
    (pill) => pill.id === consultantActivePill,
  );

  const experienceSuggestions = useMemo(() => {
    const query = experienceSearch.trim().toLowerCase();
    if (!query || !scraped?.experiences?.length) return [];
    const existing = new Set(
      draft.experiences.map(
        (item) => `${item.title.toLowerCase()}::${item.company.toLowerCase()}`,
      ),
    );
    return scraped.experiences.filter((item) => {
      const title = item.title.toLowerCase();
      const company = item.company.toLowerCase();
      if (!title && !company) return false;
      if (existing.has(`${title}::${company}`)) return false;
      return title.includes(query) || company.includes(query);
    });
  }, [experienceSearch, scraped, draft.experiences]);

  const educationSuggestions = useMemo(() => {
    const query = educationSearch.trim().toLowerCase();
    if (!query || !scraped?.education?.length) return [];
    const existing = new Set(
      draft.education.map(
        (item) => `${item.school.toLowerCase()}::${item.degree?.toLowerCase()}`,
      ),
    );
    return scraped.education.filter((item) => {
      const school = item.school.toLowerCase();
      const degree = (item.degree ?? "").toLowerCase();
      if (!school && !degree) return false;
      if (existing.has(`${school}::${degree}`)) return false;
      return school.includes(query) || degree.includes(query);
    });
  }, [educationSearch, scraped, draft.education]);

  const projectSuggestions = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query || !scraped?.projects?.length) return [];
    const existing = new Set(
      draft.projects.map(
        (item) =>
          `${item.name.toLowerCase()}::${(item.role ?? "").toLowerCase()}`,
      ),
    );
    return scraped.projects.filter((item) => {
      const name = item.name.toLowerCase();
      const role = (item.role ?? "").toLowerCase();
      if (!name && !role) return false;
      if (existing.has(`${name}::${role}`)) return false;
      return name.includes(query) || role.includes(query);
    });
  }, [projectSearch, scraped, draft.projects]);

  const linkSuggestions = useMemo(() => {
    const query = linkSearch.trim().toLowerCase();
    if (!query || !scraped?.links?.length) return [];
    const existing = new Set(
      draft.links.map((item) => item.url.toLowerCase()),
    );
    return scraped.links.filter((item) => {
      const url = item.url.toLowerCase();
      const label = item.label.toLowerCase();
      if (!url && !label) return false;
      if (existing.has(url)) return false;
      return url.includes(query) || label.includes(query);
    });
  }, [linkSearch, scraped, draft.links]);

  const certificationSuggestions = useMemo(() => {
    const query = certificationSearch.trim().toLowerCase();
    if (!query || !scraped?.certifications?.length) return [];
    const existing = new Set(
      draft.certifications.map(
        (item) => `${item.name.toLowerCase()}::${(item.issuer ?? "").toLowerCase()}`,
      ),
    );
    return scraped.certifications.filter((item) => {
      const name = item.name.toLowerCase();
      const issuer = (item.issuer ?? "").toLowerCase();
      if (!name && !issuer) return false;
      if (existing.has(`${name}::${issuer}`)) return false;
      return name.includes(query) || issuer.includes(query);
    });
  }, [certificationSearch, scraped, draft.certifications]);

  const honorSuggestions = useMemo(() => {
    const query = honorSearch.trim().toLowerCase();
    if (!query || !scraped?.honors?.length) return [];
    const existing = new Set(
      draft.honors.map(
        (item) => `${item.title.toLowerCase()}::${(item.issuer ?? "").toLowerCase()}`,
      ),
    );
    return scraped.honors.filter((item) => {
      const title = item.title.toLowerCase();
      const issuer = (item.issuer ?? "").toLowerCase();
      if (!title && !issuer) return false;
      if (existing.has(`${title}::${issuer}`)) return false;
      return title.includes(query) || issuer.includes(query);
    });
  }, [honorSearch, scraped, draft.honors]);

  const volunteerSuggestions = useMemo(() => {
    const query = volunteerSearch.trim().toLowerCase();
    if (!query || !scraped?.volunteering?.length) return [];
    const existing = new Set(
      draft.volunteering.map(
        (item) => `${item.role.toLowerCase()}::${(item.organization ?? "").toLowerCase()}`,
      ),
    );
    return scraped.volunteering.filter((item) => {
      const role = item.role.toLowerCase();
      const organization = (item.organization ?? "").toLowerCase();
      if (!role && !organization) return false;
      if (existing.has(`${role}::${organization}`)) return false;
      return role.includes(query) || organization.includes(query);
    });
  }, [volunteerSearch, scraped, draft.volunteering]);

  const serviceSuggestions = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase();
    if (!query || !scraped?.services?.length) return [];
    const existing = new Set(
      draft.services.map((item) => item.name.toLowerCase()),
    );
    return scraped.services.filter((item) => {
      const name = item.name.toLowerCase();
      if (!name) return false;
      if (existing.has(name)) return false;
      return name.includes(query);
    });
  }, [serviceSearch, scraped, draft.services]);

  const stepStates = useMemo(
    () =>
      steps.map((step, index) => {
        const filled = isStepFilled(step);
        const status =
          index === currentStep
            ? "active"
            : index < currentStep
              ? "done"
              : filled
                ? "ready"
                : "upcoming";
        return { step, index, status };
      }),
    [steps, currentStep, draft, dynamicAnswers, isStepFilled],
  );

  const navItems = useMemo(() => {
    const items: NavItem[] = [];
    const stepIndexByKind = (kind: Step["kind"]) => {
      const index = steps.findIndex((step) => step.kind === kind);
      return index === -1 ? currentStep : index;
    };

    steps.forEach((step, index) => {
      let label = step.label;
      let meta = "Section";
      let searchText = `${step.label} ${step.kind}`;
      if (step.kind === "confirm-skill") {
        label = `Skill: ${step.skill}`;
        meta = "Skill check";
        searchText = `${label} ${step.skill} ${step.kind}`;
      }
      if (step.kind === "dynamic") {
        meta = "Custom question";
        searchText = `${step.label} ${step.key} ${step.prefill ?? ""}`;
      }
      items.push({
        id: `step-${step.id}-${index}`,
        label,
        meta,
        stepIndex: index,
        kind: "step",
        searchText: searchText.toLowerCase(),
      });
    });

    const experienceStepIndex = stepIndexByKind("experience");
    const educationStepIndex = stepIndexByKind("education");
    const projectsStepIndex = stepIndexByKind("projects");
    const skillsStepIndex = stepIndexByKind("skills");
    const linksStepIndex = stepIndexByKind("links");
    const certificationsStepIndex = stepIndexByKind("certifications");
    const honorsStepIndex = stepIndexByKind("honors");
    const volunteeringStepIndex = stepIndexByKind("volunteering");
    const servicesStepIndex = stepIndexByKind("services");

    draft.experiences
      .filter((item) => !isExperienceEmpty(item))
      .forEach((item) => {
        const label =
          item.title && item.company
            ? `${item.title} · ${item.company}`
            : item.title || item.company || "Experience";
        const searchText = [
          label,
          item.location ?? "",
          item.summary ?? "",
          ...(item.highlights ?? []),
        ]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `exp-${item.id}`,
          label,
          meta: "Experience",
          stepIndex: experienceStepIndex,
          kind: "experience",
          refId: item.id,
          searchText,
        });
      });

    draft.education
      .filter((item) => !isEducationEmpty(item))
      .forEach((item) => {
        const label = [item.school, item.degree]
          .filter(Boolean)
          .join(" · ");
        const searchText = [
          label,
          item.field ?? "",
          item.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `edu-${item.id}`,
          label: label || "Education",
          meta: "Education",
          stepIndex: educationStepIndex,
          kind: "education",
          refId: item.id,
          searchText,
        });
      });

    draft.projects
      .filter((item) => !isProjectEmpty(item))
      .forEach((item) => {
        const label = item.name || "Project";
        const searchText = [
          label,
          item.role ?? "",
          item.description ?? "",
          item.url ?? "",
        ]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `project-${item.id}`,
          label,
          meta: "Project",
          stepIndex: projectsStepIndex,
          kind: "project",
          refId: item.id,
          searchText,
        });
      });

    draft.certifications
      .filter((item) => !isCertificationEmpty(item))
      .forEach((item) => {
        const label = item.name || "Certification";
        const searchText = [
          label,
          item.issuer ?? "",
          item.credentialId ?? "",
          item.credentialUrl ?? "",
        ]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `cert-${item.id}`,
          label,
          meta: "Certification",
          stepIndex: certificationsStepIndex,
          kind: "certification",
          refId: item.id,
          searchText,
        });
      });

    draft.honors
      .filter((item) => !isHonorEmpty(item))
      .forEach((item) => {
        const label = item.title || "Honor";
        const searchText = [
          label,
          item.issuer ?? "",
          item.description ?? "",
        ]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `honor-${item.id}`,
          label,
          meta: "Honor",
          stepIndex: honorsStepIndex,
          kind: "honor",
          refId: item.id,
          searchText,
        });
      });

    draft.volunteering
      .filter((item) => !isVolunteerEmpty(item))
      .forEach((item) => {
        const label =
          item.role && item.organization
            ? `${item.role} · ${item.organization}`
            : item.role ?? item.organization ?? "Volunteering";
        const searchText = [
          label,
          item.cause ?? "",
          item.summary ?? "",
        ]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `vol-${item.id}`,
          label,
          meta: "Volunteering",
          stepIndex: volunteeringStepIndex,
          kind: "volunteer",
          refId: item.id,
          searchText,
        });
      });

    draft.services
      .filter((item) => !isServiceEmpty(item))
      .forEach((item) => {
        const label = item.name || "Service";
        const searchText = [label, item.description ?? ""]
          .join(" ")
          .toLowerCase();
        items.push({
          id: `service-${item.id}`,
          label,
          meta: "Service",
          stepIndex: servicesStepIndex,
          kind: "service",
          refId: item.id,
          searchText,
        });
      });

    draft.skills.forEach((skill, index) => {
      const label = skill.trim();
      if (!label) return;
      items.push({
        id: `skill-${index}-${label}`,
        label,
        meta: "Skill",
        stepIndex: skillsStepIndex,
        kind: "skill",
        searchText: label.toLowerCase(),
      });
    });

    draft.links
      .filter((item) => !isLinkEmpty(item))
      .forEach((item) => {
        const label = item.label || item.url;
        const searchText = [label, item.url].filter(Boolean).join(" ");
        items.push({
          id: `link-${item.id}`,
          label,
          meta: "Link",
          stepIndex: linksStepIndex,
          kind: "link",
          refId: item.id,
          searchText: searchText.toLowerCase(),
        });
      });

    return items;
  }, [steps, draft, currentStep]);

  const navMatches = useMemo(() => {
    const query = navQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    return navItems
      .filter((item) => item.searchText.includes(query))
      .slice(0, 6);
  }, [navItems, navQuery]);

  const completedSteps = stepStates.filter(
    (state) => state.status === "done" || state.status === "ready",
  ).length;

  const scrapeLabel =
    scrapeState === "queued"
      ? "Queued..."
      : scrapeState === "running"
        ? "Scraping..."
        : "Import LinkedIn";

  const consultantBody = (showContinue: boolean) => (
    <div className="mt-6 grid gap-6 lg:grid-cols-[0.42fr_0.58fr]">
      <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          <span>Snapshot</span>
          <span>{consultantPills.length} areas</span>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Counts reflect imported data plus edits so far.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {consultantPills.map((pill) => {
            const isActive = pill.id === consultantActivePill;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() =>
                  setConsultantActivePill(isActive ? null : pill.id)
                }
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${isActive
                  ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--text)]"
                  : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]"
                  }`}
              >
                <span>{pill.label}</span>
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>
        {activeConsultantPill && (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                {activeConsultantPill.label}
              </p>
              <button
                type="button"
                onClick={() => setConsultantActivePill(null)}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
              >
                Close
              </button>
            </div>
            <div className="mt-2 max-h-40 overflow-auto pr-1 text-xs text-[var(--text)]">
              {activeConsultantPill.id === "summary" ? (
                consultantSnapshot.summaryText ? (
                  <div className="space-y-2">
                    {renderSummaryBlocks(consultantSnapshot.summaryText, {
                      paragraphClassName: "text-xs whitespace-pre-line",
                      listClassName: "list-disc space-y-1 pl-4",
                      itemClassName: "text-xs",
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    No summary yet.
                  </p>
                )
              ) : activeConsultantPill.items.length > 0 ? (
                <ul className="space-y-1">
                  {activeConsultantPill.items.map((item, index) => (
                    <li key={`${activeConsultantPill.id}-${index}`}>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  Nothing yet. Tell the consultant what to add.
                </p>
              )}
            </div>
          </div>
        )}
      </aside>

      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Consultant chat
            </p>
            <span className="text-[11px] text-[var(--muted)]">
              {consultantMessages.length} messages
            </span>
          </div>
          <div className="mt-3 max-h-[280px] space-y-3 overflow-auto pr-1">
            {consultantMessages.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Tell the consultant what is missing or what to emphasize. You
                can mention multiple roles, projects, or wins in one message.
              </p>
            ) : (
              consultantMessages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-2xl border border-[var(--border)] p-3 ${message.role === "user"
                    ? "bg-[var(--surface)]"
                    : "bg-[var(--surface-muted)]"
                    }`}
                >
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span>{message.role === "user" ? "You" : "Consultant"}</span>
                    <span>
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                    {renderSummaryBlocks(message.content, {
                      paragraphClassName: "text-sm whitespace-pre-line",
                      listClassName: "list-disc space-y-1 pl-4",
                      itemClassName: "text-sm",
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
            Add details
          </p>
          <textarea
            value={consultantInput}
            onChange={(event) => setConsultantInput(event.target.value)}
            placeholder="Share missing roles, projects, certifications, dates, or what you want highlighted."
            className="input-base mt-2 w-full min-h-[120px] resize-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleConsultantSend}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                consultantState === "loading" ||
                !consultantInput.trim() ||
                !edenEnabled
              }
            >
              {consultantState === "loading" ? "Working..." : "Send to consultant"}
            </button>
            {consultantError && (
              <span className="text-xs text-red-500">{consultantError}</span>
            )}
            {!edenEnabled && (
              <span className="text-xs text-[var(--muted)]">
                Connect Eden AI to enable consultant updates.
              </span>
            )}
          </div>
        </div>

        {showContinue && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              You can reopen the consultant anytime in the sidebar.
            </p>
            <button
              type="button"
              onClick={() => setConsultantComplete(true)}
              className="btn-primary"
            >
              Continue to questions
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      <div className="bg-canvas" aria-hidden="true" />
      <div className="bg-flow" aria-hidden="true" />

      <header className="relative z-10 border-b border-[var(--border)]/70">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 3h9l3 3v15H6V3zm9 1.5V7h2.5L15 4.5z" />
                <path d="M8 11h8v1.6H8V11zm0 3.6h8v1.6H8v-1.6z" />
              </svg>
            </div>
            <div className="leading-tight">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Resume Foundry
              </p>
              <p className="text-sm font-semibold text-[var(--text)]">
                Consultative resume builder
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {hasProgress && (
              <button
                type="button"
                onClick={handleStartOver}
                className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              >
                Start over
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto w-full max-w-6xl px-6 pb-10 pt-12">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-[var(--muted)]">
                Free resume build
              </span>
              <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">
                Build a resume that reads like a story.
              </h1>
              <p className="max-w-xl text-base text-[var(--muted)] md:text-lg">
                Answer a few prompts. We craft the structure and polish the
                language.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <a href="#start" className="btn-primary">
                  Start
                </a>
                <button type="button" className="btn-secondary">
                  Preview
                </button>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Next: optional resume website + hosting when you are ready.
              </p>
            </div>
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 card-shadow">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-2 w-32 rounded-full bg-[var(--accent-soft)]" />
                  <div className="h-2 w-40 rounded-full bg-[var(--surface-muted)]" />
                </div>
                <div className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--surface-muted)]" />
              </div>
              <div className="mt-6 space-y-3">
                <div className="h-2 w-full rounded-full bg-[var(--surface-muted)]" />
                <div className="h-2 w-5/6 rounded-full bg-[var(--surface-muted)]" />
                <div className="h-2 w-4/6 rounded-full bg-[var(--surface-muted)]" />
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="h-2 w-24 rounded-full bg-[var(--accent-soft)]" />
                  <div className="h-2 w-full rounded-full bg-[var(--surface-muted)]" />
                  <div className="h-2 w-4/6 rounded-full bg-[var(--surface-muted)]" />
                </div>
                <div className="space-y-2">
                  <div className="h-2 w-20 rounded-full bg-[var(--accent-soft)]" />
                  <div className="h-2 w-full rounded-full bg-[var(--surface-muted)]" />
                  <div className="h-2 w-3/6 rounded-full bg-[var(--surface-muted)]" />
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-xs text-[var(--muted)]">
                Structured resume data with a clean, modern layout.
              </div>
            </div>
          </div>
        </section>

        {!hasStarted && (
          <section id="start" className="mx-auto w-full max-w-6xl px-6 pb-12">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      Step 1
                    </p>
                    <h2 className="font-display text-2xl font-semibold">
                      Import LinkedIn or your resume
                    </h2>
                    <p className="text-sm text-[var(--muted)]">
                      Optional. We will verify every field.
                    </p>
                  </div>

                  <div className="relative flex w-fit items-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] p-1 text-xs">
                    <span
                      className={`absolute inset-y-1 w-1/2 rounded-full bg-[var(--surface)] shadow-sm transition-transform duration-300 ${importMode === "linkedin"
                        ? "translate-x-0"
                        : "translate-x-full"
                        }`}
                    />
                    <button
                      type="button"
                      onClick={() => setImportMode("linkedin")}
                      className={`relative z-10 rounded-full px-4 py-1 transition-colors ${importMode === "linkedin"
                        ? "text-[var(--text)]"
                        : "text-[var(--muted)]"
                        }`}
                    >
                      LinkedIn
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode("resume")}
                      className={`relative z-10 rounded-full px-4 py-1 transition-colors ${importMode === "resume"
                        ? "text-[var(--text)]"
                        : "text-[var(--muted)]"
                        }`}
                    >
                      Resume
                    </button>
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <div
                    className={`flex w-[200%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${importMode === "linkedin"
                      ? "translate-x-0"
                      : "-translate-x-1/2"
                      }`}
                  >
                    <div className="w-1/2 pr-6">
                      <div className="space-y-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          LinkedIn URL
                        </p>
                        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                          <input
                            type="url"
                            value={linkedinUrl}
                            onChange={(event) =>
                              setLinkedinUrl(event.target.value)
                            }
                            placeholder="https://www.linkedin.com/in/your-handle"
                            className="input-base w-full"
                          />
                          <button
                            type="button"
                            onClick={handleScrape}
                            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              scrapeState === "queued" ||
                              scrapeState === "running"
                            }
                          >
                            {scrapeLabel}
                          </button>
                          <button
                            type="button"
                            onClick={handleSkipLinkedIn}
                            className="btn-secondary"
                          >
                            Skip
                          </button>
                        </div>

                        {scrapeState === "error" && (
                          <p className="text-sm text-red-500">{scrapeError}</p>
                        )}
                        {scrapeState === "queued" && (
                          <p className="text-xs text-[var(--muted)]">
                            In queue
                            {scrapeQueuePosition ? ` · #${scrapeQueuePosition}` : ""}
                          </p>
                        )}
                        {scrapeState === "running" && (
                          <p className="text-xs text-[var(--muted)]">
                            Scraping your profile...
                          </p>
                        )}

                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              setShowPasteLinkedIn((prev) => !prev)
                            }
                            className="btn-ghost"
                          >
                            {showPasteLinkedIn
                              ? "Hide paste option"
                              : "Paste profile text instead"}
                          </button>
                        </div>

                        {showPasteLinkedIn && (
                          <div className="space-y-3">
                            <textarea
                              value={linkedinText}
                              onChange={(event) => {
                                setLinkedinText(event.target.value);
                                if (pasteState === "error") {
                                  setPasteState("idle");
                                  setPasteError("");
                                }
                              }}
                              placeholder="Paste LinkedIn profile text here"
                              className="input-base w-full min-h-[120px] resize-none"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={handlePasteImport}
                                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={pasteState === "loading"}
                              >
                                {pasteState === "loading"
                                  ? "Parsing..."
                                  : "Import text"}
                              </button>
                              {pasteState === "error" && (
                                <span className="text-xs text-red-500">
                                  {pasteError}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="w-1/2 pl-6">
                      <div className="space-y-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          Resume file
                        </p>
                        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                          <input
                            type="file"
                            accept=".pdf,.docx,.odt,.txt,.md,image/*"
                            onChange={(event) => {
                              setUploadFile(event.target.files?.[0] ?? null);
                              if (uploadState === "error") {
                                setUploadState("idle");
                                setUploadError("");
                              }
                            }}
                            className="input-base w-full"
                          />
                          <button
                            type="button"
                            onClick={handleFileImport}
                            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={uploadState === "loading"}
                          >
                            {uploadState === "loading"
                              ? "Parsing..."
                              : "Import resume"}
                          </button>
                          <button
                            type="button"
                            onClick={handleSkipLinkedIn}
                            className="btn-secondary"
                          >
                            Skip
                          </button>
                        </div>
                        <p className="text-xs text-[var(--muted)]">
                          PDF, DOCX, ODT, TXT, MD, or images. We prefill from it.
                        </p>
                        {uploadState === "error" && (
                          <span className="text-xs text-red-500">
                            {uploadError}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {hasStarted && !consultantComplete && (
          <section id="consultant" className="mx-auto w-full max-w-6xl px-6 pb-12">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                    Step 2
                  </p>
                  <h2 className="font-display text-2xl font-semibold">
                    Talk to your resume consultant
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    Tell us what is missing. We will update your resume draft instantly.
                  </p>
                </div>
              </div>
              {consultantBody(true)}
            </div>
          </section>
        )}

        {hasStarted && consultantComplete && (
          <section id="questions" className="mx-auto w-full max-w-6xl px-6 pb-24">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                <span>Resume intake</span>
                <span>
                  Step {currentStep + 1} of {steps.length}
                </span>
              </div>
              <div className="mt-4 h-[2px] w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {dynamicError && (
                <p className="mt-3 text-sm text-red-500">{dynamicError}</p>
              )}

              <div className="mt-8 grid gap-8 lg:min-h-[560px] lg:grid-cols-[0.35fr_0.65fr]">
                <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span>Navigator</span>
                    <span>
                      {currentStep + 1}/{steps.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-[var(--muted)]">
                    <div className="flex items-center justify-between">
                      <span>Progress</span>
                      <span>
                        {progress}% · {completedSteps}/{steps.length}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                        Quick jump
                      </p>
                      {navQuery && (
                        <button
                          type="button"
                          onClick={() => setNavQuery("")}
                          className="text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <input
                      value={navQuery}
                      onChange={(event) => setNavQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        const firstMatch = navMatches[0];
                        if (!firstMatch) return;
                        event.preventDefault();
                        handleNavSelect(firstMatch);
                      }}
                      placeholder="Search sections, roles, or skills"
                      className="input-base w-full text-sm"
                    />
                    {navQuery.trim().length >= 2 && navMatches.length > 0 && (
                      <div className="mt-2 max-h-[220px] space-y-1 overflow-auto pr-1">
                        {navMatches.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleNavSelect(item)}
                            className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                          >
                            <span className="truncate">{item.label}</span>
                            {item.meta && (
                              <span className="text-[11px] text-[var(--muted)]">
                                {item.meta}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 space-y-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                      AI actions
                    </p>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={openConsultant}
                        className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                      >
                        <span>Consultant chat</span>
                        <span className="text-[11px] text-[var(--muted)]">
                          {consultantMessages.length > 0
                            ? `${consultantMessages.length} msgs`
                            : "Start"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={openSummaryAi}
                        className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                      >
                        <span>Rewrite summary</span>
                        <span className="text-[11px] text-[var(--muted)]">
                          {summaryAiEntries.length > 0
                            ? `${summaryAiEntries.length} drafts`
                            : "AI"}
                        </span>
                      </button>
                      {aiExperienceList.length > 0 && (
                        <div className="max-h-[200px] space-y-1 overflow-auto pr-1">
                          {aiExperienceList.map((exp) => {
                            const label =
                              exp.title && exp.company
                                ? `${exp.title} \u00b7 ${exp.company}`
                                : exp.title || exp.company || "Untitled job";
                            const draftCount =
                              experienceAiHistory[exp.id]?.length ?? 0;
                            return (
                              <button
                                key={`ai-exp-${exp.id}`}
                                type="button"
                                onClick={() => openExperienceAi(exp.id)}
                                className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                              >
                                <span className="truncate">{label}</span>
                                <span className="text-[11px] text-[var(--muted)]">
                                  {draftCount > 0
                                    ? `${draftCount} drafts`
                                    : "AI"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                </aside>

                <div className="flex min-h-[520px] max-h-[80vh] flex-col overflow-hidden lg:min-h-[600px] lg:max-h-[600px] lg:pr-2">
                  <div className="flex-1 overflow-y-auto pr-1">
                    <div className="space-y-6">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          {current.kind === "review" ? "Finalize" : "Question"}
                        </p>
                        <h3 className="font-display mt-2 text-2xl font-semibold">
                          {current.label}
                        </h3>
                        {"hint" in current && current.hint && (
                          <p className="mt-2 text-sm text-[var(--muted)]">
                            {current.hint}
                          </p>
                        )}
                      </div>

                      <div>
                        {current.kind === "text" ||
                          current.kind === "email" ||
                          current.kind === "tel" ? (
                          <input
                            type={current.kind}
                            value={draft.profile[current.field]}
                            onChange={(event) =>
                              updateProfileField(current.field, event.target.value)
                            }
                            placeholder={current.placeholder}
                            className="input-base w-full"
                          />
                        ) : null}

                        {current.kind === "textarea" ? (
                          <div className="space-y-3">
                            <textarea
                              value={draft.profile[current.field]}
                              onChange={(event) =>
                                updateProfileField(
                                  current.field,
                                  event.target.value,
                                )
                              }
                              placeholder={current.placeholder}
                              className="input-base w-full min-h-[140px] resize-none"
                            />
                            {current.field === "summary" ? (
                              <>
                                <p className="text-xs text-[var(--muted)]">
                                  {`Markdown supported. Use "-" for bullets,
                                  **bold**, *italic*, or code. Blank lines start
                                  new paragraphs.`}
                                </p>
                                {draft.profile.summary?.trim() ? (
                                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                      Preview
                                    </p>
                                    <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                                      {renderSummaryBlocks(
                                        draft.profile.summary,
                                        {
                                          paragraphClassName:
                                            "text-sm whitespace-pre-line",
                                          listClassName:
                                            "list-disc space-y-1 pl-4",
                                          itemClassName: "text-sm",
                                        },
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="flex items-center justify-end text-xs text-[var(--muted)]">
                                  <button
                                    type="button"
                                    onClick={openSummaryAi}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                  >
                                    AI rewrite
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : null}

                        {current.kind === "headshot" ? (
                          <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]">
                                {draft.profile.headshotUrl ? (
                                  <Image
                                    src={draft.profile.headshotUrl}
                                    alt="Headshot preview"
                                    width={96}
                                    height={96}
                                    className="h-full w-full object-cover"
                                    unoptimized
                                  />
                                ) : (
                                  <span className="text-xs text-[var(--muted)]">
                                    No photo
                                  </span>
                                )}
                              </div>
                              <div className="space-y-2 text-xs text-[var(--muted)]">
                                <p>Square images look best for the resume.</p>
                                <p>PNG or JPG, up to 2MB.</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="btn-secondary cursor-pointer">
                                Upload headshot
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  onChange={handleHeadshotChange}
                                  className="sr-only"
                                />
                              </label>
                              {draft.profile.headshotUrl ? (
                                <button
                                  type="button"
                                  onClick={handleHeadshotRemove}
                                  className="btn-ghost"
                                >
                                  Remove
                                </button>
                              ) : null}
                              {scrapedHeadshot &&
                                scrapedHeadshot !== draft.profile.headshotUrl ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateProfileField(
                                      "headshotUrl",
                                      scrapedHeadshot,
                                    );
                                    setHeadshotError("");
                                  }}
                                  className="btn-ghost"
                                >
                                  Use LinkedIn headshot
                                </button>
                              ) : null}
                            </div>
                            {headshotError ? (
                              <p className="text-xs text-red-500">
                                {headshotError}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {current.kind === "skills" ? (
                          <SkillInput
                            value={draft.skills}
                            onChange={(skills) =>
                              setDraft((prev) => ({ ...prev, skills }))
                            }
                            suggestions={scraped?.skills ?? []}
                          />
                        ) : null}

                        {current.kind === "experience" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Jobs{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({experienceCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openExperienceImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)]"
                                  >
                                    Add job
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeExperienceId ?? ""}
                                onChange={(event) =>
                                  setActiveExperienceId(event.target.value)
                                }
                                className="input-base mt-3 w-full"
                              >
                                {draft.experiences.map((experience) => {
                                  const label =
                                    experience.title && experience.company
                                      ? `${experience.title} \u00b7 ${experience.company}`
                                      : experience.title ||
                                      experience.company ||
                                      "Untitled job";
                                  return (
                                    <option
                                      key={`job-option-${experience.id}`}
                                      value={experience.id}
                                    >
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showExperienceAdd && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a job
                                  </label>
                                  <input
                                    ref={experienceAddInputRef}
                                    value={experienceSearch}
                                    onChange={(event) =>
                                      setExperienceSearch(event.target.value)
                                    }
                                    onKeyDown={handleExperienceSearchKeyDown}
                                    placeholder="Designer at Atlas"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankExperience}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank job
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowExperienceAdd(false);
                                        setExperienceSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {experienceSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {experienceSuggestions
                                        .slice(0, 5)
                                        .map((item) => (
                                          <button
                                            key={`${item.title}-${item.company}`}
                                            type="button"
                                            onClick={() => {
                                              addExperienceItem(item);
                                              setExperienceSearch("");
                                              setShowExperienceAdd(false);
                                              setPendingExperienceFocus(true);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                          >
                                            <span>{item.title}</span>
                                            <span className="text-xs text-[var(--muted)]">
                                              {item.company}
                                            </span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeExperience ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    ref={experienceTitleRef}
                                    value={activeExperience.title}
                                    onChange={(event) =>
                                      updateExperience(
                                        activeExperienceIndex,
                                        "title",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Role title"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeExperience.company}
                                    onChange={(event) =>
                                      updateExperience(
                                        activeExperienceIndex,
                                        "company",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Company"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeExperience.location ?? ""}
                                    onChange={(event) =>
                                      updateExperience(
                                        activeExperienceIndex,
                                        "location",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Location"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeExperience.startDate ?? ""}
                                    onChange={(event) =>
                                      updateExperience(
                                        activeExperienceIndex,
                                        "startDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Start date (YYYY-MM)"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeExperience.endDate ?? ""}
                                    onChange={(event) =>
                                      updateExperience(
                                        activeExperienceIndex,
                                        "endDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="End date or Present"
                                    className="input-base"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
                                    <span className="uppercase tracking-[0.2em]">
                                      Summary + highlights
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const nextHighlights = [
                                            ...normalizeHighlights(
                                              activeExperience.highlights,
                                            ),
                                            "New highlight",
                                          ];
                                          updateExperience(
                                            activeExperienceIndex,
                                            "highlights",
                                            nextHighlights,
                                          );
                                        }}
                                        className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                      >
                                        Add bullet
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openExperienceAi(activeExperience.id)
                                        }
                                        className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                      >
                                        AI rewrite
                                      </button>
                                    </div>
                                  </div>
                                  <textarea
                                    value={activeExperienceNarrative}
                                    onChange={(event) =>
                                      setDraft((current) => {
                                        const experiences = [
                                          ...current.experiences,
                                        ];
                                        const target =
                                          experiences[activeExperienceIndex];
                                        if (!target) return current;
                                        const parsed = parseExperienceNarrative(
                                          event.target.value,
                                        );
                                        experiences[activeExperienceIndex] = {
                                          ...target,
                                          summary: parsed.summary,
                                          highlights: parsed.highlights,
                                        };
                                        return { ...current, experiences };
                                      })
                                    }
                                    placeholder="Write a short summary, then add bullets starting with '-' on new lines."
                                    className="input-base w-full min-h-[160px] resize-none"
                                  />
                                  <p className="text-xs text-[var(--muted)]">
                                    Markdown supported. Use &quot;-&quot; for bullets,
                                    **bold**, *italic*, or code. Blank lines start
                                    new paragraphs.
                                  </p>
                                  {activeExperienceNarrative.trim() ? (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                        Preview
                                      </p>
                                      <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                                        {renderSummaryBlocks(
                                          activeExperienceNarrative,
                                          {
                                            paragraphClassName:
                                              "text-sm whitespace-pre-line",
                                            listClassName:
                                              "list-disc space-y-1 pl-4",
                                            itemClassName: "text-sm",
                                          },
                                        )}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-[var(--muted)]">
                                  {!isExperienceEmpty(activeExperience) && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeExperience(activeExperience.id)
                                      }
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first job to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "certifications" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Certifications{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({certificationCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openCertificationImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Add certification
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeCertificationId ?? ""}
                                onChange={(event) =>
                                  setActiveCertificationId(event.target.value)
                                }
                                className="input-base mt-3 w-full"
                              >
                                {draft.certifications.map((cert) => {
                                  const name = cert.name?.trim() ?? "";
                                  const issuer = cert.issuer?.trim() ?? "";
                                  const label = name
                                    ? name
                                    : issuer
                                      ? issuer
                                      : "Untitled cert";
                                  return (
                                    <option
                                      key={`cert-option-${cert.id}`}
                                      value={cert.id}
                                    >
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showCertificationImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a certification
                                  </label>
                                  <input
                                    ref={certificationAddInputRef}
                                    value={certificationSearch}
                                    onChange={(event) =>
                                      setCertificationSearch(event.target.value)
                                    }
                                    onKeyDown={handleCertificationSearchKeyDown}
                                    placeholder="AWS Solutions Architect, PMP"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankCertification}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank certification
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowCertificationImport(false);
                                        setCertificationSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {certificationSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {certificationSuggestions
                                        .slice(0, 5)
                                        .map((item) => (
                                          <button
                                            key={`${item.name}-${item.issuer ?? ""}`}
                                            type="button"
                                            onClick={() => {
                                              addCertificationItem(item);
                                              setCertificationSearch("");
                                              setShowCertificationImport(false);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                          >
                                            <span>{item.name}</span>
                                            <span className="text-xs text-[var(--muted)]">
                                              {item.issuer}
                                            </span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeCertification ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={activeCertification.name}
                                    onChange={(event) =>
                                      updateCertification(
                                        activeCertificationIndex,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Certification name"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeCertification.issuer ?? ""}
                                    onChange={(event) =>
                                      updateCertification(
                                        activeCertificationIndex,
                                        "issuer",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Issuing organization"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeCertification.issueDate ?? ""}
                                    onChange={(event) =>
                                      updateCertification(
                                        activeCertificationIndex,
                                        "issueDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Issue date"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeCertification.expirationDate ?? ""}
                                    onChange={(event) =>
                                      updateCertification(
                                        activeCertificationIndex,
                                        "expirationDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Expiration date"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeCertification.credentialId ?? ""}
                                    onChange={(event) =>
                                      updateCertification(
                                        activeCertificationIndex,
                                        "credentialId",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Credential ID"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeCertification.credentialUrl ?? ""}
                                    onChange={(event) =>
                                      updateCertification(
                                        activeCertificationIndex,
                                        "credentialUrl",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Credential URL"
                                    className="input-base"
                                  />
                                </div>
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>Optional details help verification.</span>
                                  {!isCertificationEmpty(activeCertification) && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeCertification(activeCertification.id)
                                      }
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first certification to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "honors" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Honors & awards{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({honorCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openHonorImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Add honor
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeHonorId ?? ""}
                                onChange={(event) => setActiveHonorId(event.target.value)}
                                className="input-base mt-3 w-full"
                              >
                                {draft.honors.map((honor) => {
                                  const title = honor.title?.trim() ?? "";
                                  const issuer = honor.issuer?.trim() ?? "";
                                  const label = title
                                    ? title
                                    : issuer
                                      ? issuer
                                      : "Untitled honor";
                                  return (
                                    <option
                                      key={`honor-option-${honor.id}`}
                                      value={honor.id}
                                    >
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showHonorImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add an honor
                                  </label>
                                  <input
                                    ref={honorAddInputRef}
                                    value={honorSearch}
                                    onChange={(event) =>
                                      setHonorSearch(event.target.value)
                                    }
                                    onKeyDown={handleHonorSearchKeyDown}
                                    placeholder="Employee of the Year, Hackathon winner"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankHonor}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank honor
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowHonorImport(false);
                                        setHonorSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {honorSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {honorSuggestions.slice(0, 5).map((item) => (
                                        <button
                                          key={`${item.title}-${item.issuer ?? ""}`}
                                          type="button"
                                          onClick={() => {
                                            addHonorItem(item);
                                            setHonorSearch("");
                                            setShowHonorImport(false);
                                          }}
                                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                        >
                                          <span>{item.title}</span>
                                          <span className="text-xs text-[var(--muted)]">
                                            {item.issuer}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeHonor ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={activeHonor.title}
                                    onChange={(event) =>
                                      updateHonor(
                                        activeHonorIndex,
                                        "title",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Honor or award"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeHonor.issuer ?? ""}
                                    onChange={(event) =>
                                      updateHonor(
                                        activeHonorIndex,
                                        "issuer",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Issuer"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeHonor.date ?? ""}
                                    onChange={(event) =>
                                      updateHonor(
                                        activeHonorIndex,
                                        "date",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Date"
                                    className="input-base"
                                  />
                                </div>
                                <textarea
                                  value={activeHonor.description ?? ""}
                                  onChange={(event) =>
                                    updateHonor(
                                      activeHonorIndex,
                                      "description",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Short context (optional)"
                                  className="input-base w-full min-h-[90px] resize-none"
                                />
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>AI will format this section.</span>
                                  {!isHonorEmpty(activeHonor) && (
                                    <button
                                      type="button"
                                      onClick={() => removeHonor(activeHonor.id)}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first honor to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "volunteering" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Volunteering{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({volunteerCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openVolunteerImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Add role
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeVolunteerId ?? ""}
                                onChange={(event) =>
                                  setActiveVolunteerId(event.target.value)
                                }
                                className="input-base mt-3 w-full"
                              >
                                {draft.volunteering.map((item) => {
                                  const role = item.role?.trim() ?? "";
                                  const organization = item.organization?.trim() ?? "";
                                  const label =
                                    role && organization
                                      ? `${role} · ${organization}`
                                      : role
                                        ? role
                                        : organization
                                          ? organization
                                          : "Untitled role";
                                  return (
                                    <option
                                      key={`volunteer-option-${item.id}`}
                                      value={item.id}
                                    >
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showVolunteerImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a volunteer role
                                  </label>
                                  <input
                                    ref={volunteerAddInputRef}
                                    value={volunteerSearch}
                                    onChange={(event) =>
                                      setVolunteerSearch(event.target.value)
                                    }
                                    onKeyDown={handleVolunteerSearchKeyDown}
                                    placeholder="Mentor at Code.org, Event volunteer"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankVolunteer}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank role
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowVolunteerImport(false);
                                        setVolunteerSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {volunteerSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {volunteerSuggestions
                                        .slice(0, 5)
                                        .map((item) => (
                                          <button
                                            key={`${item.role}-${item.organization ?? ""}`}
                                            type="button"
                                            onClick={() => {
                                              addVolunteerItem(item);
                                              setVolunteerSearch("");
                                              setShowVolunteerImport(false);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                          >
                                            <span>{item.role}</span>
                                            <span className="text-xs text-[var(--muted)]">
                                              {item.organization}
                                            </span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeVolunteer ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={activeVolunteer.role}
                                    onChange={(event) =>
                                      updateVolunteer(
                                        activeVolunteerIndex,
                                        "role",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Volunteer role"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeVolunteer.organization ?? ""}
                                    onChange={(event) =>
                                      updateVolunteer(
                                        activeVolunteerIndex,
                                        "organization",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Organization"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeVolunteer.cause ?? ""}
                                    onChange={(event) =>
                                      updateVolunteer(
                                        activeVolunteerIndex,
                                        "cause",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Cause"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeVolunteer.startDate ?? ""}
                                    onChange={(event) =>
                                      updateVolunteer(
                                        activeVolunteerIndex,
                                        "startDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Start date"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeVolunteer.endDate ?? ""}
                                    onChange={(event) =>
                                      updateVolunteer(
                                        activeVolunteerIndex,
                                        "endDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="End date"
                                    className="input-base"
                                  />
                                </div>
                                <textarea
                                  value={activeVolunteer.summary ?? ""}
                                  onChange={(event) =>
                                    updateVolunteer(
                                      activeVolunteerIndex,
                                      "summary",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Impact or outcomes (optional)"
                                  className="input-base w-full min-h-[90px] resize-none"
                                />
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>AI will format this section.</span>
                                  {!isVolunteerEmpty(activeVolunteer) && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeVolunteer(activeVolunteer.id)
                                      }
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first volunteer role to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "services" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Services{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({serviceCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openServiceImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Add service
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeServiceId ?? ""}
                                onChange={(event) => setActiveServiceId(event.target.value)}
                                className="input-base mt-3 w-full"
                              >
                                {draft.services.map((item) => {
                                  const label = item.name || "Untitled service";
                                  return (
                                    <option
                                      key={`service-option-${item.id}`}
                                      value={item.id}
                                    >
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showServiceImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a service
                                  </label>
                                  <input
                                    ref={serviceAddInputRef}
                                    value={serviceSearch}
                                    onChange={(event) =>
                                      setServiceSearch(event.target.value)
                                    }
                                    onKeyDown={handleServiceSearchKeyDown}
                                    placeholder="Automation consulting, Cloud migrations"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankService}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank service
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowServiceImport(false);
                                        setServiceSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {serviceSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {serviceSuggestions.slice(0, 5).map((item) => (
                                        <button
                                          key={item.name}
                                          type="button"
                                          onClick={() => {
                                            addServiceItem(item);
                                            setServiceSearch("");
                                            setShowServiceImport(false);
                                          }}
                                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                        >
                                          <span>{item.name}</span>
                                          <span className="text-xs text-[var(--muted)]">
                                            {item.description}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeService ? (
                              <div className="space-y-3">
                                <input
                                  value={activeService.name}
                                  onChange={(event) =>
                                    updateService(
                                      activeServiceIndex,
                                      "name",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Service name"
                                  className="input-base"
                                />
                                <textarea
                                  value={activeService.description ?? ""}
                                  onChange={(event) =>
                                    updateService(
                                      activeServiceIndex,
                                      "description",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Short description (optional)"
                                  className="input-base w-full min-h-[90px] resize-none"
                                />
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>Keep this concise.</span>
                                  {!isServiceEmpty(activeService) && (
                                    <button
                                      type="button"
                                      onClick={() => removeService(activeService.id)}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first service to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "education" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Schools{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({educationCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openEducationImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)]"
                                  >
                                    Add school
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeEducationId ?? ""}
                                onChange={(event) =>
                                  setActiveEducationId(event.target.value)
                                }
                                className="input-base mt-3 w-full"
                              >
                                {draft.education.map((edu) => {
                                  const school = edu.school?.trim() ?? "";
                                  const degree = edu.degree?.trim() ?? "";
                                  const label =
                                    school && degree
                                      ? `${school} \u00b7 ${degree}`
                                      : school
                                        ? school
                                        : degree
                                          ? degree
                                          : "Untitled school";
                                  return (
                                    <option key={`edu-option-${edu.id}`} value={edu.id}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showEducationImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a school
                                  </label>
                                  <input
                                    ref={educationAddInputRef}
                                    value={educationSearch}
                                    onChange={(event) =>
                                      setEducationSearch(event.target.value)
                                    }
                                    onKeyDown={handleEducationSearchKeyDown}
                                    placeholder="Georgia Tech, B.S. Computer Science"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankEducation}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank school
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowEducationImport(false);
                                        setEducationSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {educationSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {educationSuggestions
                                        .slice(0, 5)
                                        .map((item) => (
                                          <button
                                            key={`${item.school}-${item.degree ?? ""}`}
                                            type="button"
                                            onClick={() => {
                                              addEducationItem(item);
                                              setEducationSearch("");
                                              setShowEducationImport(false);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                          >
                                            <span>{item.school}</span>
                                            <span className="text-xs text-[var(--muted)]">
                                              {item.degree}
                                            </span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeEducation ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={activeEducation.school}
                                    onChange={(event) =>
                                      updateEducation(
                                        activeEducationIndex,
                                        "school",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="School"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeEducation.degree ?? ""}
                                    onChange={(event) =>
                                      updateEducation(
                                        activeEducationIndex,
                                        "degree",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Degree"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeEducation.field ?? ""}
                                    onChange={(event) =>
                                      updateEducation(
                                        activeEducationIndex,
                                        "field",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Field of study"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeEducation.startDate ?? ""}
                                    onChange={(event) =>
                                      updateEducation(
                                        activeEducationIndex,
                                        "startDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Start year"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeEducation.endDate ?? ""}
                                    onChange={(event) =>
                                      updateEducation(
                                        activeEducationIndex,
                                        "endDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Graduation year"
                                    className="input-base"
                                  />
                                </div>
                                <textarea
                                  value={activeEducation.notes ?? ""}
                                  onChange={(event) =>
                                    updateEducation(
                                      activeEducationIndex,
                                      "notes",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Highlights or coursework (optional)"
                                  className="input-base w-full min-h-[90px] resize-none"
                                />
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>AI will format this section.</span>
                                  {!isEducationEmpty(activeEducation) && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeEducation(activeEducation.id)
                                      }
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first school to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "projects" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Projects{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({projectCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openProjectImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)]"
                                  >
                                    Add project
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeProjectId ?? ""}
                                onChange={(event) =>
                                  setActiveProjectId(event.target.value)
                                }
                                className="input-base mt-3 w-full"
                              >
                                {draft.projects.map((project) => {
                                  const name = project.name?.trim() ?? "";
                                  const role = project.role?.trim() ?? "";
                                  const label = name
                                    ? name
                                    : role
                                      ? role
                                      : "Untitled project";
                                  return (
                                    <option
                                      key={`project-option-${project.id}`}
                                      value={project.id}
                                    >
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showProjectImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a project
                                  </label>
                                  <input
                                    ref={projectAddInputRef}
                                    value={projectSearch}
                                    onChange={(event) =>
                                      setProjectSearch(event.target.value)
                                    }
                                    onKeyDown={handleProjectSearchKeyDown}
                                    placeholder="TokenGators rebuild, portfolio refresh"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankProject}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank project
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowProjectImport(false);
                                        setProjectSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {projectSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {projectSuggestions
                                        .slice(0, 5)
                                        .map((item) => (
                                          <button
                                            key={`${item.name}-${item.role ?? ""}`}
                                            type="button"
                                            onClick={() => {
                                              addProjectItem(item);
                                              setProjectSearch("");
                                              setShowProjectImport(false);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                          >
                                            <span>{item.name}</span>
                                            <span className="text-xs text-[var(--muted)]">
                                              {item.role}
                                            </span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeProject ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={activeProject.name}
                                    onChange={(event) =>
                                      updateProject(
                                        activeProjectIndex,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Project name"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeProject.role ?? ""}
                                    onChange={(event) =>
                                      updateProject(
                                        activeProjectIndex,
                                        "role",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Role"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeProject.url ?? ""}
                                    onChange={(event) =>
                                      updateProject(
                                        activeProjectIndex,
                                        "url",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Project URL"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeProject.startDate ?? ""}
                                    onChange={(event) =>
                                      updateProject(
                                        activeProjectIndex,
                                        "startDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Start date (YYYY-MM)"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeProject.endDate ?? ""}
                                    onChange={(event) =>
                                      updateProject(
                                        activeProjectIndex,
                                        "endDate",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="End date or Present"
                                    className="input-base"
                                  />
                                </div>
                                <textarea
                                  value={activeProject.description ?? ""}
                                  onChange={(event) =>
                                    updateProject(
                                      activeProjectIndex,
                                      "description",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="What did you build? (optional)"
                                  className="input-base w-full min-h-[120px] resize-none"
                                />
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>Markdown supported.</span>
                                  {!isProjectEmpty(activeProject) && (
                                    <button
                                      type="button"
                                      onClick={() => removeProject(activeProject.id)}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add your first project to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "links" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Links{" "}
                                    <span className="text-[10px] font-semibold text-[var(--text)]">
                                      ({linkCount})
                                    </span>
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={openLinkImport}
                                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Add link
                                  </button>
                                </div>
                              </div>
                              <select
                                value={activeLinkId ?? ""}
                                onChange={(event) => setActiveLinkId(event.target.value)}
                                className="input-base mt-3 w-full"
                              >
                                {draft.links.map((link) => {
                                  const label = link.label || link.url || "Untitled link";
                                  return (
                                    <option key={`link-option-${link.id}`} value={link.id}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                              {showLinkImport && (
                                <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                  <label className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                                    Search or add a link
                                  </label>
                                  <input
                                    ref={linkAddInputRef}
                                    value={linkSearch}
                                    onChange={(event) => setLinkSearch(event.target.value)}
                                    onKeyDown={handleLinkSearchKeyDown}
                                    placeholder="Portfolio, GitHub, LinkedIn"
                                    className="input-base w-full"
                                  />
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                    <button
                                      type="button"
                                      onClick={handleAddBlankLink}
                                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                                    >
                                      Create blank link
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowLinkImport(false);
                                        setLinkSearch("");
                                      }}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {linkSuggestions.length > 0 && (
                                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                      {linkSuggestions.slice(0, 5).map((item) => (
                                        <button
                                          key={item.url}
                                          type="button"
                                          onClick={() => {
                                            addLinkItem(item);
                                            setLinkSearch("");
                                            setShowLinkImport(false);
                                          }}
                                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                                        >
                                          <span>{item.label}</span>
                                          <span className="text-xs text-[var(--muted)]">
                                            {item.url}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeLink ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={activeLink.label}
                                    onChange={(event) =>
                                      updateLink(
                                        activeLinkIndex,
                                        "label",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Label"
                                    className="input-base"
                                  />
                                  <input
                                    value={activeLink.url}
                                    onChange={(event) =>
                                      updateLink(
                                        activeLinkIndex,
                                        "url",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="https://"
                                    className="input-base"
                                  />
                                </div>
                                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                  <span>Limit to your best links.</span>
                                  {!isLinkEmpty(activeLink) && (
                                    <button
                                      type="button"
                                      onClick={() => removeLink(activeLink.id)}
                                      className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--muted)]">
                                Add a link to get started.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {current.kind === "dynamic" ? (
                          <div className="space-y-4">
                            {current.inputType === "choice" &&
                              (current.options?.length ?? 0) > 0 ? (
                              <div className="flex flex-wrap gap-3">
                                {(current.options ?? []).map((option) => {
                                  const selected =
                                    dynamicAnswers[current.key] === option;
                                  return (
                                    <button
                                      key={option}
                                      type="button"
                                      onClick={() =>
                                        updateDynamicAnswer(current.key, option)
                                      }
                                      className={
                                        selected ? "btn-primary" : "btn-secondary"
                                      }
                                    >
                                      {option}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : current.inputType === "textarea" ? (
                              <textarea
                                value={
                                  dynamicAnswers[current.key] ??
                                  current.prefill ??
                                  ""
                                }
                                onChange={(event) =>
                                  updateDynamicAnswer(
                                    current.key,
                                    event.target.value,
                                  )
                                }
                                placeholder={current.placeholder}
                                className="input-base w-full min-h-[140px] resize-none"
                              />
                            ) : (
                              <input
                                value={
                                  dynamicAnswers[current.key] ??
                                  current.prefill ??
                                  ""
                                }
                                onChange={(event) =>
                                  updateDynamicAnswer(
                                    current.key,
                                    event.target.value,
                                  )
                                }
                                placeholder={current.placeholder}
                                className="input-base w-full"
                              />
                            )}
                          </div>
                        ) : null}

                        {current.kind === "confirm-skill" ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                handleConfirmSkill(current.skill, true)
                              }
                              className="btn-primary"
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleConfirmSkill(current.skill, false)
                              }
                              className="btn-secondary"
                            >
                              Skip
                            </button>
                          </div>
                        ) : null}

                        {current.kind === "review" ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                              <p className="text-sm font-semibold">
                                {draft.profile.fullName || "Your name"}
                              </p>
                              <p className="text-xs text-[var(--muted)]">
                                {reviewLine}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                {(draft.skills.length > 0
                                  ? draft.skills
                                  : ["Skills will appear here"]
                                )
                                  .slice(0, 8)
                                  .map((skill) => (
                                    <span
                                      key={skill}
                                      className="rounded-lg bg-[var(--accent-soft)] px-3 py-1 text-[var(--accent)]"
                                    >
                                      {skill}
                                    </span>
                                  ))}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                              <p className="text-sm font-semibold">
                                Ready for the personal site add-on?
                              </p>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                Your resume is ready. Now turn it into a personal
                                site that shows proof, not just bullets.
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => scrollToSection("website-upsell")}
                                  className="btn-primary"
                                >
                                  See website packages
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleDeclinePackage();
                                    scrollToSection("share-unlock");
                                  }}
                                  className="btn-secondary"
                                >
                                  Skip to share unlock
                                </button>
                              </div>
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                Downloads unlock after you pick a package or share.
                              </p>
                            </div>
                          </div>
                        ) : null}

                        {dynamicLoading && current.kind === "links" && (
                          <p className="text-sm text-[var(--muted)]">
                            Creating tailored questions based on your answers...
                          </p>
                        )}
                      </div>
                    </div>

                    {current.kind !== "confirm-skill" && (
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)]/60 pt-4">
                        <button
                          type="button"
                          onClick={handleBack}
                          className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={currentStep === 0}
                        >
                          Back
                        </button>
                        {isArrayStep ? (
                          <button
                            type="button"
                            onClick={handleArrayDone}
                            className="btn-primary"
                          >
                            Done
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              void handleNext();
                            }}
                            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={dynamicLoading}
                          >
                            {nextLabel}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {showUpsell && (
          <section
            id="website-upsell"
            className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-4"
          >
            <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[linear-gradient(180deg,var(--surface),var(--surface-muted))] p-6 md:p-10">
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[var(--accent-soft)] opacity-70 blur-3xl"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute -left-24 bottom-[-120px] h-60 w-60 rounded-full bg-[var(--surface)] opacity-70 blur-3xl"
                aria-hidden="true"
              />
              <div className="relative grid gap-10 lg:grid-cols-[0.45fr_0.55fr]">
                <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
                  <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted)]">
                    Personal site add-on
                  </p>
                  <h2 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
                    A resume gets attention. A site wins the room.
                  </h2>
                  <p className="text-sm text-[var(--muted)] md:text-base">
                    We package your resume into a personal site that feels like
                    a valuable add-on. AI drafts the structure, you customize
                    the voice, sections, and look.
                  </p>
                  <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.3em] text-[var(--muted)]">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
                      AI-driven
                    </span>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
                      Fully customizable
                    </span>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
                      Publish-ready
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => scrollToSection("website-packages")}
                      className="btn-primary"
                    >
                      View packages
                    </button>
                    <p className="text-xs text-[var(--muted)]">
                      Most people ship in under a day.
                    </p>
                  </div>
                </div>
                <div className="space-y-5">
                  <div
                    data-scroll-pop
                    className="scroll-pop rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 card-shadow"
                    style={{ transitionDelay: "0ms" }}
                  >
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      Proof beats bullets
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold">
                      Show impact with proof blocks.
                    </h3>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      We convert your wins into visual highlights, outcomes, and
                      credibility modules.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Impact stats
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Highlights
                      </span>
                    </div>
                  </div>

                  <div
                    data-scroll-pop
                    className="scroll-pop rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 card-shadow"
                    style={{ transitionDelay: "80ms" }}
                  >
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      AI builds 90%
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold">
                      Start with a smart draft.
                    </h3>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Resume data becomes sections, project cards, and a story
                      arc you can reorder.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        AI draft
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Editable
                      </span>
                    </div>
                  </div>

                  <div
                    data-scroll-pop
                    className="scroll-pop rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 card-shadow"
                    style={{ transitionDelay: "160ms" }}
                  >
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      Customizable look
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold">
                      Make it feel like you.
                    </h3>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Choose themes, typography, and color. Swap layouts without
                      touching code.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Themes
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Layouts
                      </span>
                    </div>
                  </div>

                  <div
                    data-scroll-pop
                    className="scroll-pop rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 card-shadow"
                    style={{ transitionDelay: "240ms" }}
                  >
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      Packaged to convert
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold">
                      Hosting, domain, and CTA.
                    </h3>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      We ship a shareable site link that stays synced with your
                      resume.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Hosting
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-3 py-1">
                        Share link
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div id="website-packages" className="mt-12 space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    Packages
                  </p>
                  <h2 className="font-display text-2xl font-semibold md:text-3xl">
                    Pick the site package that fits.
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    AI handles the heavy lift. You keep final control.
                  </p>
                </div>
                <div className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--muted)]">
                  Launch-ready in 24 to 72 hours.
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <div
                  className={`flex h-full flex-col rounded-3xl border p-6 transition-all card-shadow ${selectedPackage === "launch"
                    ? "border-[var(--accent)] bg-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                    }`}
                >
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                      Launch
                    </p>
                    <p className="font-display text-3xl font-semibold">
                      $149
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      Fast, clean one-page site built from your resume.
                    </p>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
                    <li>AI draft + layout</li>
                    <li>Custom colors + type</li>
                    <li>Publish in 48 hours</li>
                    <li>Resume sync</li>
                  </ul>
                  <div className="mt-auto pt-6">
                    <button
                      type="button"
                      onClick={() => handleSelectPackage("launch")}
                      className={
                        selectedPackage === "launch"
                          ? "btn-primary"
                          : "btn-secondary"
                      }
                    >
                      {selectedPackage === "launch"
                        ? "Selected"
                        : "Choose Launch"}
                    </button>
                  </div>
                </div>

                <div
                  className={`relative flex h-full flex-col rounded-3xl border p-6 transition-all card-shadow ${selectedPackage === "signal"
                    ? "border-[var(--accent)] bg-[linear-gradient(180deg,var(--surface),var(--accent-soft))]"
                    : "border-[var(--border)] bg-[linear-gradient(180deg,var(--surface),var(--accent-soft))]"
                    }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                      Signal
                    </p>
                    <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--accent-ink)]">
                      Most popular
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    <p className="font-display text-3xl font-semibold">
                      $299
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      Strong positioning with story and project highlights.
                    </p>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
                    <li>Everything in Launch</li>
                    <li>Project highlight blocks</li>
                    <li>Custom domain setup</li>
                    <li>One revision round</li>
                  </ul>
                  <div className="mt-auto pt-6">
                    <button
                      type="button"
                      onClick={() => handleSelectPackage("signal")}
                      className={
                        selectedPackage === "signal"
                          ? "btn-primary"
                          : "btn-secondary"
                      }
                    >
                      {selectedPackage === "signal"
                        ? "Selected"
                        : "Choose Signal"}
                    </button>
                  </div>
                </div>

                <div
                  className={`flex h-full flex-col rounded-3xl border p-6 transition-all card-shadow ${selectedPackage === "studio"
                    ? "border-[var(--accent)] bg-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                    }`}
                >
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                      Studio
                    </p>
                    <p className="font-display text-3xl font-semibold">
                      $599
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      Premium narrative polish and design direction.
                    </p>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
                    <li>Everything in Signal</li>
                    <li>Design direction pass</li>
                    <li>Two revision rounds</li>
                    <li>Priority launch</li>
                  </ul>
                  <div className="mt-auto pt-6">
                    <button
                      type="button"
                      onClick={() => handleSelectPackage("studio")}
                      className={
                        selectedPackage === "studio"
                          ? "btn-primary"
                          : "btn-secondary"
                      }
                    >
                      {selectedPackage === "studio"
                        ? "Selected"
                        : "Choose Studio"}
                    </button>
                  </div>
                </div>
              </div>

              {selectedPackageLabel && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">
                        Selected: {selectedPackageLabel} package
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        Next up: we draft your personal site from this resume.
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[1.2fr_auto] md:items-end">
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          Site URL
                        </label>
                        <div className="mt-2 flex w-full items-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                          <span className="px-3 py-2 text-xs text-[var(--muted)]">
                            https://
                          </span>
                          <input
                            value={siteSlug}
                            onChange={handleSiteSlugChange}
                            placeholder="your-name"
                            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-[var(--text)] outline-none"
                          />
                          <span className="px-3 py-2 text-xs text-[var(--muted)]">
                            .{SITE_DOMAIN_BASE}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          You can adjust this before we publish.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleStartSiteGeneration}
                        className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={siteJobState === "loading" || !siteSlug}
                      >
                        {siteJobState === "loading"
                          ? "Starting..."
                          : "Continue to site design"}
                      </button>
                    </div>

                    {siteJobError ? (
                      <p className="text-xs text-red-500">{siteJobError}</p>
                    ) : null}
                    {siteJobState === "success" && siteJobInfo?.domain ? (
                      <p className="text-xs text-[var(--accent)]">
                        Site job queued for {siteJobInfo.domain}.
                        {siteJobInfo.jobId
                          ? ` Job ID: ${siteJobInfo.jobId}.`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <div
              id="share-unlock"
              className="mt-12 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    Not ready for a site?
                  </p>
                  <h3 className="font-display text-2xl font-semibold">
                    Share to unlock resume downloads.
                  </h3>
                  <p className="text-sm text-[var(--muted)]">
                    If you skip the packages, share one post on LinkedIn or X
                    to unlock PDF, DOCX, MD, and TXT exports.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDeclinePackage}
                  className="btn-secondary"
                >
                  No thanks, share instead
                </button>
              </div>

              {!packageDeclined && (
                <p className="mt-4 text-xs text-[var(--muted)]">
                  Share once to unlock downloads. You can still pick a package
                  later.
                </p>
              )}

              {packageDeclined && (
                <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      Example post
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      This post kicks off website generation.
                    </p>
                    <p className="mt-3 whitespace-pre-line text-sm text-[var(--text)]">
                      {sharePost}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopySharePost}
                        className="btn-secondary"
                      >
                        {shareCopied ? "Copied" : "Copy post"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareUnlocked(true)}
                        className="btn-primary"
                      >
                        I shared it
                      </button>
                      {shareUnlocked ? (
                        <span className="text-xs text-[var(--accent)]">
                          Downloads unlocked.
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">
                          Unlock downloads after sharing.
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                      What happens next
                    </p>
                    <div className="mt-3 space-y-3 text-sm text-[var(--muted)]">
                      <p>
                        Share the post, then confirm here to unlock your resume.
                      </p>
                      <p>
                        Your share helps us keep the resume builder free.
                      </p>
                      <p>
                        When you are ready, come back for the personal site.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {packageDeclined && shareUnlocked && (
                <div className="mt-6 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={exportPdfState === "loading"}
                    >
                      {exportPdfState === "loading"
                        ? "Preparing PDF..."
                        : "Download PDF"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportDocx}
                      className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={exportDocxState === "loading"}
                    >
                      {exportDocxState === "loading"
                        ? "Generating..."
                        : "Download DOCX"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportMarkdown}
                      className="btn-secondary"
                    >
                      Download MD
                    </button>
                    <button
                      type="button"
                      onClick={handleExportText}
                      className="btn-secondary"
                    >
                      Download TXT
                    </button>
                  </div>
                  {exportError && (
                    <p className="text-xs text-red-500">{exportError}</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {consultantVisible && (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 transition-opacity duration-200 ${consultantOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            onClick={closeConsultant}
          >
            <div
              className={`w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all duration-200 ease-out ${consultantOpen
                ? "translate-y-0 opacity-100"
                : "-translate-y-4 opacity-0"
                }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Resume consultant
                  </p>
                  <h3 className="text-lg font-semibold text-[var(--text)]">
                    Add missing context
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Keep refining details while you work through the questions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeConsultant}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                >
                  Close
                </button>
              </div>
              {consultantBody(false)}
            </div>
          </div>
        )}

        {summaryAiVisible && (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 transition-opacity duration-200 ${summaryAiOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            onClick={closeSummaryAi}
          >
            <div
              className={`w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all duration-200 ease-out ${summaryAiOpen
                ? "translate-y-0 opacity-100"
                : "-translate-y-4 opacity-0"
                }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    AI rewrite
                  </p>
                  <h3 className="text-lg font-semibold text-[var(--text)]">
                    Professional summary
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Refine tone, focus, and impact.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSummaryAi}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">
                  {draft.profile.summary ? (
                    <div className="space-y-2">
                      {renderSummaryBlocks(draft.profile.summary)}
                    </div>
                  ) : (
                    "No summary yet. Add a few lines or use AI to draft one."
                  )}
                </div>
                {summaryAiOriginal ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span>LinkedIn original</span>
                      <button
                        type="button"
                        onClick={() => {
                          restoreProfileSummary();
                          setSummaryAiPrompt("");
                        }}
                        className="text-[11px] font-semibold text-[var(--accent)] normal-case tracking-normal hover:underline"
                      >
                        Restore
                      </button>
                    </div>
                    <div className="mt-2 space-y-2 text-xs text-[var(--muted)]">
                      {renderSummaryBlocks(summaryAiOriginal)}
                    </div>
                  </div>
                ) : null}
                <textarea
                  value={summaryAiPrompt}
                  onChange={(event) => setSummaryAiPrompt(event.target.value)}
                  placeholder="Tell the AI what to emphasize (tone, scope, impact, metrics)."
                  className="input-base w-full min-h-[110px] resize-none"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSummaryAiGenerate}
                    className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={summaryAiState === "loading" || !edenEnabled}
                  >
                    {!edenEnabled
                      ? "AI unavailable"
                      : summaryAiState === "loading"
                        ? "Generating..."
                        : "Generate draft"}
                  </button>
                  {!edenEnabled && (
                    <p className="text-xs text-[var(--muted)]">
                      Add an Eden AI key to generate drafts.
                    </p>
                  )}
                  {summaryAiError && (
                    <p className="text-xs text-red-500">{summaryAiError}</p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Draft history
                  </p>
                  <span className="text-xs text-[var(--muted)]">
                    {summaryAiEntries.length} drafts
                  </span>
                </div>
                {summaryAiEntries.length > 0 ? (
                  <div className="mt-3 max-h-[40vh] space-y-3 overflow-auto pr-1">
                    {summaryAiEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase text-[var(--muted)]">
                            {entry.source === "auto" ? "Auto" : "You"}
                          </span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--text)]">
                          {entry.source === "auto"
                            ? "Auto rewrite"
                            : entry.prompt || "General rewrite"}
                        </p>
                        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <p className="text-[11px] font-semibold uppercase text-[var(--muted)]">
                            AI draft
                          </p>
                          {entry.summary ? (
                            <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                              {renderSummaryBlocks(entry.summary)}
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-[var(--muted)]">
                              No summary returned.
                            </p>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              applySummarySuggestion(entry);
                              setSummaryAiPrompt(
                                entry.source === "auto" ? "" : entry.prompt,
                              );
                            }}
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface)]"
                          >
                            Use this draft
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    No drafts yet. Add a prompt above to generate one.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {experienceAiVisible && experienceAiActive && experienceAiId && (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 transition-opacity duration-200 ${experienceAiOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            onClick={closeExperienceAi}
          >
            <div
              className={`w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all duration-200 ease-out ${experienceAiOpen
                ? "translate-y-0 opacity-100"
                : "-translate-y-4 opacity-0"
                }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    AI rewrite
                  </p>
                  <h3 className="text-lg font-semibold text-[var(--text)]">
                    {experienceAiActive.title || "Experience summary"}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    {[experienceAiActive.company, experienceAiActive.location]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeExperienceAi}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">
                  {experienceAiActive.summary ? (
                    <div className="space-y-2">
                      {renderSummaryBlocks(experienceAiActive.summary)}
                    </div>
                  ) : (
                    "No summary yet. Add a few lines or use AI to draft one."
                  )}
                </div>
                {experienceAiOriginal &&
                  (experienceAiOriginal.summary ||
                    (experienceAiOriginal.highlights?.length ?? 0) > 0) ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span>LinkedIn original</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (experienceAiId) {
                            restoreExperienceFromScraped(experienceAiId);
                          }
                          setExperienceAiPrompt("");
                        }}
                        className="text-[11px] font-semibold text-[var(--accent)] normal-case tracking-normal hover:underline"
                      >
                        Restore
                      </button>
                    </div>
                    {experienceAiOriginal.summary ? (
                      <div className="mt-2 space-y-2 text-xs text-[var(--muted)]">
                        {renderSummaryBlocks(experienceAiOriginal.summary)}
                      </div>
                    ) : null}
                    {(experienceAiOriginal.highlights ?? []).length > 0 && (
                      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">
                        {(experienceAiOriginal.highlights ?? []).map(
                          (item, index) => (
                            <li
                              key={`experience-original-${experienceAiOriginal.id}-${index}`}
                            >
                              {item}
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                ) : null}
                <textarea
                  value={experienceAiPrompt}
                  onChange={(event) => setExperienceAiPrompt(event.target.value)}
                  placeholder="Tell the AI what to emphasize (tone, scope, impact, metrics)."
                  className="input-base w-full min-h-[110px] resize-none"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExperienceAiGenerate}
                    className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={experienceAiState === "loading" || !edenEnabled}
                  >
                    {!edenEnabled
                      ? "AI unavailable"
                      : experienceAiState === "loading"
                        ? "Generating..."
                        : "Generate draft"}
                  </button>
                  {!edenEnabled && (
                    <p className="text-xs text-[var(--muted)]">
                      Add an Eden AI key to generate drafts.
                    </p>
                  )}
                  {experienceAiError && (
                    <p className="text-xs text-red-500">{experienceAiError}</p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Draft history
                  </p>
                  <span className="text-xs text-[var(--muted)]">
                    {experienceAiEntries.length} drafts
                  </span>
                </div>
                {experienceAiEntries.length > 0 ? (
                  <div className="mt-3 max-h-[40vh] space-y-3 overflow-auto pr-1">
                    {experienceAiEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase text-[var(--muted)]">
                            {entry.source === "auto" ? "Auto" : "You"}
                          </span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--text)]">
                          {entry.source === "auto"
                            ? "Auto rewrite"
                            : entry.prompt || "General rewrite"}
                        </p>
                        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <p className="text-[11px] font-semibold uppercase text-[var(--muted)]">
                            AI draft
                          </p>
                          {entry.summary ? (
                            <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                              {renderSummaryBlocks(entry.summary)}
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-[var(--muted)]">
                              No summary returned.
                            </p>
                          )}
                          {entry.highlights.length > 0 && (
                            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-[var(--text)]">
                              {entry.highlights.map((item, index) => (
                                <li key={`${entry.id}-hl-${index}`}>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              applyExperienceSuggestion(experienceAiId, entry);
                              setExperienceAiPrompt(
                                entry.source === "auto" ? "" : entry.prompt,
                              );
                            }}
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface)]"
                          >
                            Use this draft
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    No drafts yet. Add a prompt above to generate one.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <footer className="border-t border-[var(--border)]/70">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-[var(--muted)]">
            <span>Resume Foundry</span>
            <span>Private intake. Export anytime.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

type SkillInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions: string[];
};

function SkillInput({ value = [], onChange, suggestions }: SkillInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed) return;
    onChange(mergeSkills(value, [trimmed]));
    setInput("");
    inputRef.current?.focus();
  };

  const removeSkill = (skill: string) => {
    onChange(value.filter((item) => item !== skill));
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (input.trim()) {
        addSkill(input);
      }
      return;
    }
    if (event.key === ",") {
      event.preventDefault();
      addSkill(input);
    }
  };

  const query = input.trim().toLowerCase();
  const suggested =
    query.length > 0
      ? suggestions.filter((skill) => {
        const normalized = normalizeSkill(skill);
        if (value.map(normalizeSkill).includes(normalized)) return false;
        return normalized.includes(query);
      })
      : [];

  return (
    <div className="space-y-4">
      <div className="input-base flex w-full flex-wrap gap-2">
        {value.map((skill) => (
          <button
            key={skill}
            type="button"
            onClick={() => removeSkill(skill)}
            className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm text-[var(--text)]"
          >
            {skill}
          </button>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a skill"
          className="min-w-[160px] flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      {suggested.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Matches
          </p>
          <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-2">
            {suggested.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => addSkill(skill)}
                className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)] hover:border-[var(--accent)]"
              >
                {skill}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

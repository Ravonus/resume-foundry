"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  applyScrapedProfile,
  createEmptyDraft,
  mergeSkills,
  type ResumeDraft,
  type ScrapedProfile,
} from "~/lib/resume/types";

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
      kind: "skills" | "experience" | "education" | "links";
      label: string;
      hint?: string;
    }
  | {
      id: string;
      kind: "confirm-skill";
      label: string;
      skill: string;
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

type DynamicStep = Extract<Step, { kind: "dynamic" }>;

type ResumeWizardProps = {
  edenEnabled?: boolean;
};

type ResumeTheme = {
  accent: string;
  accentSoft: string;
  accentInk: string;
};

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
    id: "links",
    kind: "links",
    label: "Links",
  },
  {
    id: "review",
    kind: "review",
    label: "Review and generate",
    hint: "Free PDF + DOCX export.",
  },
];

const normalizeSkill = (value: string) => value.trim().toLowerCase();

const createItemId = () => Math.random().toString(36).slice(2, 10);

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

const createBlankLink = () => ({
  id: createItemId(),
  label: "",
  url: "",
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

const isLinkEmpty = (link: ResumeDraft["links"][number]) =>
  !link.label && !link.url;

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
  links: draft.links.filter((item) => !isLinkEmpty(item)),
});

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

const normalizeDraft = (value: ResumeDraft) => {
  const base = createEmptyDraft();
  return {
    ...base,
    ...value,
    profile: { ...base.profile, ...(value.profile ?? {}) },
    skills: Array.isArray(value.skills) ? value.skills : base.skills,
    experiences: normalizeExperiences(value.experiences),
    education: normalizeEducation(value.education),
    links: normalizeLinks(value.links),
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
  const [activeExperienceId, setActiveExperienceId] = useState<string | null>(
    null,
  );
  const [activeEducationId, setActiveEducationId] = useState<string | null>(
    null,
  );
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const [experienceSearch, setExperienceSearch] = useState("");
  const [educationSearch, setEducationSearch] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [exportDocxState, setExportDocxState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [exportPdfState, setExportPdfState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [exportError, setExportError] = useState("");
  const [resumeTheme, setResumeTheme] = useState<ResumeTheme | null>(null);
  const [polishPrompt, setPolishPrompt] = useState("");
  const [polishState, setPolishState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [polishError, setPolishError] = useState("");

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
  ]);

  useEffect(() => {
    if (scraped) {
      setDraft((current) => applyScrapedProfile(current, scraped));
    }
  }, [scraped]);

  useEffect(() => {
    if (hasStarted) {
      document.getElementById("questions")?.scrollIntoView({ behavior: "auto" });
    }
  }, [hasStarted]);

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
        }
      } catch (error) {
        if (!active) return;
        setScrapeState("error");
        setScrapeError("We could not read that profile.");
        setScrapeJobId(null);
        setScrapeQueuePosition(null);
      }
    };

    void poll();
    const interval = setInterval(poll, 2500);

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
      setActiveExperienceId(draft.experiences[0].id);
    }
  }, [draft.experiences, activeExperienceId]);

  useEffect(() => {
    if (draft.education.length === 0) return;
    if (
      !activeEducationId ||
      !draft.education.some((item) => item.id === activeEducationId)
    ) {
      setActiveEducationId(draft.education[0].id);
    }
  }, [draft.education, activeEducationId]);

  useEffect(() => {
    if (draft.links.length === 0) return;
    if (!activeLinkId || !draft.links.some((item) => item.id === activeLinkId)) {
      setActiveLinkId(draft.links[0].id);
    }
  }, [draft.links, activeLinkId]);

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
    } catch (error) {
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
    setActiveExperienceId(null);
    setActiveEducationId(null);
    setActiveLinkId(null);
    setExperienceSearch("");
    setEducationSearch("");
    setLinkSearch("");
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
    } catch (error) {
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

      const response = await fetch("/api/linkedin/ocr", {
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
    } catch (error) {
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
        body: JSON.stringify({ draft: currentDraft, scraped }),
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
        id: question.id || `dynamic-${question.key}`,
        kind: "dynamic",
      }));
    } catch (error) {
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
        body: JSON.stringify(cleaned),
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
    } catch (error) {
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
    const name = cleaned.profile.fullName?.trim() || "Resume";
    const headline = cleaned.profile.headline?.trim() || "";
    const contactParts = [
      cleaned.profile.email?.trim(),
      cleaned.profile.phone?.trim(),
      cleaned.profile.location?.trim(),
      cleaned.profile.website?.trim(),
      ...cleaned.links.map((link) => link.url?.trim()).filter(Boolean),
    ].filter(Boolean);

    const section = (title: string, body: string) =>
      body
        ? `<section><h2>${title}</h2>${body}</section>`
        : "";

    const summary = cleaned.profile.summary?.trim()
      ? `<p>${cleaned.profile.summary.trim()}</p>`
      : "";

    const skills = cleaned.skills.length
      ? `<p>${cleaned.skills.join(", ")}</p>`
      : "";

    const experiences = cleaned.experiences
      .filter((exp) => exp.title || exp.company)
      .map((exp) => {
        const title = [exp.title, exp.company].filter(Boolean).join(" - ");
        const metaParts = [
          [exp.startDate, exp.endDate].filter(Boolean).join(" - "),
          exp.location ?? "",
        ]
          .map((value) => value.trim())
          .filter(Boolean);
        const meta = metaParts.length ? `<div class="meta">${metaParts.join(" | ")}</div>` : "";
        const summaryText = exp.summary?.trim()
          ? `<p>${exp.summary.trim()}</p>`
          : "";
        const highlights = (exp.highlights ?? [])
          .filter((value) => value.trim())
          .map((value) => `<li>${value.trim()}</li>`)
          .join("");
        const highlightList = highlights ? `<ul>${highlights}</ul>` : "";
        return `<div class="block"><h3>${title}</h3>${meta}${summaryText}${highlightList}</div>`;
      })
      .join("");

    const education = cleaned.education
      .filter((edu) => edu.school)
      .map((edu) => {
        const title = [edu.school, edu.degree].filter(Boolean).join(" - ");
        const metaParts = [
          edu.field ?? "",
          [edu.startDate, edu.endDate].filter(Boolean).join(" - "),
        ]
          .map((value) => value.trim())
          .filter(Boolean);
        const meta = metaParts.length ? `<div class="meta">${metaParts.join(" | ")}</div>` : "";
        const notes = edu.notes?.trim() ? `<p>${edu.notes.trim()}</p>` : "";
        return `<div class="block"><h3>${title}</h3>${meta}${notes}</div>`;
      })
      .join("");

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${name} Resume</title>
    <style>
      :root {
        color-scheme: light;
        --accent: ${theme.accent};
        --accent-soft: ${theme.accentSoft};
        --accent-ink: ${theme.accentInk};
      }
      body {
        font-family: "IBM Plex Serif", "Times New Roman", serif;
        color: #101418;
        margin: 40px;
        line-height: 1.5;
        background: #ffffff;
      }
      h1 {
        font-size: 28px;
        margin: 0 0 4px;
        color: var(--accent);
      }
      h2 {
        font-size: 16px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 24px 0 8px;
        color: var(--accent);
        border-bottom: 1px solid var(--accent);
        padding-bottom: 4px;
      }
      h3 {
        font-size: 14px;
        margin: 12px 0 4px;
      }
      p, li {
        font-size: 12.5px;
        margin: 0 0 6px;
      }
      ul {
        margin: 6px 0 12px 18px;
        padding: 0;
      }
      .meta {
        font-size: 11.5px;
        color: #5a6774;
        margin-bottom: 6px;
      }
      .block {
        margin-bottom: 12px;
      }
      .contact {
        font-size: 12px;
        color: #3d4a57;
        margin-bottom: 12px;
      }
      .headline {
        font-size: 13.5px;
        margin-bottom: 8px;
      }
      header {
        border-bottom: 2px solid var(--accent);
        padding-bottom: 12px;
        margin-bottom: 16px;
      }
      @media print {
        body {
          margin: 24px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${name}</h1>
      ${headline ? `<div class="headline">${headline}</div>` : ""}
      ${contactParts.length ? `<div class="contact">${contactParts.join(" | ")}</div>` : ""}
    </header>
    ${section("Summary", summary)}
    ${section("Skills", skills)}
    ${section("Experience", experiences)}
    ${section("Education", education)}
  </body>
</html>`;

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
    } catch (error) {
      setExportPdfState("error");
      setExportError("Could not generate your PDF.");
    }
  };

  const handlePolish = async () => {
    if (polishState === "loading") return;
    setPolishState("loading");
    setPolishError("");

    const cleaned = cleanDraft(normalizeDraft(draft));

    try {
      const response = await fetch("/api/ai/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: cleaned,
          scraped,
          prompt: polishPrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setPolishState("error");
        setPolishError(data?.error ?? "We could not polish your resume.");
        return;
      }

      const data = (await response.json()) as { draft: ResumeDraft };
      if (data?.draft) {
        setDraft(data.draft);
        setPolishState("success");
        return;
      }

      setPolishState("error");
      setPolishError("We could not polish your resume.");
    } catch (error) {
      setPolishState("error");
      setPolishError("We could not polish your resume.");
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

  const updateExperience = (
    index: number,
    field: keyof ResumeDraft["experiences"][number],
    value: string,
  ) => {
    setDraft((current) => {
      const experiences = [...current.experiences];
      experiences[index] = { ...experiences[index], [field]: value };
      return { ...current, experiences };
    });
  };

  const updateEducation = (
    index: number,
    field: keyof ResumeDraft["education"][number],
    value: string,
  ) => {
    setDraft((current) => {
      const education = [...current.education];
      education[index] = { ...education[index], [field]: value };
      return { ...current, education };
    });
  };

  const updateLink = (
    index: number,
    field: keyof ResumeDraft["links"][number],
    value: string,
  ) => {
    setDraft((current) => {
      const links = [...current.links];
      links[index] = { ...links[index], [field]: value };
      return { ...current, links };
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
  };

  const handleLinkSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const trimmed = linkSearch.trim();
    if (!trimmed) return;
    addLinkItem({ label: "Link", url: trimmed });
    setLinkSearch("");
  };

  const addExperienceItem = (
    value: Partial<ResumeDraft["experiences"][number]> & { id?: string },
  ) => {
    const next = {
      ...createBlankExperience(),
      ...value,
      id: value.id ?? createItemId(),
    };
    setDraft((current) => ({
      ...current,
      experiences: [...current.experiences, next],
    }));
    setActiveExperienceId(next.id);
  };

  const addEducationItem = (
    value: Partial<ResumeDraft["education"][number]> & { id?: string },
  ) => {
    const next = {
      ...createBlankEducation(),
      ...value,
      id: value.id ?? createItemId(),
    };
    setDraft((current) => ({
      ...current,
      education: [...current.education, next],
    }));
    setActiveEducationId(next.id);
  };

  const addLinkItem = (
    value: Partial<ResumeDraft["links"][number]> & { id?: string },
  ) => {
    const next = {
      ...createBlankLink(),
      ...value,
      id: value.id ?? createItemId(),
    };
    setDraft((current) => ({
      ...current,
      links: [...current.links, next],
    }));
    setActiveLinkId(next.id);
  };

  const addExperience = () => {
    const next = createBlankExperience();
    setDraft((current) => ({
      ...current,
      experiences: [...current.experiences, next],
    }));
    setActiveExperienceId(next.id);
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

  const addEducation = () => {
    const next = createBlankEducation();
    setDraft((current) => ({
      ...current,
      education: [...current.education, next],
    }));
    setActiveEducationId(next.id);
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

  const addLink = () => {
    const next = createBlankLink();
    setDraft((current) => ({
      ...current,
      links: [...current.links, next],
    }));
    setActiveLinkId(next.id);
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

  const handleNext = async (overrideDraft?: ResumeDraft) => {
    if (dynamicLoading) return;

    const current = steps[currentStep];
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
          label: `Include "${skill}" from your import?`,
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

    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
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

  const handleArrayContinue = (kind: Step["kind"]) => {
    if (kind === "experience") {
      const active = draft.experiences.find(
        (item) => item.id === activeExperienceId,
      );
      if (!active || isExperienceEmpty(active)) return;
      addExperience();
      return;
    }
    if (kind === "education") {
      const active = draft.education.find(
        (item) => item.id === activeEducationId,
      );
      if (!active || isEducationEmpty(active)) return;
      addEducation();
      return;
    }
    if (kind === "links") {
      const active = draft.links.find((item) => item.id === activeLinkId);
      if (!active || isLinkEmpty(active)) return;
      addLink();
    }
  };

  const handleArrayDone = () => {
    const cleaned = cleanDraft(draft);
    setDraft(cleaned);
    void handleNext(cleaned);
  };

  const current = steps[currentStep];
  const isArrayStep =
    current.kind === "experience" ||
    current.kind === "education" ||
    current.kind === "links";
  const hasDraftData = Boolean(
    (draft.profile.fullName ?? "").trim() ||
      (draft.profile.headline ?? "").trim() ||
      (draft.profile.targetRole ?? "").trim() ||
      (draft.profile.jobField ?? "").trim() ||
      (draft.profile.jobType ?? "").trim() ||
      (draft.profile.email ?? "").trim() ||
      (draft.profile.location ?? "").trim() ||
      (draft.profile.summary ?? "").trim() ||
      draft.skills.length > 0 ||
      draft.experiences.some((item) => !isExperienceEmpty(item)) ||
      draft.education.some((item) => !isEducationEmpty(item)) ||
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
    draft.profile.headline || draft.profile.targetRole || "Your headline",
    draft.profile.jobField || "Target field",
    draft.profile.jobType || "Job type",
    draft.profile.location || "Location",
  ].join(" | ");
  const nextLabel = dynamicLoading
    ? "Generating..."
    : currentStep === steps.length - 1
      ? "Finish"
      : "Continue";
  const activeExperienceIndex = draft.experiences.findIndex(
    (item) => item.id === activeExperienceId,
  );
  const activeExperience =
    activeExperienceIndex >= 0 ? draft.experiences[activeExperienceIndex] : null;
  const activeEducationIndex = draft.education.findIndex(
    (item) => item.id === activeEducationId,
  );
  const activeEducation =
    activeEducationIndex >= 0 ? draft.education[activeEducationIndex] : null;
  const activeLinkIndex = draft.links.findIndex(
    (item) => item.id === activeLinkId,
  );
  const activeLink = activeLinkIndex >= 0 ? draft.links[activeLinkIndex] : null;

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
        (item) => `${item.school.toLowerCase()}::${item.degree.toLowerCase()}`,
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

  const scrapeLabel =
    scrapeState === "queued"
      ? "Queued..."
      : scrapeState === "running"
        ? "Scraping..."
        : "Import LinkedIn";

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
                      className={`absolute inset-y-1 w-1/2 rounded-full bg-[var(--surface)] shadow-sm transition-transform duration-300 ${
                        importMode === "linkedin"
                          ? "translate-x-0"
                          : "translate-x-full"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setImportMode("linkedin")}
                      className={`relative z-10 rounded-full px-4 py-1 transition-colors ${
                        importMode === "linkedin"
                          ? "text-[var(--text)]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      LinkedIn
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode("resume")}
                      className={`relative z-10 rounded-full px-4 py-1 transition-colors ${
                        importMode === "resume"
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
                    className={`flex w-[200%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      importMode === "linkedin"
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
                            {scrapeQueuePosition
                              ? ` · #${scrapeQueuePosition}`
                              : ""}
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

        {hasStarted && (
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
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Focus
                  </p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">
                    {current.label}
                  </p>
                  <div className="mt-4 space-y-2 text-xs text-[var(--muted)]">
                    <div className="flex items-center justify-between">
                      <span>Progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-[var(--muted)]">
                    Source: {scraped ? "Imported + edits" : "Your edits"}
                  </div>
                </aside>

                <div className="space-y-6 lg:pr-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                      {current.kind === "review" ? "Finalize" : "Question"}
                    </p>
                    <h3 className="font-display mt-2 text-2xl font-semibold">
                      {current.label}
                    </h3>
                    {current.hint && (
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
                      <textarea
                        value={draft.profile[current.field]}
                        onChange={(event) =>
                          updateProfileField(current.field, event.target.value)
                        }
                        placeholder={current.placeholder}
                        className="input-base w-full min-h-[140px] resize-none"
                      />
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
                        <div className="space-y-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                            Jobs
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {draft.experiences
                              .filter((item) => !isExperienceEmpty(item))
                              .map((experience) => {
                                const label =
                                  experience.title && experience.company
                                    ? `${experience.title} \u00b7 ${experience.company}`
                                    : experience.title ||
                                      experience.company ||
                                      "Untitled job";
                                const isActive =
                                  experience.id === activeExperienceId;
                                return (
                                  <button
                                    key={experience.id}
                                    type="button"
                                    onClick={() =>
                                      setActiveExperienceId(experience.id)
                                    }
                                    className={
                                      isActive
                                        ? "rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]"
                                        : "rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)]"
                                    }
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                          </div>
                          <div className="space-y-2">
                            <input
                              value={experienceSearch}
                              onChange={(event) =>
                                setExperienceSearch(event.target.value)
                              }
                              onKeyDown={handleExperienceSearchKeyDown}
                              placeholder="Search or add a job (e.g. Designer at Atlas)"
                              className="input-base w-full"
                            />
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
                        </div>

                        {activeExperience ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <input
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
                            <textarea
                              value={activeExperience.summary ?? ""}
                              onChange={(event) =>
                                updateExperience(
                                  activeExperienceIndex,
                                  "summary",
                                  event.target.value,
                                )
                              }
                              placeholder="Summarize what you did. We draft the bullet points."
                              className="input-base w-full min-h-[110px] resize-none"
                            />
                            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                              <span>AI will turn this into bullets.</span>
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
                            Add your first job to continue.
                          </p>
                        )}
                      </div>
                    ) : null}

                    {current.kind === "education" ? (
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                            Schools
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {draft.education
                              .filter((item) => !isEducationEmpty(item))
                              .map((edu) => {
                                const label =
                                  edu.school || edu.degree || "Untitled";
                                const isActive = edu.id === activeEducationId;
                                return (
                                  <button
                                    key={edu.id}
                                    type="button"
                                    onClick={() => setActiveEducationId(edu.id)}
                                    className={
                                      isActive
                                        ? "rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]"
                                        : "rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)]"
                                    }
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                          </div>
                          <div className="space-y-2">
                            <input
                              value={educationSearch}
                              onChange={(event) =>
                                setEducationSearch(event.target.value)
                              }
                              onKeyDown={handleEducationSearchKeyDown}
                              placeholder="Search or add a school"
                              className="input-base w-full"
                            />
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
                            Add your first school to continue.
                          </p>
                        )}
                      </div>
                    ) : null}

                    {current.kind === "links" ? (
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                            Links
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {draft.links
                              .filter((item) => !isLinkEmpty(item))
                              .map((link) => {
                                const label = link.label || link.url || "Link";
                                const isActive = link.id === activeLinkId;
                                return (
                                  <button
                                    key={link.id}
                                    type="button"
                                    onClick={() => setActiveLinkId(link.id)}
                                    className={
                                      isActive
                                        ? "rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]"
                                        : "rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)]"
                                    }
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                          </div>
                          <div className="space-y-2">
                            <input
                              value={linkSearch}
                              onChange={(event) =>
                                setLinkSearch(event.target.value)
                              }
                              onKeyDown={handleLinkSearchKeyDown}
                              placeholder="Paste a link and press Enter"
                              className="input-base w-full"
                            />
                            {linkSuggestions.length > 0 && (
                              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
                                {linkSuggestions.slice(0, 5).map((item) => (
                                  <button
                                    key={item.url}
                                    type="button"
                                    onClick={() => {
                                      addLinkItem(item);
                                      setLinkSearch("");
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
                            Add a link to continue.
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
                          Include skill
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
                          <div className="space-y-2">
                            <p className="text-sm font-semibold">
                              Polish with AI
                            </p>
                            <p className="text-xs text-[var(--muted)]">
                              Optional. Rewrite summary and highlights with a
                              stronger story.
                            </p>
                          </div>
                          <div className="mt-3 space-y-3">
                            <textarea
                              value={polishPrompt}
                              onChange={(event) =>
                                setPolishPrompt(event.target.value)
                              }
                              placeholder="Tone or focus (e.g. executive, emphasize automation, crisp bullets)"
                              className="input-base w-full min-h-[90px] resize-none"
                            />
                            <button
                              type="button"
                              onClick={handlePolish}
                              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={polishState === "loading"}
                            >
                              {polishState === "loading"
                                ? "Regenerating..."
                                : "Regenerate with AI"}
                            </button>
                            {polishError && (
                              <p className="text-xs text-red-500">
                                {polishError}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
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
                        </div>
                        {exportError && (
                          <p className="text-xs text-red-500">{exportError}</p>
                        )}
                        <p className="text-xs text-[var(--muted)]">
                          You can edit any step after export.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {dynamicLoading && current.kind === "links" && (
                    <p className="text-sm text-[var(--muted)]">
                      Creating tailored questions based on your answers...
                    </p>
                  )}

                  {current.kind !== "confirm-skill" && (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={handleBack}
                        className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={currentStep === 0}
                      >
                        Back
                      </button>
                      {isArrayStep ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleArrayContinue(current.kind)}
                            className="btn-secondary"
                          >
                            Continue
                          </button>
                          <button
                            type="button"
                            onClick={handleArrayDone}
                            className="btn-primary"
                          >
                            Done
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleNext}
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
          </section>
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

  const suggested = suggestions.filter(
    (skill) => !value.map(normalizeSkill).includes(normalizeSkill(skill)),
  );

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
            Imported
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Tap to add
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

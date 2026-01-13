import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "~/env";
import { resumeDraftSchema } from "~/lib/resume/types";
import {
  resolveResumeTheme,
  resumeThemeSchema,
} from "~/server/services/resume-theme";
import { buildResumeDocx } from "~/server/services/resume-docx";
import { buildResumePdf } from "~/server/services/resume-pdf";

export const runtime = "nodejs";

const DEFAULT_SITE_PROMPT =
  "Create a bold one-page portfolio with strong typography, high-contrast colors, and tasteful motion for a senior product designer.";

const requestSchema = z.object({
  markdown: z.string().min(1),
  text: z.string().min(1),
  draft: resumeDraftSchema,
  theme: resumeThemeSchema.optional(),
  slug: z.string().optional(),
  prompt: z.string().optional(),
});

const normalizeSlug = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const normalized = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 48);
  return normalized;
};

const resolvePath = (value: string) =>
  path.isAbsolute(value) ? value : path.join(process.cwd(), value);

const parseHeadshotDataUrl = (value: string) => {
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/.exec(value);
  return match?.[1] ?? "";
};

const fetchHeadshotBase64 = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      return "";
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length ? buffer.toString("base64") : "";
  } catch {
    return "";
  }
};

const resolveHeadshotBase64 = async (headshotUrl: string) => {
  const trimmed = headshotUrl.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) {
    return parseHeadshotDataUrl(trimmed);
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return fetchHeadshotBase64(trimmed);
  }
  if (trimmed.startsWith("//")) {
    return fetchHeadshotBase64(`https:${trimmed}`);
  }
  return "";
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 },
    );
  }

  const slug = normalizeSlug(parsed.data.slug ?? "");
  if (!slug) {
    return NextResponse.json(
      { error: "Provide a site slug to continue." },
      { status: 400 },
    );
  }

  const markdownPath =
    env.SITE_GENERATOR_RESUME_MARKDOWN_PATH ?? "public/resume/resume.md";
  const resolvedMarkdownPath = resolvePath(markdownPath);
  const outputDir = path.dirname(resolvedMarkdownPath);

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolvedMarkdownPath, parsed.data.markdown, "utf-8");
  await writeFile(
    path.join(outputDir, "resume.txt"),
    parsed.data.text,
    "utf-8",
  );

  let docxBuffer: Buffer;
  let pdfBuffer: Buffer;
  try {
    const theme =
      parsed.data.theme ?? (await resolveResumeTheme(parsed.data.draft));
    docxBuffer = await buildResumeDocx(parsed.data.draft, theme);
    pdfBuffer = await buildResumePdf(parsed.data.draft, theme);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not generate resume exports.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await writeFile(path.join(outputDir, "resume.docx"), docxBuffer);
  await writeFile(path.join(outputDir, "resume.pdf"), pdfBuffer);

  const archive = new JSZip();

  archive.file("resume.md", parsed.data.markdown);
  archive.file("resume.txt", parsed.data.text);
  archive.file("resume.docx", docxBuffer);
  archive.file("resume.pdf", pdfBuffer);
  const resumeArchiveBase64 = await archive.generateAsync({ type: "base64" });

  const jobsUrl = env.SITE_GENERATOR_JOBS_URL ?? "http://localhost:3814/jobs";
  const templatePath = env.SITE_GENERATOR_TEMPLATE_PATH;
  if (!templatePath) {
    return NextResponse.json(
      { error: "SITE_GENERATOR_TEMPLATE_PATH is not configured." },
      { status: 500 },
    );
  }
  const resolvedTemplatePath = resolvePath(templatePath);
  const adminBaseUrl =
    env.SITE_GENERATOR_ADMIN_BASE_URL ?? "https://admin.mog.garden";
  const organizationId =
    env.SITE_GENERATOR_ORGANIZATION_ID ?? "cmkaxz9zm00013t99nlhos4k4";
  const domainBase = env.SITE_GENERATOR_DOMAIN_BASE ?? "mog.garden";
  const repoProvider = env.SITE_GENERATOR_REPO_PROVIDER ?? "gitea";
  const giteaBaseUrl =
    env.SITE_GENERATOR_GITEA_BASE_URL ?? "https://gitea.mog.garden";
  const defaultBranch = env.SITE_GENERATOR_DEFAULT_BRANCH ?? "main";
  const buildCommand = env.SITE_GENERATOR_BUILD_COMMAND ?? "pnpm build";
  const deployMode = env.SITE_GENERATOR_DEPLOY_MODE ?? "server";
  const prompt =
    parsed.data.prompt?.trim() ??
    env.SITE_GENERATOR_PROMPT ??
    DEFAULT_SITE_PROMPT;
  const headshotBase64 = await resolveHeadshotBase64(
    parsed.data.draft.profile.headshotUrl ?? "",
  );

  const payload = {
    prompt,
    templatePath: resolvedTemplatePath,
    codexMode: "output",
    themeConfigStrategy: "data",
    promptFromResume: true,
    resumeMarkdownPath: resolvedMarkdownPath,
    publishEnabled: true,
    resumeArchiveBase64,
    ...(headshotBase64 ? { headshotBase64 } : {}),
    publish: {
      adminBaseUrl,
      organizationId,
      slug,
      domains: [`${slug}.${domainBase}`],
      repoProvider,
      giteaBaseUrl,
      repoName: slug,
      defaultBranch,
      buildCommand,
      deployMode,
    },
  };

  console.log("res", resumeArchiveBase64.length);

  const response = await fetch(jobsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    return NextResponse.json(
      { error: errorBody?.error ?? "Site generation failed." },
      { status: 502 },
    );
  }

  const data = (await response.json().catch(() => null)) as unknown;
  return NextResponse.json({
    job: data,
    slug,
    domain: `${slug}.${domainBase}`,
    resumeMarkdownPath: resolvedMarkdownPath,
  });
}

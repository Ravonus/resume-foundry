import { NextResponse } from "next/server";

import { scrapedProfileSchema, type ScrapedProfile } from "~/lib/resume/types";
import { extractLinkedInProfile } from "~/server/services/linkedin-extractor";
import { getLinkedInScrapeJob } from "~/server/services/linkedin-scraper";

const CACHE_TTL_MS = 1000 * 60 * 30;
const normalizedCache = new Map<string, { profile: ScrapedProfile; ts: number }>();
const inFlight = new Map<string, Promise<ScrapedProfile>>();

const readCachedProfile = (jobId: string) => {
  const entry = normalizedCache.get(jobId);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    normalizedCache.delete(jobId);
    return null;
  }
  return entry.profile;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing job id." }, { status: 400 });
  }

  try {
    const job = await getLinkedInScrapeJob(jobId);

    if (job.status !== "succeeded") {
      return NextResponse.json(job);
    }

    const cached = readCachedProfile(jobId);
    if (cached) {
      return NextResponse.json({ ...job, profile: cached });
    }

    if (job.result?.profile) {
      const parsed = scrapedProfileSchema.safeParse(job.result.profile);
      if (parsed.success) {
        normalizedCache.set(jobId, { profile: parsed.data, ts: Date.now() });
        return NextResponse.json({ ...job, profile: parsed.data });
      }
    }

    const rawText = job.result?.raw?.text ?? "";
    const rawHtml = job.result?.raw?.html ?? "";
    const rawHtmlBySection = job.result?.raw?.detailsHtml;
    const rawDetails = job.result?.raw?.detailsData;
    if (!rawText && !rawHtml) {
      return NextResponse.json(
        { error: "Scraper returned no usable content.", status: "failed" },
        { status: 502 },
      );
    }

    const existingPromise = inFlight.get(jobId);
    const profilePromise =
      existingPromise ??
      extractLinkedInProfile({
        rawText,
        rawHtml,
        rawHtmlBySection,
        rawDetails,
        url: "linkedin-scrape",
      });
    if (!existingPromise) {
      inFlight.set(jobId, profilePromise);
    }

    let profile: ScrapedProfile;
    try {
      profile = await profilePromise;
    } finally {
      if (!existingPromise) {
        inFlight.delete(jobId);
      }
    }
    const validated = scrapedProfileSchema.safeParse(profile);
    if (!validated.success) {
      return NextResponse.json(
        { error: "We could not normalize that profile.", status: "failed" },
        { status: 502 },
      );
    }

    normalizedCache.set(jobId, { profile: validated.data, ts: Date.now() });
    return NextResponse.json({ ...job, profile: validated.data });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "We could not read that scrape status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

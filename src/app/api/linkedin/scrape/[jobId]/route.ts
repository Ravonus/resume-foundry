import { NextResponse } from "next/server";

import { scrapedProfileSchema } from "~/lib/resume/types";
import { extractLinkedInProfile } from "~/server/services/linkedin-extractor";
import { getLinkedInScrapeJob } from "~/server/services/linkedin-scraper";

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

    if (job.result?.profile) {
      const parsed = scrapedProfileSchema.safeParse(job.result.profile);
      if (parsed.success) {
        return NextResponse.json({ ...job, profile: parsed.data });
      }
    }

    const rawText = job.result?.raw?.text ?? job.result?.raw?.html;
    if (!rawText) {
      return NextResponse.json(
        { error: "Scraper returned no usable content.", status: "failed" },
        { status: 502 },
      );
    }

    const profile = await extractLinkedInProfile({
      rawText,
      url: "linkedin-scrape",
    });
    const validated = scrapedProfileSchema.safeParse(profile);
    if (!validated.success) {
      return NextResponse.json(
        { error: "We could not normalize that profile.", status: "failed" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ...job, profile: validated.data });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "We could not read that scrape status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

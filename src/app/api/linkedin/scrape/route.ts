import { NextResponse } from "next/server";

import { z } from "zod";

import { env } from "~/env";

const scrapeJobSchema = z.object({
  jobId: z.string(),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "requires_login",
    "canceled",
  ]),
  position: z.number().nullable().optional(),
  etaMs: z.number().optional(),
});

const scraperBaseUrl = () =>
  env.LINKEDIN_SCRAPER_URL ?? "http://localhost:5150";

console.log("LINKEDIN_SCRAPER_URL:", scraperBaseUrl());

const buildScraperRequest = (url: string) => ({
  url,
  options: {
    stealth: true,
    screenshot: false,
    waitFor: "domcontentloaded",
    autoScroll: true,
    expandDetails: true,
  },
});

export type ScrapeJobInfo = z.infer<typeof scrapeJobSchema>;

const queueLinkedInScrape = async (url: string): Promise<ScrapeJobInfo> => {
  const controller = new AbortController();
  const timeoutMs = env.LINKEDIN_SCRAPER_TIMEOUT_MS ?? 50000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${scraperBaseUrl()}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.LINKEDIN_SCRAPER_API_KEY
          ? { Authorization: `Bearer ${env.LINKEDIN_SCRAPER_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(buildScraperRequest(url)),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: string }).error)
          : "LinkedIn scrape request failed.";
      throw new Error(message);
    }

    const parsed = scrapeJobSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Scraper returned an unexpected payload.");
    }

    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    url?: string;
  } | null;
  const url = body?.url?.trim();

  if (!url) {
    return NextResponse.json(
      { error: "A LinkedIn URL is required." },
      { status: 400 },
    );
  }

  if (!url.includes("linkedin.com")) {
    return NextResponse.json(
      { error: "Please provide a valid LinkedIn profile URL." },
      { status: 400 },
    );
  }

  try {
    const job = await queueLinkedInScrape(url);
    return NextResponse.json(job);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "We could not queue that profile.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

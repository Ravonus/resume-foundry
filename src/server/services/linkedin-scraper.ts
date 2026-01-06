import { z } from "zod";

import { env } from "~/env";
import { scrapedProfileSchema } from "~/lib/resume/types";

const scraperResponseSchema = z
  .object({
    profile: scrapedProfileSchema.optional(),
    raw: z
      .object({
        html: z.string().optional(),
        text: z.string().optional(),
        screenshotUrl: z.string().url().optional(),
        detailsHtml: z.record(z.string()).optional(),
        detailsData: z.record(z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();

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

const scrapeStatusSchema = scrapeJobSchema.extend({
  result: scraperResponseSchema.optional(),
  error: z.string().optional(),
  createdAt: z.number().optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
});

const scraperBaseUrl = () =>
  env.LINKEDIN_SCRAPER_URL ?? "http://localhost:5150";

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
export type ScrapeJobStatus = z.infer<typeof scrapeStatusSchema>;

export const queueLinkedInScrape = async (
  url: string,
): Promise<ScrapeJobInfo> => {
  const controller = new AbortController();
  const timeoutMs = env.LINKEDIN_SCRAPER_TIMEOUT_MS ?? 20000;
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

export const getLinkedInScrapeJob = async (
  jobId: string,
): Promise<ScrapeJobStatus> => {
  const controller = new AbortController();
  const timeoutMs = env.LINKEDIN_SCRAPER_TIMEOUT_MS ?? 20000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${scraperBaseUrl()}/scrape/${jobId}`, {
      headers: {
        ...(env.LINKEDIN_SCRAPER_API_KEY
          ? { Authorization: `Bearer ${env.LINKEDIN_SCRAPER_API_KEY}` }
          : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Scrape status request failed.");
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const parsed = scrapeStatusSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Scraper returned an unexpected payload.");
    }

    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
};

export type ScrapeOptions = {
  stealth?: boolean;
  waitFor?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  screenshot?: boolean;
  autoScroll?: boolean;
  expandDetails?: boolean;
  proxy?: string;
  userAgent?: string;
  locale?: string;
};

export type ScrapeRequest = {
  url: string;
  options?: ScrapeOptions;
  callbackUrl?: string;
};

export type ScrapeResult = {
  profile?: unknown;
  raw?: {
    html?: string;
    text?: string;
    screenshotUrl?: string;
  };
};

export type ScrapeJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "requires_login"
  | "canceled";

export type ScrapeJob = {
  id: string;
  url: string;
  options: ScrapeOptions;
  status: ScrapeJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: ScrapeResult;
  error?: string;
  callbackUrl?: string;
};

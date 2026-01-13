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
    detailsHtml?: Record<string, string>;
    detailsData?: {
      profile?: {
        fullName?: string;
        headline?: string;
        location?: string;
        summary?: string;
      };
      experiences?: Array<{
        id?: string;
        title?: string;
        company?: string;
        location?: string;
        startDate?: string;
        endDate?: string;
        summary?: string;
        highlights?: string[];
      }>;
      education?: Array<{
        id?: string;
        school?: string;
        degree?: string;
        field?: string;
        startDate?: string;
        endDate?: string;
        notes?: string;
      }>;
      projects?: Array<{
        id?: string;
        name?: string;
        role?: string;
        description?: string;
        startDate?: string;
        endDate?: string;
        url?: string;
      }>;
      certifications?: Array<{
        id?: string;
        name?: string;
        issuer?: string;
        issueDate?: string;
        expirationDate?: string;
        credentialId?: string;
        credentialUrl?: string;
      }>;
      honors?: Array<{
        id?: string;
        title?: string;
        issuer?: string;
        date?: string;
        description?: string;
      }>;
      volunteering?: Array<{
        id?: string;
        role?: string;
        organization?: string;
        cause?: string;
        startDate?: string;
        endDate?: string;
        summary?: string;
      }>;
      services?: Array<{
        id?: string;
        name?: string;
        description?: string;
      }>;
      skills?: Array<{
        name: string;
        endorsements?: number;
      }>;
      recommendations?: string[];
    };
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

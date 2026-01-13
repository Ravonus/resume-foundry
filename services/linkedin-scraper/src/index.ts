import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import cors from "cors";
import express from "express";
import type { BrowserContext } from "playwright";
import { z } from "zod";

import { checkLinkedInAuth, type AuthCheckResult } from "./auth-check";
import { ScrapeQueue } from "./queue";
import {
  clearStorageState,
  hasStorageState,
  saveStorageState,
} from "./storage-state";
import type { ScrapeRequest } from "./types";

const app = express();
const port = Number.parseInt(process.env.SCRAPER_PORT ?? "5150", 10);
const concurrency = Number.parseInt(process.env.SCRAPER_CONCURRENCY ?? "2", 10);
const queueLimit = Number.parseInt(
  process.env.SCRAPER_QUEUE_LIMIT ?? "200",
  10,
);
const jobTtlMs = Number.parseInt(
  process.env.SCRAPER_JOB_TTL_MS ?? "3600000",
  10,
);
const screenshotDir = process.env.SCRAPER_SCREENSHOT_DIR
  ? resolve(process.env.SCRAPER_SCREENSHOT_DIR)
  : null;
const adminToken = process.env.SCRAPER_ADMIN_TOKEN;
const authCheckInterval = Number.parseInt(
  process.env.SCRAPER_AUTH_CHECK_INTERVAL_MS ?? "3600000",
  10,
);
const alertWebhook = process.env.SCRAPER_ALERT_WEBHOOK;

if (screenshotDir) {
  void mkdir(screenshotDir, { recursive: true });
  app.use("/screenshots", express.static(screenshotDir));
}

const queue = new ScrapeQueue({
  concurrency,
  queueLimit,
  jobTtlMs,
});

let lastAuthStatus: AuthCheckResult | null = null;

const authorize = (req: express.Request) => {
  if (!adminToken) return true;
  const headerToken = req.headers["x-scraper-admin-token"];
  const queryToken = req.query?.token;
  const candidate =
    (typeof headerToken === "string" && headerToken) ||
    (typeof queryToken === "string" && queryToken);
  return candidate === adminToken;
};

const notifyAdmin = async (payload: AuthCheckResult) => {
  if (!alertWebhook) return;
  try {
    await fetch(alertWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore webhook errors
  }
};

const runAuthCheck = async () => {
  const result = await checkLinkedInAuth();
  const shouldNotify =
    !lastAuthStatus ||
    lastAuthStatus.status !== result.status ||
    (result.status !== "ok" && lastAuthStatus.status === "ok");
  lastAuthStatus = result;
  if (shouldNotify && result.status !== "ok") {
    await notifyAdmin(result);
  }
};

const requestSchema = z.object({
  url: z.string().url(),
  options: z
    .object({
      stealth: z.boolean().optional(),
      waitFor: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
      timeoutMs: z.number().optional(),
      screenshot: z.boolean().optional(),
      autoScroll: z.boolean().optional(),
      expandDetails: z.boolean().optional(),
      proxy: z.string().optional(),
      userAgent: z.string().optional(),
      locale: z.string().optional(),
    })
    .optional(),
  callbackUrl: z.string().url().optional(),
});

const sessionSchema = z.object({
  liAt: z.string().optional(),
  jsessionId: z.string().optional(),
  storageState: z.union([z.string(), z.record(z.unknown())]).optional(),
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/metrics", (_req, res) => {
  const snapshot = queue.snapshot();
  res.json(snapshot);
});

app.get("/auth/status", async (req, res) => {
  if (!authorize(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const hasSession = await hasStorageState();
  res.json({
    hasSession,
    lastCheck: lastAuthStatus,
  });
});

app.get("/admin", async (req, res) => {
  if (!authorize(req)) {
    res.status(401).send("Unauthorized");
    return;
  }

  res.setHeader("Content-Type", "text/html");
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LinkedIn Scraper Admin</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f6f7f9; color: #1b1e24; }
      .card { max-width: 720px; margin: 40px auto; background: #fff; padding: 24px; border-radius: 16px; box-shadow: 0 12px 30px -20px rgba(0,0,0,0.35); }
      h1 { font-size: 20px; margin-bottom: 12px; }
      label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.18em; color: #6b7280; }
      input, textarea { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #d1d5db; margin-top: 6px; }
      button { margin-top: 12px; padding: 10px 16px; border-radius: 10px; border: none; background: #1f5c7a; color: #fff; font-weight: 600; cursor: pointer; }
      .muted { color: #6b7280; font-size: 12px; margin-top: 8px; }
      .row { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; }
      @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>LinkedIn Auth Session</h1>
      <p class="muted">Paste cookies or a Playwright storage state JSON.</p>
      <form method="post" action="/auth/session">
        <div class="row">
          <div>
            <label for="liAt">li_at cookie</label>
            <input id="liAt" name="liAt" type="text" />
          </div>
          <div>
            <label for="jsessionId">JSESSIONID cookie</label>
            <input id="jsessionId" name="jsessionId" type="text" />
          </div>
        </div>
        <div style="margin-top:16px;">
          <label for="storageState">Storage state JSON</label>
          <textarea id="storageState" name="storageState" rows="8"></textarea>
        </div>
        <button type="submit">Save session</button>
      </form>
      <form method="post" action="/auth/session/clear">
        <button type="submit" style="background:#6b7280;margin-top:16px;">Clear session</button>
      </form>
    </div>
  </body>
</html>`);
});

app.post("/auth/check", async (req, res) => {
  if (!authorize(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const result = await checkLinkedInAuth();
  lastAuthStatus = result;
  res.json(result);
});

app.post("/auth/session", async (req, res) => {
  if (!authorize(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid session payload." });
    return;
  }

  const { liAt, jsessionId, storageState } = parsed.data;
  if (!storageState && !liAt && !jsessionId) {
    res.status(400).json({ error: "Provide storageState or cookies." });
    return;
  }

  if (storageState) {
    try {
      const state =
        typeof storageState === "string"
          ? JSON.parse(storageState)
          : storageState;
      await saveStorageState(
        state as Awaited<ReturnType<BrowserContext["storageState"]>>,
      );
      res.json({ ok: true, source: "storageState" });
      return;
    } catch {
      res.status(400).json({ error: "Invalid storageState JSON." });
      return;
    }
  }

  const cookies = [
    liAt
      ? {
          name: "li_at",
          value: liAt,
          domain: ".linkedin.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax" as const,
        }
      : null,
    jsessionId
      ? {
          name: "JSESSIONID",
          value: jsessionId,
          domain: ".linkedin.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax" as const,
        }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  await saveStorageState({
    cookies,
    origins: [{ origin: "https://www.linkedin.com", localStorage: [] }],
  });

  res.json({ ok: true, source: "cookies" });
});

app.post("/auth/session/clear", async (req, res) => {
  if (!authorize(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const cleared = await clearStorageState();
  res.json({ ok: cleared });
});

app.post("/scrape", (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scrape request." });
    return;
  }

  try {
    const job = queue.enqueue(parsed.data as ScrapeRequest);
    res.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue full.";
    res.status(429).json({ error: message });
  }
});

app.get("/scrape/:id", (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    position: queue.position(job.id),
    result: job.result,
    error: job.error,
  });
});

app.post("/scrape/:id/cancel", (req, res) => {
  const canceled = queue.cancel(req.params.id);
  res.json({ canceled });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`LinkedIn scraper listening on ${port}`);
});

setTimeout(() => {
  void runAuthCheck();
  setInterval(runAuthCheck, authCheckInterval);
}, 5000);

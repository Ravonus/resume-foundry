import { randomUUID } from "node:crypto";

import { resolveProxy } from "./proxy";
import { scrapeLinkedIn } from "./scraper";
import type { ScrapeJob, ScrapeOptions, ScrapeRequest, ScrapeResult } from "./types";

type QueueConfig = {
  concurrency: number;
  queueLimit: number;
  jobTtlMs: number;
};

type QueueSnapshot = {
  running: number;
  queued: number;
  avgDurationMs: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export class ScrapeQueue {
  private jobs = new Map<string, ScrapeJob>();
  private queue: string[] = [];
  private running = 0;
  private avgDurationMs = 12000;
  private cleanupTimer: NodeJS.Timeout;

  constructor(private config: QueueConfig) {
    this.cleanupTimer = setInterval(() => this.cleanup(), config.jobTtlMs);
  }

  enqueue(request: ScrapeRequest) {
    if (this.queue.length + this.running >= this.config.queueLimit) {
      throw new Error("Scraper queue is full. Try again shortly.");
    }

    const id = randomUUID();
    const options = request.options ?? {};
    const job: ScrapeJob = {
      id,
      url: request.url,
      options,
      status: "queued",
      createdAt: Date.now(),
      callbackUrl: request.callbackUrl,
    };

    this.jobs.set(id, job);
    this.queue.push(id);
    this.schedule();

    return {
      jobId: id,
      status: job.status,
      position: this.queue.indexOf(id) + 1,
      etaMs: Math.round((this.queue.indexOf(id) + 1) * this.avgDurationMs),
    };
  }

  get(id: string) {
    return this.jobs.get(id) ?? null;
  }

  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "queued") return false;
    this.queue = this.queue.filter((item) => item !== id);
    job.status = "canceled";
    job.finishedAt = Date.now();
    return true;
  }

  snapshot(): QueueSnapshot {
    return {
      running: this.running,
      queued: this.queue.length,
      avgDurationMs: this.avgDurationMs,
    };
  }

  position(id: string) {
    const index = this.queue.indexOf(id);
    return index >= 0 ? index + 1 : null;
  }

  stop() {
    clearInterval(this.cleanupTimer);
  }

  private schedule() {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) break;
      void this.runJob(id);
    }
  }

  private async runJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.status !== "queued") return;

    job.status = "running";
    job.startedAt = Date.now();
    this.running += 1;

    try {
      const result = await this.scrape(job);
      job.result = result;
      job.status = "succeeded";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scrape failed.";
      if (message === "AUTH_WALL") {
        job.status = "requires_login";
        job.error = "AUTH_WALL";
      } else {
        job.status = "failed";
        job.error = message;
      }
    } finally {
      job.finishedAt = Date.now();
      const duration = job.finishedAt - (job.startedAt ?? job.createdAt);
      this.avgDurationMs = clamp(
        Math.round(this.avgDurationMs * 0.8 + duration * 0.2),
        4000,
        90000,
      );
      this.running -= 1;
      this.schedule();
      void this.notify(job);
    }
  }

  private async scrape(job: ScrapeJob): Promise<ScrapeResult> {
    const proxy = resolveProxy(job.options.proxy);
    return scrapeLinkedIn({
      id: job.id,
      url: job.url,
      options: job.options,
      proxy,
    });
  }

  private async notify(job: ScrapeJob) {
    if (!job.callbackUrl) return;
    const payload = {
      jobId: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
    };

    try {
      await fetch(job.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Swallow callback errors to avoid retry loops.
    }
  }

  private cleanup() {
    const cutoff = Date.now() - this.config.jobTtlMs;
    for (const [id, job] of this.jobs) {
      if (!job.finishedAt) continue;
      if (job.finishedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}

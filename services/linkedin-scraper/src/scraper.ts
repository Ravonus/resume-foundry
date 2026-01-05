import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, type BrowserContext } from "playwright";

import { isAuthWall } from "./auth-wall";
import { loadStorageState } from "./storage-state";
import type { ScrapeOptions, ScrapeResult } from "./types";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const applyStealth = async (page: { addInitScript: (fn: () => void) => void }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });
  });
};

const autoScrollPage = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
  waitForTimeout: (ms: number) => Promise<void>;
}) => {
  let previousHeight = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    });
    await page.waitForTimeout(600);
    const nextHeight = await page.evaluate(() => document.body.scrollHeight);
    if (nextHeight === previousHeight) break;
    previousHeight = nextHeight;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
};

const expandTextBlocks = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  await page.evaluate(() => {
    const labels = ["see more", "show more"];
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );
    for (const button of buttons) {
      const text = button.innerText?.toLowerCase() ?? "";
      const aria = button.getAttribute("aria-label")?.toLowerCase() ?? "";
      if (labels.some((label) => text.includes(label) || aria.includes(label))) {
        button.click();
      }
    }
  });
};

const safeGoto = async (
  page: {
    goto: (
      url: string,
      options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number },
    ) => Promise<void>;
    waitForTimeout: (ms: number) => Promise<void>;
  },
  url: string,
  waitFor: "load" | "domcontentloaded" | "networkidle",
  timeoutMs: number,
) => {
  try {
    await page.goto(url, { waitUntil: waitFor, timeout: timeoutMs });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Timeout")) {
      await page.waitForTimeout(1200);
      return;
    }
    throw error;
  }
};

const buildDetailsUrls = (url: string) => {
  try {
    const parsed = new URL(url);
    const basePath = parsed.pathname.replace(/\/$/, "");
    if (!basePath.includes("/in/")) return [];
    return [
      `${parsed.origin}${basePath}/details/experience/`,
      `${parsed.origin}${basePath}/details/education/`,
      `${parsed.origin}${basePath}/details/skills/`,
    ];
  } catch {
    return [];
  }
};

const scrapeDetails = async ({
  context,
  urls,
  waitFor,
  timeoutMs,
  autoScroll,
}: {
  context: BrowserContext;
  urls: string[];
  waitFor: "load" | "domcontentloaded" | "networkidle";
  timeoutMs: number;
  autoScroll: boolean;
}) => {
  const sections: string[] = [];

  for (const detailsUrl of urls) {
    const page = await context.newPage();
    try {
      await safeGoto(page, detailsUrl, waitFor, timeoutMs);
      await page.waitForTimeout(1000);
      if (autoScroll) {
        await autoScrollPage(page);
      }
      await expandTextBlocks(page);
      const text = await page.evaluate(() => document.body.innerText);
      if (text) {
        const label = detailsUrl.split("/details/")[1]?.split("/")[0];
        sections.push(`${(label ?? "details").toUpperCase()}_DETAILS\n${text}`);
      }
    } catch {
      // ignore detail page failures
    } finally {
      await page.close();
    }
  }

  return sections;
};

const parseProxy = (proxy?: string) => {
  if (!proxy) return undefined;
  const normalized = proxy.includes("://") ? proxy : `http://${proxy}`;
  try {
    const parsed = new URL(normalized);
    const server = `${parsed.protocol}//${parsed.host}`;
    const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    return { server, username, password };
  } catch {
    return { server: normalized };
  }
};

const screenshotDir = process.env.SCRAPER_SCREENSHOT_DIR
  ? resolve(process.env.SCRAPER_SCREENSHOT_DIR)
  : null;

const ensureScreenshotDir = async () => {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
};

const writeScreenshot = async (id: string, buffer: Buffer) => {
  if (!screenshotDir) return undefined;
  await ensureScreenshotDir();
  const filename = `${id}.png`;
  const filePath = resolve(screenshotDir, filename);
  await writeFile(filePath, buffer);
  const baseUrl = process.env.SCRAPER_PUBLIC_BASE_URL;
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/$/, "")}/screenshots/${filename}`;
};

export const scrapeLinkedIn = async ({
  id,
  url,
  options,
  proxy,
}: {
  id: string;
  url: string;
  options: ScrapeOptions;
  proxy?: string;
}): Promise<ScrapeResult> => {
  const timeoutMs =
    options.timeoutMs ??
    Number.parseInt(process.env.SCRAPER_TIMEOUT_MS ?? "45000", 10);
  const waitFor = options.waitFor ?? "domcontentloaded";
  const stealth = options.stealth ?? true;
  const autoScroll = options.autoScroll ?? true;
  const expandDetails = options.expandDetails ?? true;
  const launchOptions = {
    headless: true,
    proxy: parseProxy(proxy),
  };

  const browser = await chromium.launch(launchOptions);
  try {
    const storageState = await loadStorageState();
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      locale: options.locale ?? "en-US",
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    if (stealth) {
      await applyStealth(page);
    }

    if (!options.screenshot) {
      await context.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (["image", "media", "font"].includes(resourceType)) {
          return route.abort();
        }
        return route.continue();
      });
    }

    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await safeGoto(page, url, waitFor, timeoutMs);
    await page.waitForTimeout(1200);
    if (autoScroll) {
      await autoScrollPage(page);
    }
    await expandTextBlocks(page);

    const [html, text, screenshotBuffer] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body.innerText),
      options.screenshot ? page.screenshot({ fullPage: true }) : null,
    ]);

    if (isAuthWall(html, text)) {
      throw new Error("AUTH_WALL");
    }

    const screenshotUrl =
      screenshotBuffer && Buffer.isBuffer(screenshotBuffer)
        ? await writeScreenshot(id, screenshotBuffer)
        : undefined;

    const detailSections = expandDetails
      ? await scrapeDetails({
          context,
          urls: buildDetailsUrls(url),
          waitFor,
          timeoutMs,
          autoScroll,
        })
      : [];
    const combinedText = detailSections.length
      ? [...detailSections, `PROFILE_PAGE\n${text}`].join("\n\n")
      : text;

    return {
      raw: {
        html,
        text: combinedText,
        screenshotUrl,
      },
    };
  } finally {
    await browser.close();
  }
};

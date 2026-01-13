import { chromium, type BrowserContextOptions } from "playwright";

import { isAuthWall } from "./auth-wall";
import { loadStorageState } from "./storage-state";

type AuthStatus = "ok" | "missing" | "auth_wall" | "error";

export type AuthCheckResult = {
  status: AuthStatus;
  checkedAt: number;
  error?: string;
};

export const checkLinkedInAuth = async (): Promise<AuthCheckResult> => {
  const storageState = await loadStorageState();
  if (!storageState) {
    return { status: "missing", checkedAt: Date.now() };
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: storageState as BrowserContextOptions["storageState"],
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const [html, text] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body.innerText),
    ]);

    if (isAuthWall(html, text)) {
      return { status: "auth_wall", checkedAt: Date.now() };
    }

    return { status: "ok", checkedAt: Date.now() };
  } catch (error) {
    return {
      status: "error",
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : "Auth check failed.",
    };
  } finally {
    await browser.close();
  }
};

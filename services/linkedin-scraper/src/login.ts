import { chromium } from "playwright";

import { isAuthWall } from "./auth-wall";
import { saveStorageState } from "./storage-state";

const prompt = async (message: string) => {
  process.stdout.write(message);
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
};

const pushStorageState = async (state: Record<string, unknown>) => {
  const pushUrl = process.env.SCRAPER_PUSH_URL;
  if (!pushUrl) return;
  const adminToken = process.env.SCRAPER_ADMIN_TOKEN;
  const base = pushUrl.replace(/\/$/, "");

  const response = await fetch(`${base}/auth/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "x-scraper-admin-token": adminToken } : {}),
    },
    body: JSON.stringify({ storageState: state }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Failed to push storageState: ${payload}`);
  }
};

const run = async () => {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });

    // Let the admin complete login in the opened browser window.
    await prompt("Log in to LinkedIn, then press Enter here to continue...\n");

    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1500);

    const [html, text] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body.innerText),
    ]);

    if (isAuthWall(html, text)) {
      // Exit without saving to avoid persisting a bad session.
      // eslint-disable-next-line no-console
      console.error(
        "Auth wall detected. Login did not succeed, session not saved.",
      );
      process.exitCode = 1;
      return;
    }

    const state = await context.storageState();
    await saveStorageState(state);
    await pushStorageState(state);
    // eslint-disable-next-line no-console
    console.log(
      "LinkedIn session saved." +
        (process.env.SCRAPER_PUSH_URL ? " Pushed to scraper." : ""),
    );
  } finally {
    await browser.close();
  }
};

void run();

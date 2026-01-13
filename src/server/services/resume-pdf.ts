import { createRequire } from "node:module";
import path from "node:path";

import { buildResumePdfHtml } from "~/lib/resume/pdf-template";
import { type ResumeDraft } from "~/lib/resume/types";
import { type ResumeTheme } from "~/server/services/resume-theme";

type ChromiumLauncher = {
  launch: (options?: Record<string, unknown>) => Promise<{
    newPage: (options?: Record<string, unknown>) => Promise<{
      setContent: (
        html: string,
        options?: Record<string, unknown>,
      ) => Promise<void>;
      pdf: (options?: Record<string, unknown>) => Promise<Uint8Array>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  }>;
};

const resolveChromium = (): ChromiumLauncher => {
  const require = createRequire(import.meta.url);
  const playwrightPath = path.join(
    process.cwd(),
    "services/linkedin-scraper/node_modules/playwright",
  );
  const resolveFromModule = (modulePath: string) => {
    const loaded = require(modulePath) as unknown;
    if (!loaded || typeof loaded !== "object") return null;
    if (!("chromium" in loaded)) return null;
    const record = loaded as { chromium?: ChromiumLauncher };
    return record.chromium ?? null;
  };
  try {
    const chromium = resolveFromModule("playwright");
    if (chromium) return chromium;
  } catch {
    // fall through to local scraper install
  }
  const chromium = resolveFromModule(playwrightPath);
  if (chromium) return chromium;

  throw new Error(
    "Playwright is required to generate PDFs. Install it in services/linkedin-scraper or add it to the app dependencies.",
  );
};

export const buildResumePdf = async (
  draft: ResumeDraft,
  theme: ResumeTheme,
) => {
  const html = buildResumePdfHtml(draft, theme);
  const chromium = resolveChromium();
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 1200 },
    });
    await page.setContent(html, { waitUntil: "networkidle" });
    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true,
    });
    await page.close();
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
};

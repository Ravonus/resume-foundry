import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
} from "playwright";

import { isAuthWall } from "./auth-wall";
import { loadStorageState } from "./storage-state";
import type { ScrapeOptions, ScrapeResult } from "./types";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const applyStealth = async (page: {
  addInitScript: (fn: () => void) => void;
}) => {
  page.addInitScript(() => {
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
    const labels = ["see more", "show more", "show all", "see all", "view all"];
    const clickable = Array.from(
      document.querySelectorAll<HTMLElement>("button, a, [role='button']"),
    );
    for (const element of clickable) {
      const text = element.innerText?.toLowerCase() ?? "";
      const aria = element.getAttribute("aria-label")?.toLowerCase() ?? "";
      if (
        labels.some((label) => text.includes(label) || aria.includes(label))
      ) {
        element.click();
      }
    }
  });
};

const extractSkillItems = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }
    function parseEndorsements(value: string) {
      const match = /\d+/.exec(value.replace(/,/g, ""));
      if (!match) return null;
      const parsed = Number.parseInt(match[0] ?? "0", 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    const results = new Map<string, { name: string; endorsements?: number }>();
    function addSkill(nameRaw: string, endorsements?: number | null) {
      const name = normalize(nameRaw);
      if (!name) return;
      const key = name.toLowerCase();
      if (!key) return;
      const existing = results.get(key);
      const nextValue = {
        name,
        endorsements:
          typeof endorsements === "number" && Number.isFinite(endorsements)
            ? endorsements
            : undefined,
      };
      if (!existing) {
        results.set(key, nextValue);
        return;
      }
      const existingCount = existing.endorsements ?? 0;
      const nextCount = nextValue.endorsements ?? 0;
      if (nextCount > existingCount) {
        results.set(key, nextValue);
      }
    }

    function isCategoryHeading(value: string) {
      const lower = value.toLowerCase();
      return (
        lower === "all" ||
        lower === "industry knowledge" ||
        lower === "tools & technologies" ||
        lower === "tools and technologies" ||
        lower === "top skills"
      );
    }

    const main = document.querySelector("main") ?? document.body;
    const scaffold =
      document.querySelector(".scaffold-finite-scroll__content") ?? main;
    const topLevelItems = Array.from(
      scaffold.querySelectorAll("li.pvs-list__paged-list-item"),
    ).filter((item) => {
      if (item.id?.toLowerCase().includes("skills")) return true;
      return Boolean(
        item.querySelector("a[data-field='skill_page_skill_topic']"),
      );
    });

    const items =
      topLevelItems.length > 0
        ? topLevelItems
        : Array.from(
            scaffold.querySelectorAll(
              "li.pvs-list__paged-list-item, li.pvs-list__item--line-separated",
            ),
          );

    for (const item of items) {
      const nameEl =
        item.querySelector(
          "a[data-field='skill_page_skill_topic'] .t-bold span[aria-hidden='true']",
        ) ?? item.querySelector(".t-bold span[aria-hidden='true']");
      const name = nameEl?.textContent?.trim() ?? "";
      if (!name) continue;
      if (name.toLowerCase().includes("endorse")) continue;
      if (isCategoryHeading(name)) continue;

      const itemText = item.textContent ?? "";
      const endorsementMatch = /(\d+)\s+endorsements?/i.exec(
        itemText.replace(/,/g, ""),
      );
      const endorsements = endorsementMatch
        ? parseEndorsements(endorsementMatch[1] ?? "")
        : null;
      addSkill(name, endorsements);
    }

    return Array.from(results.values());
  });
};

const extractProfileDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    function text(value?: string | null) {
      return (value ?? "").trim();
    }
    const name =
      text(document.querySelector("h1.text-heading-xlarge")?.textContent) ||
      text(document.querySelector("h1")?.textContent);
    const headline = text(
      document.querySelector(".text-body-medium")?.textContent,
    );

    const locationCandidates = Array.from(
      document.querySelectorAll(".text-body-small"),
    )
      .map((el) => text(el.textContent))
      .filter(Boolean);
    const location =
      locationCandidates.find((value) => value.includes(",")) ??
      locationCandidates[0] ??
      "";

    let summary = "";
    const sections = Array.from(document.querySelectorAll("section"));
    const aboutSection = sections.find((section) => {
      const heading =
        section.querySelector("h2, h3, span")?.textContent?.toLowerCase() ?? "";
      return heading.includes("about");
    });
    if (aboutSection) {
      const raw = text(aboutSection.innerText || aboutSection.textContent);
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^about$/i.test(line))
        .filter((line) => !/^(see|show)\s+more$/i.test(line));
      const normalized = lines
        .map((line) => line.replace(/^about\s+/i, "").trim())
        .filter(Boolean);
      const seen = new Set<string>();
      const deduped = normalized.filter((line) => {
        const key = line.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      summary = deduped.join("\n").trim();
    }

    return { fullName: name, headline, location, summary };
  });
};

const extractExperienceDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li[id*="EXPERIENCE"]'));
    const nodes =
      items.length > 0
        ? items
        : Array.from(document.querySelectorAll("li.pvs-list__paged-list-item"));

    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }
    function parseDateRange(value: string) {
      const match =
        /(\b[A-Za-z]{3,9}\s+\d{4})\s*(?:-|to)\s*(Present|[A-Za-z]{3,9}\s+\d{4})/i.exec(
          value,
        );
      if (!match) return { startDate: "", endDate: "" };
      return { startDate: match[1] ?? "", endDate: match[2] ?? "" };
    }

    const rows = nodes
      .map((item) => {
        const title = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        const companyLine = normalize(
          item.querySelector("span.t-14.t-normal span[aria-hidden='true']")
            ?.textContent ?? "",
        );
        const company = companyLine.split("·")[0]?.trim() ?? "";
        const dateLine = normalize(
          item.querySelector(".pvs-entity__caption-wrapper")?.textContent ?? "",
        );
        const { startDate, endDate } = parseDateRange(dateLine);

        const locationCandidates = Array.from(
          item.querySelectorAll(
            "span.t-14.t-normal.t-black--light span[aria-hidden='true']",
          ),
        )
          .filter((el) => el.closest("li") === item)
          .map((el) => normalize(el.textContent ?? ""))
          .filter(Boolean);
        const location =
          locationCandidates.find((value) => !/\b\d{4}\b/.exec(value)) ?? "";

        const scopedBlocks = Array.from(
          item.querySelectorAll(
            ".pvs-entity__sub-components .t-14.t-normal.t-black",
          ),
        );
        const blocks =
          scopedBlocks.length > 0
            ? scopedBlocks
            : Array.from(item.querySelectorAll("div.t-14.t-normal.t-black"));
        const chunks = blocks.flatMap((block) => {
          const hidden = Array.from(
            block.querySelectorAll("span.visually-hidden"),
          )
            .map((el) =>
              ((el as HTMLElement).innerText || el.textContent || "").trim(),
            )
            .filter(Boolean);
          if (hidden.length > 0) return hidden;
          const visible =
            (block as HTMLElement).innerText || block.textContent || "";
          return visible ? [visible.trim()] : [];
        });

        const uniqueChunks = Array.from(
          new Set(chunks.map((value) => value.trim()).filter(Boolean)),
        );
        const description = uniqueChunks.join("\n");
        const descriptionLines = description
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const highlights = descriptionLines
          .filter((line) => /^[-*•]/.test(line))
          .map((line) => line.replace(/^[-*•]\s*/, "").trim())
          .filter(Boolean);

        return {
          id: item.id || undefined,
          title,
          company,
          location,
          startDate,
          endDate,
          summary: descriptionLines.join("\n").trim(),
          highlights,
        };
      })
      .filter((item) => item.title || item.company);

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key =
        `${item.title}|${item.company}|${item.startDate}|${item.endDate}`
          .toLowerCase()
          .trim();
      if (!key || key === "|||") return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

const extractEducationDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li[id*="EDUCATION"]'));
    const nodes =
      items.length > 0
        ? items
        : Array.from(document.querySelectorAll("li.pvs-list__paged-list-item"));
    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }
    function parseDateRange(value: string) {
      const match = /(\b\d{4})\s*(?:-|to)\s*(Present|\d{4})/i.exec(value);
      if (!match) return { startDate: "", endDate: "" };
      return { startDate: match[1] ?? "", endDate: match[2] ?? "" };
    }

    return nodes
      .map((item) => {
        const school = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        const detailLines = Array.from(
          item.querySelectorAll("span.t-14.t-normal span[aria-hidden='true']"),
        )
          .map((el) => normalize(el.textContent ?? ""))
          .filter(Boolean);
        const degreeLine = detailLines.find((line) => line !== school) ?? "";
        const dateLine = normalize(
          item.querySelector(".pvs-entity__caption-wrapper")?.textContent ?? "",
        );
        const { startDate, endDate } = parseDateRange(dateLine);

        const notesBlock = item.querySelector("div.t-14.t-normal.t-black");
        const notes = normalize(
          (notesBlock as HTMLElement | null)?.innerText ??
            notesBlock?.textContent ??
            "",
        );

        return {
          id: item.id || undefined,
          school,
          degree: degreeLine,
          field: "",
          startDate,
          endDate,
          notes,
        };
      })
      .filter((item) => item.school);
  });
};

const extractProjectDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li[id*="PROJECT"]'));
    const nodes =
      items.length > 0
        ? items
        : Array.from(document.querySelectorAll("li.pvs-list__paged-list-item"));

    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }

    function parseDateRange(value: string) {
      const match =
        /(\b[A-Za-z]{3,9}\s+\d{4}|\b\d{4})\s*(?:-|to)\s*(Present|[A-Za-z]{3,9}\s+\d{4}|\d{4})/i.exec(
          value,
        );
      if (!match) return { startDate: "", endDate: "" };
      return { startDate: match[1] ?? "", endDate: match[2] ?? "" };
    }

    const rows = nodes
      .map((item) => {
        const name = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        if (!name) return null;

        const detailLines = Array.from(
          item.querySelectorAll("span.t-14.t-normal span[aria-hidden='true']"),
        )
          .map((el) => normalize(el.textContent ?? ""))
          .filter(Boolean);

        let role = "";
        let startDate = "";
        let endDate = "";
        for (const line of detailLines) {
          if (!line || line === name) continue;
          if (!startDate && /\d{4}/.test(line)) {
            const parsed = parseDateRange(line);
            if (parsed.startDate || parsed.endDate) {
              startDate = parsed.startDate;
              endDate = parsed.endDate;
              continue;
            }
          }
          if (!role && !line.toLowerCase().includes("associated with")) {
            role = line;
          }
        }

        const descriptionBlocks = Array.from(
          item.querySelectorAll(
            ".pvs-entity__sub-components .t-14.t-normal.t-black",
          ),
        );
        const blocks =
          descriptionBlocks.length > 0
            ? descriptionBlocks
            : Array.from(item.querySelectorAll("div.t-14.t-normal.t-black"));
        const chunks = blocks.flatMap((block) => {
          const hidden = Array.from(
            block.querySelectorAll("span.visually-hidden"),
          )
            .map((el) =>
              ((el as HTMLElement).innerText || el.textContent || "").trim(),
            )
            .filter(Boolean);
          if (hidden.length > 0) return hidden;
          const visible =
            (block as HTMLElement).innerText || block.textContent || "";
          return visible ? [visible.trim()] : [];
        });
        const uniqueChunks = Array.from(
          new Set(chunks.map((value) => value.trim()).filter(Boolean)),
        );
        const description = uniqueChunks.join("\n");

        const url =
          Array.from(item.querySelectorAll<HTMLAnchorElement>("a"))
            .map((anchor) => anchor.href)
            .find(
              (href) =>
                href &&
                href.startsWith("http") &&
                !href.includes("linkedin.com"),
            ) ?? "";

        return {
          id: item.id || undefined,
          name,
          role,
          description,
          startDate,
          endDate,
          url,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key = `${item.name}|${item.role}|${item.startDate}|${item.endDate}`
        .toLowerCase()
        .trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

const extractCertificationDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const scope =
      document.querySelector("main .scaffold-finite-scroll__content") ??
      document.querySelector("main") ??
      document;
    const items = Array.from(
      scope.querySelectorAll(
        'li[id*="CERTIFICATION"], li[id*="CERTIFICATIONS"], li[id*="LICENSE"]',
      ),
    );
    const nodes =
      items.length > 0
        ? items
        : Array.from(scope.querySelectorAll("li.pvs-list__paged-list-item"));

    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }

    function extractDateLine(lines: string[], keyword: string) {
      const found = lines.find((line) => line.toLowerCase().includes(keyword));
      if (!found) return "";
      return found.replace(new RegExp(`${keyword}\\s*`, "i"), "").trim();
    }

    const rows = nodes
      .map((item) => {
        const name = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        if (!name) return null;

        const detailLines = Array.from(
          item.querySelectorAll("span.t-14.t-normal span[aria-hidden='true']"),
        )
          .map((el) => normalize(el.textContent ?? ""))
          .filter(Boolean);

        const issueDate =
          extractDateLine(detailLines, "issued") ||
          extractDateLine(detailLines, "issue") ||
          "";
        const expirationDate =
          extractDateLine(detailLines, "expires") ||
          extractDateLine(detailLines, "expiration") ||
          "";

        let issuer = "";
        for (const line of detailLines) {
          const lower = line.toLowerCase();
          if (line === name) continue;
          if (lower.includes("issued")) continue;
          if (lower.includes("expires") || lower.includes("expiration"))
            continue;
          if (lower.includes("credential")) continue;
          issuer = line;
          break;
        }

        const rawText = normalize(item.textContent ?? "");
        const credentialIdMatch = /credential id[:\s]*([a-z0-9-]+)/i.exec(
          rawText,
        );
        const credentialId = credentialIdMatch?.[1] ?? "";

        const credentialUrl =
          Array.from(item.querySelectorAll<HTMLAnchorElement>("a"))
            .map((anchor) => anchor.href)
            .find(
              (href) =>
                href &&
                href.startsWith("http") &&
                !href.includes("linkedin.com"),
            ) ?? "";

        return {
          id: item.id || undefined,
          name,
          issuer,
          issueDate,
          expirationDate,
          credentialId,
          credentialUrl,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key = `${item.name}|${item.issuer}|${item.issueDate}`
        .toLowerCase()
        .trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

const extractHonorDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const scope =
      document.querySelector("main .scaffold-finite-scroll__content") ??
      document.querySelector("main") ??
      document;
    const items = Array.from(
      scope.querySelectorAll('li[id*="HONOR"], li[id*="AWARD"]'),
    );
    const nodes =
      items.length > 0
        ? items
        : Array.from(scope.querySelectorAll("li.pvs-list__paged-list-item"));

    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }

    const rows = nodes
      .map((item) => {
        const title = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        if (!title) return null;

        const detailLines = Array.from(
          item.querySelectorAll("span.t-14.t-normal span[aria-hidden='true']"),
        )
          .map((el) => normalize(el.textContent ?? ""))
          .filter(Boolean);

        let issuer = "";
        let date = "";
        for (const line of detailLines) {
          if (line === title) continue;
          if (!issuer && !/\d{4}/.test(line)) {
            issuer = line;
            continue;
          }
          if (!date && /\d{4}/.test(line)) {
            date = line;
          }
        }

        const descriptionBlocks = Array.from(
          item.querySelectorAll(
            ".pvs-entity__sub-components .t-14.t-normal.t-black, div.t-14.t-normal.t-black",
          ),
        );
        const description = descriptionBlocks
          .map((block) => {
            const hidden = Array.from(
              block.querySelectorAll("span.visually-hidden"),
            )
              .map((el) =>
                ((el as HTMLElement).innerText || el.textContent || "").trim(),
              )
              .filter(Boolean);
            if (hidden.length > 0) return hidden.join("\n");
            return (
              (block as HTMLElement).innerText ||
              block.textContent ||
              ""
            ).trim();
          })
          .filter(Boolean)
          .join("\n");

        return {
          id: item.id || undefined,
          title,
          issuer,
          date,
          description,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key = `${item.title}|${item.issuer}|${item.date}`
        .toLowerCase()
        .trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

const extractVolunteerDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const scope =
      document.querySelector("main .scaffold-finite-scroll__content") ??
      document.querySelector("main") ??
      document;
    const items = Array.from(scope.querySelectorAll('li[id*="VOLUNTEER"]'));
    const nodes =
      items.length > 0
        ? items
        : Array.from(scope.querySelectorAll("li.pvs-list__paged-list-item"));

    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }

    function parseDateRange(value: string) {
      const match =
        /(\b[A-Za-z]{3,9}\s+\d{4})\s*(?:-|to)\s*(Present|[A-Za-z]{3,9}\s+\d{4})/i.exec(
          value,
        );
      if (!match) return { startDate: "", endDate: "" };
      return { startDate: match[1] ?? "", endDate: match[2] ?? "" };
    }

    const rows = nodes
      .map((item) => {
        const role = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        if (!role) return null;

        const organizationLine = normalize(
          item.querySelector("span.t-14.t-normal span[aria-hidden='true']")
            ?.textContent ?? "",
        );
        const organization = organizationLine.split("·")[0]?.trim() ?? "";

        const dateLine = normalize(
          item.querySelector(".pvs-entity__caption-wrapper")?.textContent ?? "",
        );
        const { startDate, endDate } = parseDateRange(dateLine);

        const detailLines = Array.from(
          item.querySelectorAll("span.t-14.t-normal span[aria-hidden='true']"),
        )
          .map((el) => normalize(el.textContent ?? ""))
          .filter(Boolean);
        let cause = "";
        for (const line of detailLines) {
          if (line === role || line === organizationLine) continue;
          if (/\d{4}/.test(line)) continue;
          if (!cause) {
            cause = line;
            break;
          }
        }

        const descriptionBlocks = Array.from(
          item.querySelectorAll(
            ".pvs-entity__sub-components .t-14.t-normal.t-black, div.t-14.t-normal.t-black",
          ),
        );
        const summary = descriptionBlocks
          .map((block) => {
            const hidden = Array.from(
              block.querySelectorAll("span.visually-hidden"),
            )
              .map((el) =>
                ((el as HTMLElement).innerText || el.textContent || "").trim(),
              )
              .filter(Boolean);
            if (hidden.length > 0) return hidden.join("\n");
            return (
              (block as HTMLElement).innerText ||
              block.textContent ||
              ""
            ).trim();
          })
          .filter(Boolean)
          .join("\n");

        return {
          id: item.id || undefined,
          role,
          organization,
          cause,
          startDate,
          endDate,
          summary,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key =
        `${item.role}|${item.organization}|${item.startDate}|${item.endDate}`
          .toLowerCase()
          .trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

const extractServiceDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const scope =
      document.querySelector("main .scaffold-finite-scroll__content") ??
      document.querySelector("main") ??
      document;
    const items = Array.from(scope.querySelectorAll('li[id*="SERVICE"]'));
    const nodes =
      items.length > 0
        ? items
        : Array.from(scope.querySelectorAll("li.pvs-list__paged-list-item"));

    function normalize(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }

    const rows = nodes
      .map((item) => {
        const name = normalize(
          item.querySelector(".t-bold span[aria-hidden='true']")?.textContent ??
            "",
        );
        if (!name) return null;

        const descriptionBlocks = Array.from(
          item.querySelectorAll(
            ".pvs-entity__sub-components .t-14.t-normal.t-black, div.t-14.t-normal.t-black",
          ),
        );
        const description = descriptionBlocks
          .map((block) => {
            const hidden = Array.from(
              block.querySelectorAll("span.visually-hidden"),
            )
              .map((el) =>
                ((el as HTMLElement).innerText || el.textContent || "").trim(),
              )
              .filter(Boolean);
            if (hidden.length > 0) return hidden.join("\n");
            return (
              (block as HTMLElement).innerText ||
              block.textContent ||
              ""
            ).trim();
          })
          .filter(Boolean)
          .join("\n");

        return {
          id: item.id || undefined,
          name,
          description,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key = `${item.name}`.toLowerCase().trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

const extractRecommendationsDetails = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}) => {
  return page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("section"));
    const recSection = sections.find((section) => {
      const heading =
        section.querySelector("h2, h3, span")?.textContent?.toLowerCase() ?? "";
      return heading.includes("recommendations");
    });
    const scope = recSection ?? document.body;
    const items = Array.from(scope.querySelectorAll("li"));
    const chunks = items
      .map((item) => {
        const hidden = item.querySelector("span.visually-hidden");
        return (hidden?.textContent ?? item.textContent ?? "").trim();
      })
      .filter((value) => value.length > 40);
    return Array.from(new Set(chunks));
  });
};

const expandSkillsList = async (page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
  waitForTimeout: (ms: number) => Promise<void>;
}) => {
  for (let i = 0; i < 6; i += 1) {
    const clicked = await page.evaluate(() => {
      const labels = ["show more", "see more", "show all", "see all"];
      const clickable = Array.from(
        document.querySelectorAll<HTMLElement>("button, a, [role='button']"),
      );
      for (const element of clickable) {
        const text = element.innerText?.toLowerCase() ?? "";
        const aria = element.getAttribute("aria-label")?.toLowerCase() ?? "";
        if (
          labels.some((label) => text.includes(label) || aria.includes(label))
        ) {
          element.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) break;
    await page.waitForTimeout(700);
  }
};

const safeGoto = async (
  page: {
    goto: (
      url: string,
      options: {
        waitUntil: "load" | "domcontentloaded" | "networkidle";
        timeout: number;
      },
    ) => Promise<import("playwright").Response | null>;
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
      `${parsed.origin}${basePath}/details/projects/`,
      `${parsed.origin}${basePath}/details/certifications/`,
      `${parsed.origin}${basePath}/details/honors/`,
      `${parsed.origin}${basePath}/details/volunteering/`,
      `${parsed.origin}${basePath}/details/services/`,
      `${parsed.origin}${basePath}/details/skills/`,
      `${parsed.origin}${basePath}/details/recommendations/`,
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
  const detailHtml: Record<string, string> = {};
  const detailData: {
    experiences?: Awaited<ReturnType<typeof extractExperienceDetails>>;
    education?: Awaited<ReturnType<typeof extractEducationDetails>>;
    projects?: Awaited<ReturnType<typeof extractProjectDetails>>;
    certifications?: Awaited<ReturnType<typeof extractCertificationDetails>>;
    honors?: Awaited<ReturnType<typeof extractHonorDetails>>;
    volunteering?: Awaited<ReturnType<typeof extractVolunteerDetails>>;
    services?: Awaited<ReturnType<typeof extractServiceDetails>>;
    skills?: Awaited<ReturnType<typeof extractSkillItems>>;
    recommendations?: Awaited<ReturnType<typeof extractRecommendationsDetails>>;
  } = {};

  for (const detailsUrl of urls) {
    const page = await context.newPage();
    try {
      await safeGoto(page, detailsUrl, waitFor, timeoutMs);
      await page.waitForTimeout(1000);
      if (autoScroll) {
        await autoScrollPage(page);
      }
      await expandTextBlocks(page);
      if (detailsUrl.includes("/details/skills/")) {
        await expandSkillsList(page);
      }
      await page.waitForTimeout(600);
      const [html, text] = await Promise.all([
        page.content(),
        page.evaluate(() => {
          const main = document.querySelector("main");
          return (main?.innerText ?? document.body.innerText ?? "").trim();
        }),
      ]);
      if (isAuthWall(html, text)) {
        throw new Error("AUTH_WALL");
      }
      const label = detailsUrl.split("/details/")[1]?.split("/")[0];
      if (label && html) {
        detailHtml[label] = html;
      }
      if (label === "experience") {
        const experiences = await extractExperienceDetails(page);
        if (experiences.length > 0) {
          detailData.experiences = experiences;
        }
      }
      if (label === "education") {
        const education = await extractEducationDetails(page);
        if (education.length > 0) {
          detailData.education = education;
        }
      }
      if (label === "projects") {
        const projects = await extractProjectDetails(page);
        if (projects.length > 0) {
          detailData.projects = projects;
        }
      }
      if (label === "certifications") {
        const certifications = await extractCertificationDetails(page);
        if (certifications.length > 0) {
          detailData.certifications = certifications;
        }
      }
      if (label === "honors") {
        const honors = await extractHonorDetails(page);
        if (honors.length > 0) {
          detailData.honors = honors;
        }
      }
      if (label === "volunteering") {
        const volunteering = await extractVolunteerDetails(page);
        if (volunteering.length > 0) {
          detailData.volunteering = volunteering;
        }
      }
      if (label === "services") {
        const services = await extractServiceDetails(page);
        if (services.length > 0) {
          detailData.services = services;
        }
      }
      if (label === "skills") {
        const skills = await extractSkillItems(page);
        if (skills.length > 0) {
          detailData.skills = skills;
          sections.push(`SKILLS_ENDORSEMENTS_JSON\n${JSON.stringify(skills)}`);
        }
      }
      if (label === "recommendations") {
        const recommendations = await extractRecommendationsDetails(page);
        if (recommendations.length > 0) {
          detailData.recommendations = recommendations;
        }
      }
      if (text) {
        sections.push(`${(label ?? "details").toUpperCase()}_DETAILS\n${text}`);
      }
    } catch {
      // ignore detail page failures
    } finally {
      await page.close();
    }
  }

  return { sections, detailHtml, detailData };
};

const parseProxy = (proxy?: string) => {
  if (!proxy) return undefined;
  const normalized = proxy.includes("://") ? proxy : `http://${proxy}`;
  try {
    const parsed = new URL(normalized);
    const server = `${parsed.protocol}//${parsed.host}`;
    const username = parsed.username
      ? decodeURIComponent(parsed.username)
      : undefined;
    const password = parsed.password
      ? decodeURIComponent(parsed.password)
      : undefined;
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
      ...(storageState
        ? {
            storageState: storageState as BrowserContextOptions["storageState"],
          }
        : {}),
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      locale: options.locale ?? "en-US",
      viewport: { width: 1280, height: 720 },
    });
    await context.addInitScript({
      content: "globalThis.__name = (fn) => fn;",
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

    const [html, text, screenshotBuffer, profileDetails] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body.innerText),
      options.screenshot ? page.screenshot({ fullPage: true }) : null,
      extractProfileDetails(page),
    ]);

    if (isAuthWall(html, text)) {
      throw new Error("AUTH_WALL");
    }

    const screenshotUrl =
      screenshotBuffer && Buffer.isBuffer(screenshotBuffer)
        ? await writeScreenshot(id, screenshotBuffer)
        : undefined;

    const detailPayload = expandDetails
      ? await scrapeDetails({
          context,
          urls: buildDetailsUrls(url),
          waitFor,
          timeoutMs,
          autoScroll,
        })
      : { sections: [], detailHtml: {}, detailData: {} };
    const combinedText = detailPayload.sections.length
      ? [...detailPayload.sections, `PROFILE_PAGE\n${text}`].join("\n\n")
      : text;

    return {
      raw: {
        html,
        text: combinedText,
        screenshotUrl,
        detailsHtml: detailPayload.detailHtml,
        detailsData: {
          ...detailPayload.detailData,
          profile: profileDetails,
        },
      },
    };
  } finally {
    await browser.close();
  }
};

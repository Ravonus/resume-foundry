import { appendFile, mkdir } from "fs/promises";
import path from "path";

import { env } from "~/env";

export type AiLogLevel = "debug" | "info" | "warn" | "error";

export type AiLogEvent = {
  level: AiLogLevel;
  operation: string;
  provider?: string;
  model?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

const LEVEL_ORDER: Record<AiLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LOG_ENABLED = env.AI_LOG_ENABLED === "true" || env.EDENAI_DEBUG === "true";
const LOG_VERBOSE =
  env.AI_LOG_VERBOSE === "true" || env.EDENAI_DEBUG_VERBOSE === "true";
const LOG_LEVEL_RAW =
  env.AI_LOG_LEVEL ??
  (LOG_ENABLED ? (LOG_VERBOSE ? "debug" : "info") : "error");
const LOG_LEVEL = (["error", "warn", "info", "debug"] as const).includes(
  LOG_LEVEL_RAW as AiLogLevel,
)
  ? (LOG_LEVEL_RAW as AiLogLevel)
  : "error";
const LOG_DIR = env.AI_LOG_DIR ?? "logs";
const LOG_FILE = env.AI_LOG_FILE ?? "ai-calls.jsonl";
const PREVIEW_LIMIT = 600;

const shouldLog = (level: AiLogLevel) =>
  LEVEL_ORDER[level] <= LEVEL_ORDER[LOG_LEVEL];

const resolveLogPath = () =>
  path.isAbsolute(LOG_FILE)
    ? LOG_FILE
    : path.join(process.cwd(), LOG_DIR, LOG_FILE);

const ensureDir = async () => {
  const logPath = resolveLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  return logPath;
};

export const formatPreview = (value: string) => {
  if (LOG_VERBOSE) return value;
  return value.length > PREVIEW_LIMIT
    ? `${value.slice(0, PREVIEW_LIMIT)}...`
    : value;
};

export const formatTailPreview = (value: string) => {
  if (LOG_VERBOSE) return value;
  if (value.length <= PREVIEW_LIMIT) return value;
  return `...${value.slice(-PREVIEW_LIMIT)}`;
};

export const logAiEvent = async (event: AiLogEvent) => {
  if (!LOG_ENABLED && event.level !== "error") {
    return;
  }

  if (!shouldLog(event.level)) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    ...event,
  };

  if (event.level === "error") {
    console.error("[ai-log]", entry);
  } else if (LOG_ENABLED) {
    console.info("[ai-log]", entry);
  }

  try {
    const logPath = await ensureDir();
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch (error) {
    console.error("[ai-log] Failed to write log entry", error);
  }
};

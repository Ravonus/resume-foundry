import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    BETTER_AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    BETTER_AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().url(),
    EDENAI_API_KEY: z.string().optional(),
    EDENAI_PROVIDER: z.string().optional(),
    EDENAI_MODEL: z.string().optional(),
    EDENAI_OCR_PROVIDER: z.string().optional(),
    EDENAI_DEBUG: z.string().optional(),
    EDENAI_DEBUG_VERBOSE: z.string().optional(),
    EDENAI_MAX_PROMPT_CHARS: z.coerce.number().optional(),
    EDENAI_MAX_TOKENS: z.coerce.number().optional(),
    AI_LOG_ENABLED: z.string().optional(),
    AI_LOG_LEVEL: z.string().optional(),
    AI_LOG_DIR: z.string().optional(),
    AI_LOG_FILE: z.string().optional(),
    AI_LOG_VERBOSE: z.string().optional(),
    LINKEDIN_SCRAPER_URL: z.string().url().optional(),
    LINKEDIN_SCRAPER_API_KEY: z.string().optional(),
    LINKEDIN_SCRAPER_TIMEOUT_MS: z.coerce.number().optional(),
    LINKEDIN_EXTRACT_MULTI: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_GOOGLE_CLIENT_ID: process.env.BETTER_AUTH_GOOGLE_CLIENT_ID,
    BETTER_AUTH_GOOGLE_CLIENT_SECRET:
      process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    EDENAI_API_KEY: process.env.EDENAI_API_KEY,
    EDENAI_PROVIDER: process.env.EDENAI_PROVIDER,
    EDENAI_MODEL: process.env.EDENAI_MODEL,
    EDENAI_OCR_PROVIDER: process.env.EDENAI_OCR_PROVIDER,
    EDENAI_DEBUG: process.env.EDENAI_DEBUG,
    EDENAI_DEBUG_VERBOSE: process.env.EDENAI_DEBUG_VERBOSE,
    EDENAI_MAX_PROMPT_CHARS: process.env.EDENAI_MAX_PROMPT_CHARS,
    EDENAI_MAX_TOKENS: process.env.EDENAI_MAX_TOKENS,
    AI_LOG_ENABLED: process.env.AI_LOG_ENABLED,
    AI_LOG_LEVEL: process.env.AI_LOG_LEVEL,
    AI_LOG_DIR: process.env.AI_LOG_DIR,
    AI_LOG_FILE: process.env.AI_LOG_FILE,
    AI_LOG_VERBOSE: process.env.AI_LOG_VERBOSE,
    LINKEDIN_SCRAPER_URL: process.env.LINKEDIN_SCRAPER_URL,
    LINKEDIN_SCRAPER_API_KEY: process.env.LINKEDIN_SCRAPER_API_KEY,
    LINKEDIN_SCRAPER_TIMEOUT_MS: process.env.LINKEDIN_SCRAPER_TIMEOUT_MS,
    LINKEDIN_EXTRACT_MULTI: process.env.LINKEDIN_EXTRACT_MULTI,
    NODE_ENV: process.env.NODE_ENV,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});

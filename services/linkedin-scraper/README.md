# LinkedIn Scraper Service

Standalone queue-based scraper for LinkedIn profile URLs. Run this separately
from the Next.js app.

## Setup

```
pnpm install
pnpm dev
```

## Environment

- `SCRAPER_PORT` (default: `5150`)
- `SCRAPER_CONCURRENCY` (default: `2`)
- `SCRAPER_QUEUE_LIMIT` (default: `200`)
- `SCRAPER_JOB_TTL_MS` (default: `3600000`)
- `SCRAPER_TIMEOUT_MS` (default: `45000`)
- `SCRAPER_PROXY_URL` (optional)
- `SCRAPER_PROXY_POOL` (optional, comma-separated)
- `SCRAPER_SCREENSHOT_DIR` (optional, to save screenshots)
- `SCRAPER_PUBLIC_BASE_URL` (optional, to expose screenshots)
- `SCRAPER_STORAGE_STATE_PATH` (optional, defaults to `storageState.json`)
- `SCRAPER_ADMIN_TOKEN` (optional, protect admin endpoints)
- `SCRAPER_AUTH_CHECK_INTERVAL_MS` (optional, defaults to 3600000)
- `SCRAPER_ALERT_WEBHOOK` (optional, POSTs when auth fails)

## Endpoints

- `POST /scrape` -> returns `{ jobId, status, position, etaMs }`
- `GET /scrape/:id` -> returns job status + result
- `POST /scrape/:id/cancel`
- `GET /health`
- `GET /auth/status` (admin)
- `POST /auth/check` (admin)
- `POST /auth/session` (admin)
- `POST /auth/session/clear` (admin)
- `GET /admin` (admin UI, accepts `?token=...`)

## Admin login bootstrap

Run a headful login once on the scraper host:

```
pnpm login
```

This opens a browser. Log into LinkedIn, then press Enter in the terminal. The
service saves `storageState.json` and will reuse it until it expires.

### Headless server setup (recommended)

Run the login script on any machine with a browser and push the session to the
headless scraper server:

```
SCRAPER_PUSH_URL="http://your-scraper-host:5150" \
SCRAPER_ADMIN_TOKEN="your-token" \
pnpm login
```

The script saves locally and POSTs storageState to the scraper service.

### Example request

```json
{
  "url": "https://www.linkedin.com/in/example",
  "options": { "stealth": true, "waitFor": "domcontentloaded", "autoScroll": true, "expandDetails": true },
  "callbackUrl": "https://your-app.com/api/linkedin/scrape/callback"
}
```

### Auth session (cookies)

```json
{
  "liAt": "your_li_at_cookie",
  "jsessionId": "your_jsessionid_cookie"
}
```

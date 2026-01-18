# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

## Site Generation API

Endpoint: `POST /api/site/generate`

Purpose: Build resume exports (MD/TXT/DOCX/PDF), create a resume archive, and kick off a site-generation job with the external jobs service.

Request body (JSON):
- `markdown` (string, required): Resume markdown content.
- `text` (string, required): Plaintext resume content.
- `draft` (ResumeDraft, required): Structured resume data.
- `theme` (ResumeTheme, optional): `{ accent, accentSoft, accentInk }`.
- `slug` (string, required): Site slug (lowercase; max 48 chars).
- `prompt` (string, optional): Override the default site prompt.

Response (200):
```
{
  "job": { "id": "...", "status": "queued", "statusUrl": "...", "logsUrl": "..." },
  "slug": "your-slug",
  "domain": "your-slug.mog.garden",
  "resumeMarkdownPath": "/abs/or/workspace/path/resume.md"
}
```

Error responses:
- `400` invalid payload or missing slug
- `500` resume export generation failed
- `502` jobs service rejected the request

Relevant env vars:
- `SITE_GENERATOR_JOBS_URL` (default `http://localhost:3814/jobs`)
- `SITE_GENERATOR_TEMPLATE_PATH` (required)
- `SITE_GENERATOR_RESUME_MARKDOWN_PATH` (default `public/resume/resume.md`)
- `SITE_GENERATOR_ADMIN_BASE_URL`
- `SITE_GENERATOR_ORGANIZATION_ID`
- `SITE_GENERATOR_DOMAIN_BASE` (default `mog.garden`)
- `SITE_GENERATOR_REPO_PROVIDER` (default `gitea`)
- `SITE_GENERATOR_GITEA_BASE_URL`
- `SITE_GENERATOR_DEFAULT_BRANCH` (default `main`)
- `SITE_GENERATOR_BUILD_COMMAND` (default `pnpm build`)
- `SITE_GENERATOR_DEPLOY_MODE` (default `server`)

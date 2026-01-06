import { NextResponse } from "next/server";
import { z } from "zod";

import { resumeDraftSchema, scrapedProfileSchema } from "~/lib/resume/types";
import { polishResumeDraft } from "~/server/services/resume-polish";

const polishRequestSchema = z.object({
  draft: resumeDraftSchema,
  scraped: scrapedProfileSchema.optional().nullable(),
  prompt: z.string().optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = polishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid resume data." },
      { status: 400 },
    );
  }

  const updated = await polishResumeDraft({
    draft: parsed.data.draft,
    scraped: parsed.data.scraped ?? null,
    prompt: parsed.data.prompt,
  });

  return NextResponse.json({ draft: updated });
}

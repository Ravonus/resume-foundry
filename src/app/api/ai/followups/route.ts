import { NextResponse } from "next/server";
import { z } from "zod";

import { resumeDraftSchema, scrapedProfileSchema } from "~/lib/resume/types";
import { generateFollowupQuestions } from "~/server/services/resume-followups";

const requestSchema = z.object({
  draft: resumeDraftSchema,
  scraped: scrapedProfileSchema.nullable().optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload for follow-up questions." },
      { status: 400 },
    );
  }

  const { questions } = await generateFollowupQuestions({
    draft: parsed.data.draft,
    scraped: parsed.data.scraped ?? null,
  });

  return NextResponse.json({ questions });
}

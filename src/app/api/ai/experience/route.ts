import "~/server/polyfills";
import { NextResponse } from "next/server";
import { z } from "zod";

import { resumeExperienceSchema, resumeProfileSchema } from "~/lib/resume/types";
import { rewriteExperienceEntry } from "~/server/services/experience-rewrite";

const requestSchema = z.object({
  experience: resumeExperienceSchema,
  profile: resumeProfileSchema.partial().optional().nullable(),
  prompt: z.string().optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid experience data." },
      { status: 400 },
    );
  }

  try {
    const suggestion = await rewriteExperienceEntry({
      experience: parsed.data.experience,
      profile: parsed.data.profile ?? null,
      prompt: parsed.data.prompt,
    });
    return NextResponse.json({ suggestion });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "We could not rewrite that experience.",
      },
      { status: 500 },
    );
  }
}

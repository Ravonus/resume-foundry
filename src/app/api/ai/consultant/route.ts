import { NextResponse } from "next/server";
import { z } from "zod";

import { resumeDraftSchema, scrapedProfileSchema } from "~/lib/resume/types";
import { runConsultantIntake } from "~/server/services/consultant";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  draft: resumeDraftSchema,
  scraped: scrapedProfileSchema.nullable().optional(),
  messages: z.array(messageSchema).optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid consultant payload." },
      { status: 400 },
    );
  }

  try {
    const result = await runConsultantIntake({
      draft: parsed.data.draft,
      scraped: parsed.data.scraped ?? null,
      messages: parsed.data.messages ?? [],
    });
    return NextResponse.json({
      assistant: result.assistant ?? "",
      updates: result.updates ?? {},
      followUps: result.followUps ?? [],
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Consultant intake failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

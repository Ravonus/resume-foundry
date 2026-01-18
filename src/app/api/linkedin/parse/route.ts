import "~/server/polyfills";
import { NextResponse } from "next/server";
import { z } from "zod";

import { scrapedProfileSchema } from "~/lib/resume/types";
import { extractLinkedInProfile } from "~/server/services/linkedin-extractor";

const requestSchema = z.object({
  text: z.string().min(1),
  url: z.string().optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide profile text to import." },
      { status: 400 },
    );
  }

  try {
    const profile = await extractLinkedInProfile({
      rawText: parsed.data.text,
      url: parsed.data.url ?? "linkedin-text",
    });
    const validated = scrapedProfileSchema.safeParse(profile);
    if (!validated.success) {
      return NextResponse.json(
        { error: "We could not normalize that profile." },
        { status: 500 },
      );
    }
    return NextResponse.json({ profile: validated.data });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "We could not parse that text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

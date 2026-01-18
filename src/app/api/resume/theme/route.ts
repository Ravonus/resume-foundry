import "~/server/polyfills";
import { NextResponse } from "next/server";

import { resumeDraftSchema } from "~/lib/resume/types";
import {
  resumeThemeSchema,
  resolveResumeTheme,
} from "~/server/services/resume-theme";

const themeRequestSchema = resumeDraftSchema;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  console.log("Received theme request body:", body);
  const parsed = themeRequestSchema.safeParse(body);
  console.log("Parsed theme request:", parsed);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid resume data." },
      { status: 400 },
    );
  }

  const theme = await resolveResumeTheme(parsed.data);
  const validated = resumeThemeSchema.safeParse(theme);
  if (!validated.success) {
    return NextResponse.json(
      { error: "Theme generation failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ theme: validated.data });
}

import { NextResponse } from "next/server";

import { z } from "zod";

import { resumeDraftSchema } from "~/lib/resume/types";
import { buildResumeDocx } from "~/server/services/resume-docx";
import {
  resumeThemeSchema,
  resolveResumeTheme,
} from "~/server/services/resume-theme";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const direct = resumeDraftSchema.safeParse(body);
  const wrappedSchema = z.object({
    draft: resumeDraftSchema,
    theme: resumeThemeSchema.optional(),
  });
  const wrapped = wrappedSchema.safeParse(body);

  if (!direct.success && !wrapped.success) {
    return NextResponse.json(
      { error: "Invalid resume data." },
      { status: 400 },
    );
  }

  let draft: z.infer<typeof resumeDraftSchema>;
  let theme: z.infer<typeof resumeThemeSchema>;
  if (direct.success) {
    draft = direct.data;
    theme = await resolveResumeTheme(draft);
  } else if (wrapped.success) {
    draft = wrapped.data.draft;
    theme = wrapped.data.theme ?? (await resolveResumeTheme(draft));
  } else {
    return NextResponse.json(
      { error: "Invalid resume data." },
      { status: 400 },
    );
  }

  const docxBuffer = await buildResumeDocx(draft, theme);
  const safeName =
    draft.profile.fullName?.trim().replace(/[^a-z0-9]+/gi, "_") || "resume";
  const filename = `${safeName}.docx`;

  return new NextResponse(new Uint8Array(docxBuffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

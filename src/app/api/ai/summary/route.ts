import "~/server/polyfills";
import { NextResponse } from "next/server";
import { z } from "zod";

import { rewriteProfileSummary } from "~/server/services/summary-rewrite";

const summaryRequestSchema = z.object({
  summary: z.string().optional().default(""),
  profile: z
    .object({
      headline: z.string().optional(),
      targetRole: z.string().optional(),
      jobField: z.string().optional(),
      jobType: z.string().optional(),
    })
    .optional()
    .nullable(),
  prompt: z.string().optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = summaryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid summary data." },
      { status: 400 },
    );
  }

  try {
    const result = await rewriteProfileSummary({
      summary: parsed.data.summary ?? "",
      profile: parsed.data.profile ?? null,
      prompt: parsed.data.prompt,
    });
    return NextResponse.json({ summary: result.summary });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI summary failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

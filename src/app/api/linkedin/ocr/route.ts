import { NextResponse } from "next/server";

import { scrapedProfileSchema } from "~/lib/resume/types";
import { extractLinkedInProfile } from "~/server/services/linkedin-extractor";
import { extractTextFromFile } from "~/server/services/linkedin-ocr";

const SUPPORTED_HINT =
  "Use PDF, DOCX, ODT, TXT, MD, or images.";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { error: "Invalid file upload." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const url = formData.get("url");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: `A file upload is required. ${SUPPORTED_HINT}` },
      { status: 400 },
    );
  }

  try {
    const rawText = await extractTextFromFile(file);
    const profile = await extractLinkedInProfile({
      rawText,
      url: typeof url === "string" ? url : "linkedin-file",
    });
    const parsed = scrapedProfileSchema.safeParse(profile);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "We could not normalize that profile." },
        { status: 500 },
      );
    }

    return NextResponse.json({ profile: parsed.data });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "We could not parse that file.";
    const fullMessage = message.includes("Unsupported file type")
      ? `${message} ${SUPPORTED_HINT}`
      : message;
    return NextResponse.json({ error: fullMessage }, { status: 500 });
  }
}

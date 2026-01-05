import { NextResponse } from "next/server";

import { queueLinkedInScrape } from "~/server/services/linkedin-scraper";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    url?: string;
  } | null;
  const url = body?.url?.trim();

  if (!url) {
    return NextResponse.json(
      { error: "A LinkedIn URL is required." },
      { status: 400 },
    );
  }

  if (!url.includes("linkedin.com")) {
    return NextResponse.json(
      { error: "Please provide a valid LinkedIn profile URL." },
      { status: 400 },
    );
  }

  try {
    const job = await queueLinkedInScrape(url);
    return NextResponse.json(job);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "We could not queue that profile.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

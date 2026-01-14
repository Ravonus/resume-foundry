//just console.log get

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  console.log("AI test route accessed");
  return NextResponse.json({ message: "AI test route is working. again??" });
}

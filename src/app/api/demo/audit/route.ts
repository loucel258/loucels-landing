import { NextResponse } from "next/server";
import { readRecentEntries } from "@/lib/audit/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readRecentEntries(50);
  if (!result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.OPENWEATHER_API_KEY) });
}

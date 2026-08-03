import { NextRequest, NextResponse } from "next/server";
import { getDailyUsage, isGribstreamDisabled, MAX_DAILY_CALLS } from "@/lib/gribstream-budget";

// Read-only usage check for monitoring the daily call budget without
// waiting to hit it by surprise. Reuses CRON_SECRET rather than adding a
// new secret, since this is the same "internal ops, not end-user" trust
// level as the cron routes. Check it with:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/radar/gribstream/status
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const usage = getDailyUsage();
  return NextResponse.json({
    ...usage,
    disabled: isGribstreamDisabled(),
    configured: Boolean(process.env.GRIBSTREAM_API_KEY),
    remainingToday: Math.max(0, MAX_DAILY_CALLS - usage.callsToday),
  }, { headers: { "Cache-Control": "no-store" } });
}

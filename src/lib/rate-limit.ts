// Best-effort per-IP rate limiting for unauthenticated API routes that proxy metered third-party
// weather/radar services. State lives in module-scope memory, so it resets on cold start and isn't
// shared across concurrent serverless instances — this bounds abuse from a single warm instance
// rather than guaranteeing an exact global limit. That's an acceptable tradeoff for a
// proof-of-concept deployment; a durable store (e.g. Upstash Redis) would be needed for precise
// enforcement at scale.
import { NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_BUCKETS = 5000;

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function checkRateLimit(request: Request, routeKey: string, limit: number, windowMs: number) {
  const bucketKey = `${routeKey}:${clientIp(request)}`;
  const now = Date.now();
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_BUCKETS) buckets.clear();
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { limited: false as const };
  }

  if (existing.count >= limit) {
    return { limited: true as const, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }

  existing.count += 1;
  return { limited: false as const };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

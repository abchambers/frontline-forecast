import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenIsUsable, classifyRefreshStatus, jwtExpiryMs, msUntilRefresh, REFRESH_LEAD_MS, requestRefresh } from "../src/lib/session-refresh.ts";

const now = Date.UTC(2026, 8, 19, 12, 0, 0);

function tokenExpiringAt(expMs) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(expMs / 1000) })}.signature`;
}

const user = { id: "user-1", email: "a@example.com" };
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("reads the real expiry out of a JWT and rejects garbage", () => {
  assert.equal(jwtExpiryMs(tokenExpiringAt(now + 3_600_000)), now + 3_600_000);
  assert.equal(jwtExpiryMs("not-a-jwt"), null);
  assert.equal(jwtExpiryMs(""), null);
});

test("refresh is scheduled REFRESH_LEAD_MS before expiry, and immediately once inside that window", () => {
  assert.equal(msUntilRefresh(tokenExpiringAt(now + 3_600_000), now), 3_600_000 - REFRESH_LEAD_MS);
  assert.equal(msUntilRefresh(tokenExpiringAt(now + 60_000), now), 0);
  assert.equal(msUntilRefresh(tokenExpiringAt(now - 60_000), now), 0);
  assert.equal(msUntilRefresh("garbage", now), 0);
});

test("a token expired while the laptop slept is not usable, a fresh one is", () => {
  assert.equal(accessTokenIsUsable(tokenExpiringAt(now + 3_600_000), now), true);
  assert.equal(accessTokenIsUsable(tokenExpiringAt(now + 10_000), now), false);
  assert.equal(accessTokenIsUsable(tokenExpiringAt(now - 1), now), false);
  assert.equal(accessTokenIsUsable("garbage", now), false);
});

test("only a definitive auth rejection ends a session; outages and rate limits do not", () => {
  for (const status of [400, 401, 403, 404]) assert.equal(classifyRefreshStatus(status), "rejected", String(status));
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(classifyRefreshStatus(status), "unavailable", String(status));
});

test("a network failure (offline, lid just opened) keeps the session instead of wiping it", async () => {
  const offline = async () => { throw new TypeError("Load failed"); };
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, offline), { kind: "unavailable" });
});

test("a rejected refresh token is reported as rejected", async () => {
  const gone = async () => jsonResponse(400, { error_code: "refresh_token_already_used" });
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, gone), { kind: "rejected" });
});

test("a 5xx or rate limit is reported as unavailable, not rejected", async () => {
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, async () => jsonResponse(503, {})), { kind: "unavailable" });
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, async () => jsonResponse(429, {})), { kind: "unavailable" });
});

test("a success with a body we cannot use is treated as unavailable, never as a logout", async () => {
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, async () => jsonResponse(200, {})), { kind: "unavailable" });
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, async () => new Response("<html>", { status: 200 })), { kind: "unavailable" });
});

test("a successful refresh returns the rotated tokens and falls back to the known user", async () => {
  const ok = async () => jsonResponse(200, { access_token: "new-access", refresh_token: "new-refresh" });
  assert.deepEqual(await requestRefresh("https://x.supabase.co", "key", "rt", user, ok), { kind: "refreshed", session: { access_token: "new-access", refresh_token: "new-refresh", user } });
  const noRotation = async () => jsonResponse(200, { access_token: "new-access" });
  assert.equal((await requestRefresh("https://x.supabase.co", "key", "old-rt", user, noRotation)).session.refresh_token, "old-rt");
});

test("the refresh request targets the token endpoint with the refresh grant and the anon key", async () => {
  let seen;
  await requestRefresh("https://x.supabase.co", "anon-key", "rt-123", user, async (url, init) => { seen = { url, init }; return jsonResponse(200, { access_token: "a" }); });
  assert.equal(seen.url, "https://x.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.apikey, "anon-key");
  assert.deepEqual(JSON.parse(seen.init.body), { refresh_token: "rt-123" });
});

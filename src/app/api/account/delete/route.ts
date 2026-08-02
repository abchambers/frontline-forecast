import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limit = checkRateLimit(request, "account-delete", 5, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return NextResponse.json({ error: "Account deletion is not configured on this deployment." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  // Resolve the caller's own id from their access token — never trust a client-supplied id.
  const whoami = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!whoami.ok) return NextResponse.json({ error: "Your session could not be verified. Sign in again and retry." }, { status: 401 });
  const user = await whoami.json() as { id?: string };
  if (!user.id) return NextResponse.json({ error: "Your session could not be verified. Sign in again and retry." }, { status: 401 });

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Clear identifying profile fields the "protect_profile_identity" trigger allows changing
  // (it blocks direct email changes, so the account email is left in place — it's only ever
  // visible to instructors/admins who already had access to this person's coursework, not exposed
  // publicly). The profiles row itself is kept: forecast_runs, classroom_memberships, and other
  // educational records reference profiles.id without a foreign key, so deleting the row would
  // orphan a student's coursework instead of cleanly de-identifying it.
  const scrub = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({ display_name: null, person_type: null, employee_id: null, student_id: null, title: null }),
  });
  if (!scrub.ok) return NextResponse.json({ error: "Your account could not be deleted. Please try again or contact support." }, { status: 502 });

  // Deleting the auth user revokes login and destroys stored credentials.
  const deleteAuth = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
  if (!deleteAuth.ok) return NextResponse.json({ error: "Your profile was cleared, but the account credentials could not be removed. Contact support to finish closing your account." }, { status: 502 });

  return NextResponse.json({ deleted: true });
}

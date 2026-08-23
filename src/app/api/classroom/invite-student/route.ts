import { NextRequest, NextResponse } from "next/server";

// Resolves an email to an account, creating one via Supabase's admin invite
// (which sends the branded "Invite user" email already wired up in the
// Auth SMTP settings) if it doesn't exist yet. Enrollment itself happens
// client-side afterward as a normal authenticated classroom_memberships
// insert, so RLS and the seat-limit trigger both still apply exactly as
// they do for a class-code redemption -- this route's only job is the part
// that genuinely needs the service role: turning an email into a user id.
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return NextResponse.json({ message: "Server is not configured for invitations." }, { status: 500 });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const callerResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!callerResponse.ok) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => null) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  }

  const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const existingResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: adminHeaders });
  const existingData = existingResponse.ok ? await existingResponse.json().catch(() => null) : null;
  const existingUsers = Array.isArray(existingData) ? existingData : Array.isArray(existingData?.users) ? existingData.users : [];
  const existingMatch = existingUsers.find((candidate: { email?: string; id?: string }) => candidate.email === email);
  if (existingMatch?.id) {
    return NextResponse.json({ userId: existingMatch.id as string, invited: false });
  }

  const inviteResponse = await fetch(`${supabaseUrl}/auth/v1/invite`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email }) });
  const inviteData = await inviteResponse.json().catch(() => null) as { id?: string; msg?: string; message?: string } | null;
  if (!inviteResponse.ok || !inviteData?.id) {
    return NextResponse.json({ message: inviteData?.msg || inviteData?.message || "The invite could not be sent." }, { status: 400 });
  }
  return NextResponse.json({ userId: inviteData.id, invited: true });
}

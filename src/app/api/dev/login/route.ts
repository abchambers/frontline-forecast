import { NextResponse } from "next/server";

// Dev-only auth bypass so a local automated session can verify signed-in
// pages without ever touching a real password or session token. Hard-gated
// on NODE_ENV, which Next.js sets at build time -- "development" only for
// `next dev`, always "production" in a deployed build -- so this branch (and
// the admin-API calls it makes) is dead code in anything actually shipped.
// Provisions one clearly-labeled test identity (owner role, one school, one
// classroom as instructor) so School/Classroom/Control render with real
// data instead of empty states, and mints a session via Supabase's admin
// generate_link + verify exchange -- no password is ever set or used.

const DEV_TEST_EMAIL = "claude-dev-test@internal.invalid";
const DEV_ORG_SLUG = "dev-test-school-claude";
const DEV_ORG_NAME = "DEV TEST SCHOOL (delete me)";
const DEV_CLASS_NAME = "DEV TEST CLASS (delete me)";

// GET is for a human visiting this URL directly in a browser: it runs the
// same provisioning + session-mint flow as POST, then hands back a tiny HTML
// page whose only job is to drop the session into localStorage and redirect
// to "/" -- so the actual sign-in click happens in the person's own browser,
// not via any fetch Claude issues itself.
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await provisionAndMintSession();
  if ("error" in result) {
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Dev sign-in failed</title><body style="font-family:system-ui;padding:40px;max-width:640px;margin:0 auto;"><h1>Dev sign-in failed</h1><p>${escapeHtml(result.error)}</p><pre style="white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px;">${escapeHtml(JSON.stringify(result.detail ?? null, null, 2))}</pre></body>`,
      { status: 502, headers: { "Content-Type": "text/html" } }
    );
  }
  const sessionJson = JSON.stringify({ access_token: result.access_token, refresh_token: result.refresh_token, user: result.user });
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Signing in…</title><body style="font-family:system-ui;padding:40px;"><p>Signing in as the dev test account…</p><script>
      localStorage.setItem(${JSON.stringify("weather-desk-supabase-session")}, ${JSON.stringify(sessionJson)});
      location.href = "/";
    </script></body>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await provisionAndMintSession();
  if ("error" in result) return NextResponse.json(result, { status: 502 });
  return NextResponse.json(result);
}

async function provisionAndMintSession(): Promise<
  | { access_token: string; refresh_token: string; user: { id: string; email?: string } }
  | { error: string; detail?: unknown }
> {

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return { error: "Supabase admin credentials are not configured in .env.local." };
  }

  const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  async function findUserId(): Promise<string | null> {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(DEV_TEST_EMAIL)}`, { headers: adminHeaders });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const users = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users : [];
    const match = users.find((candidate: { email?: string; id?: string }) => candidate.email === DEV_TEST_EMAIL);
    return match?.id ?? null;
  }

  let userId = await findUserId();
  if (!userId) {
    const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: DEV_TEST_EMAIL, email_confirm: true, user_metadata: { dev_test: true } }),
    });
    const createdData = await created.json().catch(() => null);
    if (!created.ok || !createdData?.id) {
      return { error: "Could not create the dev test user.", detail: createdData };
    }
    userId = createdData.id;
  }

  // display_name only: a DB trigger deliberately blocks role changes unless
  // the acting user is already an owner/admin (a real security guard, not a
  // bug -- an automated service-role request doesn't satisfy it, and it
  // shouldn't). This test account stays whatever role a fresh signup gets;
  // Control/admin-only views need a real owner account to verify, not this one.
  await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ display_name: "Dev Test" }),
  }).catch(() => null);

  // Test organization ("school").
  let orgId: string | null = null;
  const orgLookup = await fetch(`${supabaseUrl}/rest/v1/organizations?slug=eq.${DEV_ORG_SLUG}&select=id`, { headers: adminHeaders });
  if (orgLookup.ok) {
    const rows = await orgLookup.json().catch(() => []);
    orgId = rows[0]?.id ?? null;
  }
  if (!orgId) {
    const orgCreate = await fetch(`${supabaseUrl}/rest/v1/organizations`, {
      method: "POST",
      headers: { ...adminHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ name: DEV_ORG_NAME, slug: DEV_ORG_SLUG, kind: "school", created_by: userId }),
    });
    const orgRows = await orgCreate.json().catch(() => []);
    orgId = orgCreate.ok ? orgRows[0]?.id ?? null : null;
  }

  if (orgId) {
    const membershipLookup = await fetch(`${supabaseUrl}/rest/v1/organization_memberships?organization_id=eq.${orgId}&user_id=eq.${userId}&select=id`, { headers: adminHeaders });
    const membershipRows = membershipLookup.ok ? await membershipLookup.json().catch(() => []) : [];
    if (!membershipRows[0]) {
      await fetch(`${supabaseUrl}/rest/v1/organization_memberships`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ organization_id: orgId, user_id: userId, role: "owner", status: "active" }),
      }).catch(() => null);
    }
  }

  // A classroom insert is rejected by a DB trigger unless its school already
  // has an active class allocation -- give the test org one so classroom
  // creation below actually succeeds instead of failing silently.
  if (orgId) {
    const entitlementLookup = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?organization_id=eq.${orgId}&select=id`, { headers: adminHeaders });
    const entitlementRows = entitlementLookup.ok ? await entitlementLookup.json().catch(() => []) : [];
    if (!entitlementRows[0]) {
      await fetch(`${supabaseUrl}/rest/v1/organization_entitlements`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ organization_id: orgId, class_limit: 5, class_seat_limit: 35, status: "active" }),
      }).catch(() => null);
    }
  }

  // Test classroom, with the dev user as instructor.
  let classroomId: string | null = null;
  if (orgId) {
    const classLookup = await fetch(`${supabaseUrl}/rest/v1/classrooms?organization_id=eq.${orgId}&name=eq.${encodeURIComponent(DEV_CLASS_NAME)}&select=id`, { headers: adminHeaders });
    if (classLookup.ok) {
      const rows = await classLookup.json().catch(() => []);
      classroomId = rows[0]?.id ?? null;
    }
    if (!classroomId) {
      const classCreate = await fetch(`${supabaseUrl}/rest/v1/classrooms`, {
        method: "POST",
        headers: { ...adminHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ organization_id: orgId, name: DEV_CLASS_NAME, term: "Test", created_by: userId }),
      });
      const classRows = await classCreate.json().catch(() => []);
      if (!classCreate.ok) console.error("[dev/login] classroom creation failed:", classRows);
      classroomId = classCreate.ok ? classRows[0]?.id ?? null : null;
    }
  }

  if (classroomId) {
    const classMembershipLookup = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?classroom_id=eq.${classroomId}&user_id=eq.${userId}&select=id`, { headers: adminHeaders });
    const classMembershipRows = classMembershipLookup.ok ? await classMembershipLookup.json().catch(() => []) : [];
    if (!classMembershipRows[0]) {
      await fetch(`${supabaseUrl}/rest/v1/classroom_memberships`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ classroom_id: classroomId, user_id: userId, role: "instructor", status: "active" }),
      }).catch(() => null);
    }
  }

  // Mint a real session -- no password anywhere: generate a magic-link token,
  // then redeem it server-side for a live access/refresh token pair.
  const linkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ type: "magiclink", email: DEV_TEST_EMAIL }),
  });
  const linkData = await linkResponse.json().catch(() => null);
  const hashedToken = linkData?.properties?.hashed_token ?? linkData?.hashed_token;
  if (!linkResponse.ok || !hashedToken) {
    return { error: "Could not generate a sign-in link for the dev test user.", detail: linkData };
  }

  const verifyResponse = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashedToken }),
  });
  const verifyData = await verifyResponse.json().catch(() => null);
  if (!verifyResponse.ok || !verifyData?.access_token) {
    return { error: "Could not verify the dev test session.", detail: verifyData };
  }

  return {
    access_token: verifyData.access_token as string,
    refresh_token: verifyData.refresh_token as string,
    user: { id: (verifyData.user?.id ?? userId) as string, email: (verifyData.user?.email ?? DEV_TEST_EMAIL) as string },
  };
}

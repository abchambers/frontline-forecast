import { NextRequest, NextResponse } from "next/server";

const PAST_DUE_GRACE_DAYS = 30;
const SUSPENDED_GRACE_DAYS = 30;

type Entitlement = { id: string; organization_id: string; status: string; status_changed_at: string; next_payment_due_at: string | null };

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Billing storage is not configured." }, { status: 500 });
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const now = new Date();

  try {
    // A school on a free/never-billed trial has no payment due — trial
    // expiry is a separate, unrelated concern (organization_entitlements.ends_at).
    // Only an already-paying ('active') entitlement can go past due.
    const activeResponse = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?select=id,organization_id,status,status_changed_at,next_payment_due_at&status=eq.active`, { headers, cache: "no-store" });
    if (!activeResponse.ok) throw new Error("Unable to load active entitlements.");
    const active = await activeResponse.json() as Entitlement[];
    const nowPastDue = active.filter((entitlement) => entitlement.next_payment_due_at && new Date(entitlement.next_payment_due_at) <= now);
    let markedPastDue = 0;
    for (const entitlement of nowPastDue) {
      const response = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?id=eq.${entitlement.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "past_due", status_changed_at: now.toISOString() }) });
      if (response.ok) markedPastDue += 1;
    }

    // past_due is deliberately invisible to students — out of respect for the
    // school while it works out payment, nothing changes for their classes.
    // Only once the grace period fully elapses does anyone's access change.
    const pastDueResponse = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?select=id,organization_id,status,status_changed_at,next_payment_due_at&status=eq.past_due`, { headers, cache: "no-store" });
    if (!pastDueResponse.ok) throw new Error("Unable to load past-due entitlements.");
    const pastDue = await pastDueResponse.json() as Entitlement[];
    const graceExpired = pastDue.filter((entitlement) => new Date(entitlement.status_changed_at).getTime() + PAST_DUE_GRACE_DAYS * 86_400_000 <= now.getTime());
    let suspendedSchools = 0;
    let suspendedStudents = 0;
    for (const entitlement of graceExpired) {
      const response = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?id=eq.${entitlement.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "suspended", status_changed_at: now.toISOString() }) });
      if (!response.ok) continue;
      suspendedSchools += 1;
      // Only student-role classroom memberships are cascaded — instructors/
      // coordinators keep their own active membership so they can still see
      // the lapse and renew, rather than being locked out of their own class.
      const classroomsResponse = await fetch(`${supabaseUrl}/rest/v1/classrooms?select=id&organization_id=eq.${entitlement.organization_id}`, { headers, cache: "no-store" });
      const classrooms = classroomsResponse.ok ? await classroomsResponse.json() as { id: string }[] : [];
      for (const classroom of classrooms) {
        const membershipResponse = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?classroom_id=eq.${classroom.id}&role=eq.student&status=eq.active`, {
          method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ status: "suspended" }),
        });
        if (membershipResponse.ok) {
          const rows = await membershipResponse.json().catch(() => []) as unknown[];
          suspendedStudents += rows.length;
        }
      }
    }

    // Students are already suspended by the step above — cancellation is a
    // bookkeeping finality marker for the school itself (distinguishing a
    // temporary lapse from a fully churned account), not a further access change.
    const suspendedResponse = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?select=id,organization_id,status,status_changed_at,next_payment_due_at&status=eq.suspended`, { headers, cache: "no-store" });
    if (!suspendedResponse.ok) throw new Error("Unable to load suspended entitlements.");
    const suspended = await suspendedResponse.json() as Entitlement[];
    const cancelable = suspended.filter((entitlement) => new Date(entitlement.status_changed_at).getTime() + SUSPENDED_GRACE_DAYS * 86_400_000 <= now.getTime());
    let canceled = 0;
    for (const entitlement of cancelable) {
      const response = await fetch(`${supabaseUrl}/rest/v1/organization_entitlements?id=eq.${entitlement.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "canceled", status_changed_at: now.toISOString() }) });
      if (response.ok) canceled += 1;
    }

    return NextResponse.json({ markedPastDue, suspendedSchools, suspendedStudents, canceled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Billing lifecycle check failed." }, { status: 500 });
  }
}

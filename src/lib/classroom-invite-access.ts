const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

type Args = {
  supabaseUrl: string;
  anonKey: string;
  authorization: string;
  callerId: string;
  classroomId: string;
  fetchImpl?: typeof fetch;
};

// Mirrors the database's frontline_private.can_manage_classroom_roster, using the CALLER's own token so
// every read is row-level-security scoped to what they may already see -- the route's service-role key is
// never used to decide who is allowed. Any error or unexpected shape means "no": this fails closed.
export async function callerCanManageClassroom({ supabaseUrl, anonKey, authorization, callerId, classroomId, fetchImpl = fetch }: Args): Promise<boolean> {
  if (!isUuid(callerId) || !isUuid(classroomId)) return false;
  const headers = { apikey: anonKey, Authorization: authorization };
  const rows = async (path: string): Promise<Record<string, unknown>[] | null> => {
    try {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, { headers });
      if (!response.ok) return null;
      const body = await response.json();
      return Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  };

  const profile = await rows(`profiles?id=eq.${callerId}&select=role`);
  if (profile?.some((row) => row.role === "owner" || row.role === "admin")) return true;

  const membership = await rows(`classroom_memberships?classroom_id=eq.${classroomId}&user_id=eq.${callerId}&status=eq.active&select=role`);
  if (membership?.some((row) => row.role === "instructor" || row.role === "assistant")) return true;

  const classroom = await rows(`classrooms?id=eq.${classroomId}&select=organization_id`);
  const organizationId = classroom?.[0]?.organization_id;
  if (!isUuid(organizationId)) return false;
  const organization = await rows(`organization_memberships?organization_id=eq.${organizationId}&user_id=eq.${callerId}&status=eq.active&select=role`);
  return Boolean(organization?.some((row) => row.role === "owner" || row.role === "admin" || row.role === "instructor"));
}

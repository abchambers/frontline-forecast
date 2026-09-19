export type StoredSession = { access_token: string; refresh_token?: string; user: { id: string; email?: string } };

export type RefreshResult =
  | { kind: "refreshed"; session: StoredSession }
  | { kind: "rejected" }
  | { kind: "unavailable" };

// Refresh this far ahead of the access token's real expiry so a slow request never races it.
export const REFRESH_LEAD_MS = 5 * 60 * 1000;

export function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

// 0 means "refresh now"; an undecodable token is treated the same way, since we can't prove it's fresh.
export function msUntilRefresh(accessToken: string, now: number): number {
  const expiry = jwtExpiryMs(accessToken);
  if (expiry === null) return 0;
  return Math.max(0, expiry - REFRESH_LEAD_MS - now);
}

export function accessTokenIsUsable(accessToken: string, now: number): boolean {
  const expiry = jwtExpiryMs(accessToken);
  return expiry !== null && expiry - now > 30_000;
}

// Only a definitive rejection of the refresh token itself may end a session. Offline, a 5xx, or a
// 429 says nothing about the token, so the caller must keep the stored session and try again.
export function classifyRefreshStatus(status: number): "rejected" | "unavailable" {
  return status === 400 || status === 401 || status === 403 || status === 404 ? "rejected" : "unavailable";
}

export async function requestRefresh(
  supabaseUrl: string,
  supabaseKey: string,
  refreshToken: string,
  fallbackUser: StoredSession["user"],
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok) return { kind: classifyRefreshStatus(response.status) };
  try {
    const data = await response.json();
    if (!data?.access_token) return { kind: "unavailable" };
    return { kind: "refreshed", session: { access_token: data.access_token, refresh_token: data.refresh_token ?? refreshToken, user: data.user ?? fallbackUser } };
  } catch {
    return { kind: "unavailable" };
  }
}

export function readStoredSession(key: string): { session: StoredSession; persistent: boolean } | null {
  const persistentRaw = window.localStorage.getItem(key);
  const raw = persistentRaw ?? window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as StoredSession;
    if (!session?.access_token || !session.user?.id) return null;
    return { session, persistent: Boolean(persistentRaw) };
  } catch {
    return null;
  }
}

export function writeStoredSession(key: string, session: StoredSession, persistent: boolean) {
  const value = JSON.stringify(session);
  if (persistent) {
    window.sessionStorage.removeItem(key);
    window.localStorage.setItem(key, value);
  } else {
    window.localStorage.removeItem(key);
    window.sessionStorage.setItem(key, value);
  }
}

export function clearStoredSession(key: string) {
  window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
}

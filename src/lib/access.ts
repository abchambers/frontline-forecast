export type PersonalTier = "free" | "paid";

// School access to model data isn't a tier flag — it's derived from an active
// organization/classroom membership, which the caller already has loaded for
// the workspace switcher. Mirrors the has_model_data_access() Postgres
// function so client-side gating and the RLS-adjacent check stay in sync.
export function hasModelDataAccess({
  personalTier,
  isPlatformAdmin,
  hasSchoolMembership,
}: {
  personalTier: PersonalTier;
  isPlatformAdmin: boolean;
  hasSchoolMembership: boolean;
}): boolean {
  return isPlatformAdmin || personalTier === "paid" || hasSchoolMembership;
}

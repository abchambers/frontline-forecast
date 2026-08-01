# Production migration baseline

The production Supabase project has a small amount of intentional history that
was applied through the SQL editor before it could be recorded under the local
migration naming scheme. That history must not be replayed, renamed, or deleted.

| Local source | Production state | Handling |
| --- | --- | --- |
| `202607310001_school_branding.sql` | Applied directly before migration history was recorded | Reconciled forward by `*_reconcile_school_branding_and_staff_policy.sql`; do not run the historical file again. |
| `202607310002_exempt_school_staff_from_learner_seats.sql` | Applied remotely under `exempt_school_staff_from_learner_seats` and `apply_staff_seat_policy` entries | Reconciled forward by `*_reconcile_school_branding_and_staff_policy.sql`; retain the historical files as the source narrative. |
| `*_reconcile_school_branding_and_staff_policy.sql` | Canonical baseline from this point forward | Apply once through the Supabase migration workflow, then verify RLS and RPC grants. |

The reconciliation migration is deliberately idempotent. It establishes the
existing school-branding table, storage policies, staff-seat triggers, and RPC
execution grants in their current intended state. It does not change license
allocations, customer records, or user memberships.

## Before applying

1. Confirm the target is the production project, `qklixlnhzpabrewixkub`.
2. Confirm there is no concurrent school-branding or licensing deployment.
3. Run the read-only checks in [production verification](production-verification.md).

## After applying

1. Confirm `organization_branding` has RLS enabled.
2. Confirm `anon` cannot execute the three licensing RPCs.
3. Confirm `authenticated` can execute the intended code-redemption RPCs.
4. Record the deployment time and migration version in the HQ change record.

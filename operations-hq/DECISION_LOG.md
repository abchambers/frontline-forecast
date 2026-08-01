# Decision Log

| Date | Decision | Status | Consequence |
| --- | --- | --- | --- |
| 2026-07-23 | Keep public weather, professional forecasting, and education products under one brand with modular product boundaries | Adopted | Shared identity/data contracts; distinct scopes and navigation |
| 2026-07-23 | Classroom forecasts remain private to the classroom and never alter public Frontline Forecast output | Adopted | Education can be a safe practice space without compromising public trust |
| 2026-07-23 | Adopt Frontline Forecast as the proposed visible product and company brand | Adopted pending clearance | Existing technical identifiers and deployment URLs remain stable until a deliberate migration |
| 2026-07-23 | School codes are invitation/redemption mechanisms, not proof of a paid license | Adopted | Billing entitlement remains server-controlled and auditable |
| 2026-07-23 | Provider-neutral data layer precedes owned models/sensor network | Adopted | Current APIs remain replaceable as first-party data matures |
| 2026-07-23 | Concept Lab is isolated from production UI, styles, APIs, and deployment | Adopted | Design exploration cannot accidentally regress the live product |
| 2026-07-31 | Custom domains are live in production: `frontline-forecast.com` (public app) and `hq.frontline-forecast.com` (Company HQ) | Confirmed | `PROJECT_AND_URL_TRANSITION.md` and `RUNBOOKS.md` referencing the old `.vercel.app` URL as current production are superseded; updated 2026-07-31 |
| 2026-07-31 | Both the public app and Company HQ currently connect to the same Supabase project (`frontline-forecast` / `qklixlnhzpabrewixkub`); the separate `Company HQ` Supabase project exists but is unused/stale | Identified, not yet resolved | Internal-only data (employee records, security controls, documents, roadmap, accounts, expenses, activity log) is co-located with the public consumer app's database rather than isolated as originally intended; tracked as a foundation-work item on the Operating Board |
| 2026-08-01 | `operations-hq/` is the single canonical home for company decision/planning docs; the parallel `docs/operations/` and `docs/superpowers/` locations created during the 2026-07-31 hardening pass are retired | Adopted | Commercial readiness controls, production verification, migration baseline, and the foundation-hardening plan/design moved into `operations-hq/` (see README index); avoids two tools/sessions recording company decisions in different places |

## How to use this log

Add a row only for decisions that change scope, security, privacy, commercial direction, or architecture. Do not use it for small visual adjustments.

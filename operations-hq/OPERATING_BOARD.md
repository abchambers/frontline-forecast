# Operating Board

Update this board when work changes state. It is the company-facing source of planning truth; the production application is not a project-management tool.

## Now — foundation work

| Outcome | Why it matters | Definition of done | Dependency |
| --- | --- | --- | --- |
| Production confirmation return | New users finish registration on the real app, not localhost | Supabase Site URL/redirect allow-list configured; confirmation opens the production app; one end-to-end sign-up tested | Supabase dashboard configuration |
| Licensing data foundation | Schools can eventually be licensed without hand-managing every student | Migration applied; RLS reviewed; redemption transaction tested with a pilot organization | Apply licensing migration |
| Pilot journey audit | One instructor and one student can use the education loop without intervention | Register → join → assignment → submit → review is documented and tested | Confirmation return |
| Separate HQ data from the public site's database | Internal-only data (employee records, security controls, documents, roadmap, accounts, expenses) currently lives in the same Supabase project as the public consumer app instead of the dedicated Company HQ project, increasing exposure risk beyond RLS alone | HQ-only tables migrated to the Company HQ Supabase project; public app reads/writes HQ data only through narrow server-side endpoints, never direct DB access from the client; stale duplicate data in the Company HQ project reconciled or cleared | See decision log 2026-07-31 |

## Next — productization

| Outcome | Why it matters | Definition of done |
| --- | --- | --- |
| Organization plan and invite views | School owners can understand seats and issue invitations | Simple entitlement summary, code creation, redemption, and expired-seat states |
| Auth hardening | Sessions and authorization become reliable across devices | Cookie-backed Supabase SSR auth; server-side claims validation; callback and reset paths covered |
| Operational visibility | Failures and provider costs are actionable | Error monitoring, source status, request/usage metering, cost alerts |
| Pilot materials | An educator can evaluate the product without a live walkthrough | One-page onboarding, classroom setup guide, support intake path |

## Research before committing

| Question | Decision needed before build |
| --- | --- |
| Billing provider and pricing | Subscription/contract model, trial length, taxes/invoicing, support burden |
| School privacy | Intended age range, pilot agreements, FERPA/COPPA posture, retention/export requirements |
| Data rights | Commercial use, attribution, caching, and redistribution rights for every source |
| Long-term domain model | Company domain, app subdomain, public weather domain, email domain |
| First paying customer | Instructor, department, school program, or professional forecast user |

## Intentionally deferred

- Running a proprietary numerical weather model.
- Selling or redistributing raw weather data as an API.
- Publicly publishing classroom/student forecasts.
- Enterprise SSO and roster-sync integrations.
- Full visual redesign of the live application.

Each is valuable, but none belongs ahead of secure onboarding, a successful pilot, and a known unit-cost model.

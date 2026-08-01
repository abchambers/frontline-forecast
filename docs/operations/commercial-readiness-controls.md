# Commercial readiness controls

This is the minimum operating checklist before Frontline Forecast accepts money,
schools, or personally identifiable student records. It separates controls
already implemented in the applications from controls that must be enabled in
provider accounts or through a selected operational service.

## Implemented in the applications

- Public and HQ deployments use a pinned, audited dependency tree.
- HTTP responses include a CSP, framing protection, referrer policy, and a
  restrictive permissions policy.
- HQ operating records are owner-only; public site content is explicitly
  published before it becomes anonymously readable.
- School branding and school access are protected by RLS and licensing
  allocations.
- Sensitive server credentials are not sent to the browser.

## Account-level controls to complete

| Control | Owner action | Evidence to retain |
| --- | --- | --- |
| Vercel environment values | Configure each value only in the matching production project. Never paste a secret into source, an issue, or a browser client. | Environment-variable inventory with owners and last review date. |
| `SUPABASE_SERVICE_ROLE_KEY` | Keep this server-only in Frontline Forecast. HQ may use it only as a server-side invitation-delivery credential; never prefix it with `NEXT_PUBLIC_`. | Access inventory and rotation date. |
| Leaked-password protection | Enable Supabase **leaked-password protection** when the selected plan permits it. | Screenshot or security-control record. |
| Auth redirect URLs | Restrict Supabase redirect URLs to `https://frontline-forecast.com`, `https://hq.frontline-forecast.com`, and approved local development URLs. | Auth URL configuration review. |
| Backups and recovery | Select a backup tier, document retention, and perform a restore drill into a non-production environment before commercial launch. | Dated restore drill result and recovery time. |
| Durable request protection | Select a durable rate limit / bot-control provider at the edge or API gateway. Do not rely on an in-memory application limiter. | Provider configuration and tested threshold. |
| Error alerts | Configure production error and uptime alerts for both domains and the weather-data endpoints. | Alert test receipt and escalation owner. |
| Provider terms | Record licensing, attribution, retention, and commercial-use terms for weather, model, radar, email, and storage providers in HQ. | Provider review record and renewal date. |

## Release gate

Do not remove the private-workspace posture or open school self-service until
the selected legal, privacy, authentication, backup, monitoring, and durable
rate-limit controls have documented owners. Re-run the checks in
[production verification](production-verification.md) after each security or
database release.

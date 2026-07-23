# Operations HQ

Operations HQ is the private planning and operating workspace for Frontline Forecast. Today it is documentation only. Over time it becomes the protected company control plane for production operations, customer organizations, licensing, source health, and releases.

## Start here

| Workspace | Purpose |
| --- | --- |
| [Operating board](OPERATING_BOARD.md) | What is now, next, blocked, and intentionally deferred |
| [Runbooks](RUNBOOKS.md) | Repeatable release, incident, and customer-operating procedures |
| [Decision log](DECISION_LOG.md) | Decisions that should not be re-litigated in product UI work |
| [Domain and access plan](DOMAIN_AND_ACCESS_PLAN.md) | The eventual `www`, `app`, and private `hq` boundaries |
| [Project and URL transition](PROJECT_AND_URL_TRANSITION.md) | Safe move from the legacy Vercel name before a custom domain |
| [Pilot program](PILOT_PROGRAM.md) | How to run a small, measurable first classroom pilot |
| [Provider register](PROVIDER_REGISTER.md) | Current data sources, commercial gates, attribution, and ownership |
| [Company workspace](../docs/COMPANY_WORKSPACE.md) | Longer-horizon company, revenue, architecture, and risk plan |

## HQ rules

1. A product task earns a place on the board only when it has an owner, a purpose, and a definition of done.
2. Production changes must have a small, testable scope and a rollback path.
3. Customer data, API keys, tokens, and access codes are never recorded in these files.
4. “Interesting” is not enough to build. Tie work to a customer problem, a pilot finding, risk reduction, or revenue hypothesis.
5. Design exploration belongs in [Concept Lab](../concept-lab/README.md), not in production components.

## Future production-control boundary

Operations HQ should eventually control production, but through narrow, audited controls—not by sharing every customer-facing screen or exposing infrastructure credentials in the browser.

```text
Operations HQ (owner/admin only)
  → authenticated server actions / internal APIs
  → Supabase, billing webhooks, provider controls, Vercel operational APIs
  → production Frontline Forecast
```

Planned control areas:

- Organization plans, seats, invitations, suspensions, and support access.
- User/account administration with an audit trail.
- Feature availability, source-provider status, and usage/cost controls.
- Carefully scoped weather-data operations: cache invalidation, source failover, and data-quality review.
- Release visibility and incident response links.

It should **not** become a general back door into student work, raw secrets, or unreviewed production changes. Sensitive actions require server-side authorization, confirmation, audit records, and least-privilege roles.

## Current operating cadence

- **Before each implementation pass:** choose one outcome, review affected scopes, identify acceptance checks.
- **After each implementation pass:** typecheck, inspect the diff, test the affected user flow, document any manual deployment action.
- **Weekly when pilots begin:** review activation, forecast submissions, source failures, support questions, and provider cost.
- **Monthly:** update priorities, customer assumptions, security posture, and the decision log.

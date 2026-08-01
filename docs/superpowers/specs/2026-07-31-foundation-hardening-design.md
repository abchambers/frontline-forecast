# Frontline Forecast Foundation Hardening Design

**Status:** Approved for implementation on July 31, 2026

## Purpose

Make Frontline Forecast and its private Operations HQ reproducible, safer to operate, and testable before further commercial, school, or site-builder expansion.

## Product boundaries

- `frontline-forecast.com` remains the data-first public weather and authenticated forecasting workspace.
- `hq.frontline-forecast.com` remains an owner-only operations application. It governs people, school licenses, service records, finance records, publishing, and security evidence.
- A school may receive a licensed workspace only after an HQ-controlled approval. A future self-service school form creates an intake request; it never creates an entitlement, seats, or access by itself.
- The public application continues to show live-source freshness and hazards. It must not expose HQ records or privileged credentials.

## Phase 1: reproducibility and security

### Migration baseline

The deployed Supabase database has historical drift: school branding was applied directly without its expected migration history entry, and the staff-seat policy was applied under a remote-only migration name. Add one forward-only reconciliation migration that is safe against the existing production schema, records the canonical state, and becomes the baseline for future changes. Do not rewrite or replay historical production migrations.

### Application dependency baseline

Both applications use a vulnerable dependency chain through the currently installed Next.js release. Update the public app and HQ in lockstep to a supported patched Next.js release, commit their lockfiles, and run both production builds after the change.

### Web security baseline

Both apps receive an explicit common response-header policy:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- a restrictive `Permissions-Policy`
- a Content Security Policy that permits the sites' own scripts/styles/images, Supabase authentication, NWS/NOAA links, OpenStreetMap/Leaflet resources, and approved radar/model endpoints without allowing arbitrary framing or plugin execution.

The public app preserves its existing headers. HQ receives the same baseline. CSP is checked against both production builds before deployment.

### API resilience and rate-control boundary

Public endpoints keep their current cache controls and validated inputs. A real request quota is not simulated in process memory because Vercel functions do not share reliable process state. The codebase will document the required durable-control choice: Vercel Firewall/Attack Challenge or a durable rate-limit store before broad public traffic or paid data use.

## Phase 2: workflow verification

Add executable tests for the behavior that can change access or commercial state:

- HQ routes reject unauthenticated or non-owner access.
- A role request can only use supported roles and cannot modify the owner.
- A school contact can be assigned only to an active or trial entitlement; staff assignment does not consume learner seats.
- Learner and class allocation checks remain enforced.
- Classroom-code generation is restricted to an authorized school manager; redemption requires an authenticated user and respects allocation.
- Public publishing exposes only public content, and restore points remain distinct from draft content.
- Public weather, alerts, radar frames, and site configuration retain the expected response contracts.

Tests may use source-contract assertions where external Supabase credentials are unavailable, but each security-critical database function receives a companion SQL verification query against production before release.

## Phase 3: operator readiness

The HQ continues to record provider decisions, security controls, documents, and financial commitments. Before commercial use, add documented operational controls rather than placeholder UI:

- configure and test server-side invitation delivery;
- enable leaked-password protection when the Supabase plan supports it;
- configure automated database backups and run a restore drill;
- configure deployment/runtime alerting;
- record vendor terms, attribution, rate limits, owner, renewal, and fallback before relying on a provider commercially.

## Deferred work after Phase 1

- School pilot-request intake and review queue.
- Delegated employee portal permissions.
- Site-builder layout expansion beyond controlled content and themes.
- Logo small-use lockup and seven-day forecast label refinements.
- Paid radar/model provider selection and a durable public rate-limit service.

## Acceptance criteria

1. Local migration files and the deployed migration ledger have a documented forward-only reconciliation path.
2. Both app dependency audits no longer report the known high-severity Next.js/PostCSS/Sharp chain, or an explicit upstream-blocker record identifies why an update cannot yet be made.
3. Both apps build and type-check successfully after security-header changes.
4. New workflow tests fail before their protections are implemented and pass afterward.
5. A production read-only Supabase check confirms every `public` table has RLS enabled and only published site content is anonymously readable.
6. The final release note distinguishes implemented safeguards from items requiring a Vercel, Supabase, vendor, or company-owner decision.

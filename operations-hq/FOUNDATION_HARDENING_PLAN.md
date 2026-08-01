# Foundation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the live database baseline, remove known vulnerable web dependencies, harden both web applications, and establish repeatable verification for access and school-licensing workflows.

**Architecture:** The public app and HQ remain separate Next.js applications sharing one Supabase project. A forward-only database migration establishes the existing school-branding and staff-seat state as the canonical production baseline. Static application contract tests cover source-level boundaries, while read-only production SQL checks verify RLS and privileged database function exposure.

**Tech Stack:** Next.js 16.2.11, React 19, TypeScript, Supabase Postgres/Auth/Storage, Vercel, Node test runner.

## Global Constraints

- Preserve `frontline-forecast.com` as a data-first public weather site.
- Preserve `hq.frontline-forecast.com` as owner-only until delegated HQ roles are explicitly designed and tested.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or any provider key to the browser.
- Do not replay or rename historical production migrations.
- Use a new forward-only Supabase migration for any live schema change.
- Do not create an in-memory rate limiter as a substitute for durable production enforcement.
- Keep the existing brand assets and user-owned Concept Lab files untouched.
- Use Next.js 16.2.11, the July 2026 active-LTS security release.

---

### Task 1: Establish a forward-only migration baseline

**Files:**
- Create: `supabase/migrations/*_reconcile_school_branding_and_staff_policy.sql`
- Create: `docs/operations/migration-baseline.md`
- Test: `tests/migration-baseline.test.mjs`

**Interfaces:**
- Consumes: existing `organization_branding`, `frontline_private.enforce_school_membership_allocation()`, and `frontline_private.enforce_classroom_membership_capacity()` production objects.
- Produces: an idempotent migration that only creates or replaces the canonical existing objects and a written production migration ledger map.

- [ ] **Step 1: Write the failing baseline test**

```js
test("the production baseline reconciliation records branding and staff seat policy", async () => {
  const migration = await readFile((await glob("supabase/migrations/*_reconcile_school_branding_and_staff_policy.sql"))[0], "utf8");
  assert.match(migration, /create table if not exists public\.organization_branding/);
  assert.match(migration, /new\.role in \('owner', 'admin', 'instructor', 'reviewer'\)/);
  assert.match(migration, /create or replace function frontline_private\.enforce_classroom_membership_capacity/);
});
```

- [ ] **Step 2: Run the test and verify it fails because the reconciliation file does not exist.**

Run: `node --test tests/migration-baseline.test.mjs`

- [ ] **Step 3: Generate the migration with the installed Supabase CLI and implement only idempotent canonical definitions.**

Run: `supabase migration new reconcile_school_branding_and_staff_policy`

The migration must use `create table if not exists`, `create or replace function`, explicit `enable row level security`, explicit policy recreation only when needed, and revocations/grants for the three intended authenticated RPC functions.

- [ ] **Step 4: Record the remote-versus-local mapping in `docs/operations/migration-baseline.md`.**

Document `202607310001_school_branding.sql` as directly applied before migration history, and remote `apply_staff_seat_policy` as the actual staff-seat policy application. State that the new reconciliation migration is the future baseline and must be applied once to production.

- [ ] **Step 5: Run the test and validate the migration against the connected project.**

Run: `node --test tests/migration-baseline.test.mjs`

Run the migration once through Supabase, then run read-only SQL checks proving `organization_branding` has RLS and the staff functions are not executable by `anon`.

- [ ] **Step 6: Commit the migration baseline.**

```bash
git add supabase/migrations docs/operations/migration-baseline.md tests/migration-baseline.test.mjs
git commit -m "Reconcile production migration baseline"
```

### Task 2: Patch the application dependency baseline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `company-hq/package.json`
- Modify: `company-hq/package-lock.json`
- Test: existing build and type-check commands

**Interfaces:**
- Consumes: Next.js App Router code in both applications.
- Produces: matching patched Next.js dependency trees with no known high-severity Next/PostCSS/Sharp advisory chain.

- [ ] **Step 1: Capture the failing audit state.**

Run: `npm audit --omit=dev --json`

Expected before the update: the `next`, `postcss`, and `sharp` advisory chain is present.

- [ ] **Step 2: Update each application to the active-LTS security release.**

Run from each application root:

```bash
npm install next@16.2.11
```

- [ ] **Step 3: Verify dependency safety and compatibility.**

Run:

```bash
npm audit --omit=dev
npm run typecheck
npm run build
npm --prefix company-hq audit --omit=dev
npm --prefix company-hq run typecheck
npm --prefix company-hq test
npm --prefix company-hq run build
```

- [ ] **Step 4: Commit the patched lockfiles.**

```bash
git add package.json package-lock.json company-hq/package.json company-hq/package-lock.json
git commit -m "Patch application dependencies"
```

### Task 3: Apply a shared web security-header policy

**Files:**
- Create: `src/lib/security-headers.ts`
- Create: `company-hq/lib/security-headers.ts`
- Modify: `next.config.ts`
- Modify: `company-hq/next.config.ts`
- Test: `tests/security-headers.test.mjs`
- Test: `company-hq/tests/security-headers.test.mjs`

**Interfaces:**
- Produces: `securityHeaders()` returning the response headers used by each app's `NextConfig.headers()`.
- Contract: CSP permits only self-hosted assets and the known Supabase/NWS/NOAA/OpenStreetMap/Leaflet/RainViewer/Open-Meteo/OpenWeather connections needed by each site.

- [ ] **Step 1: Write failing tests for the shared baseline.**

```js
test("public security headers deny framing and include a restrictive CSP", async () => {
  const { securityHeaders } = await import("../src/lib/security-headers.ts");
  const headers = securityHeaders();
  assert.equal(headers.find((header) => header.key === "X-Frame-Options")?.value, "DENY");
  assert.match(headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "", /default-src 'self'/);
  assert.match(headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "", /frame-ancestors 'none'/);
});
```

- [ ] **Step 2: Run the tests and verify they fail because the helper does not exist.**

Run: `node --test tests/security-headers.test.mjs && npm --prefix company-hq test`

- [ ] **Step 3: Implement the minimal header helper and configure both apps to use it.**

The policy must include `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, and `form-action 'self'`. It must avoid `unsafe-eval`. It may include `unsafe-inline` only where the deployed Next.js application demonstrably requires it.

- [ ] **Step 4: Run unit tests, builds, and production header probes.**

Run both builds, then use `curl -I` against public root and HQ login to confirm CSP, frame, referrer, content-type, and permissions headers.

- [ ] **Step 5: Commit the header hardening.**

```bash
git add src/lib/security-headers.ts company-hq/lib/security-headers.ts next.config.ts company-hq/next.config.ts tests/security-headers.test.mjs company-hq/tests/security-headers.test.mjs
git commit -m "Harden web security headers"
```

### Task 4: Add workflow and database verification contracts

**Files:**
- Modify: `tests/public-navigation-and-radar.test.mjs`
- Modify: `company-hq/tests/licensing.test.mjs`
- Create: `company-hq/tests/access-workflows.test.mjs`
- Create: `docs/operations/production-verification.md`

**Interfaces:**
- Consumes: HQ server actions and public app feature boundaries.
- Produces: regression coverage for owner-only workflows, school contact eligibility, seat/class policy, classroom-code authorization, public publishing boundaries, and live endpoint response shapes.

- [ ] **Step 1: Write failing workflow assertions.**

```js
test("HQ actions use the owner guard before mutating operating records", async () => {
  const actions = await readFile("app/actions.ts", "utf8");
  assert.match(actions, /export async function assignSchoolContact[\s\S]*const user = await owner\(\)/);
  assert.match(actions, /export async function resolveUserAccessRequest[\s\S]*const user = await owner\(\)/);
});

test("school contact access requires an active entitlement without consuming learner seats", async () => {
  const migration = await readFile((await glob("../supabase/migrations/*_reconcile_school_branding_and_staff_policy.sql"))[0], "utf8");
  assert.match(migration, /new\.role in \('owner', 'admin', 'instructor', 'reviewer'\) then return new/);
});
```

- [ ] **Step 2: Run the new tests and verify each fails for an absent contract or test coverage gap.**

Run: `npm --prefix company-hq test && node --test tests/*.test.mjs`

- [ ] **Step 3: Add the narrowest source contracts and production SQL checklist required to make the workflows observable.**

Document read-only production SQL checks for RLS coverage, anonymous public content, authenticated RPC grants, and school allocation behavior. Do not add a browser-side service-role path.

- [ ] **Step 4: Run all tests and a read-only Supabase verification pass.**

Run all Node tests, then query production for: RLS on each public table, anonymous execution disabled for privileged RPCs, and only `site_content.is_public = true` readable by `anon`.

- [ ] **Step 5: Commit verification coverage.**

```bash
git add tests company-hq/tests docs/operations/production-verification.md
git commit -m "Verify access and licensing workflows"
```

### Task 5: Record production prerequisites without inventing infrastructure

**Files:**
- Create: `docs/operations/commercial-readiness-controls.md`
- Modify: `company-hq/docs/portable-development.md`

**Interfaces:**
- Produces: a concise owner checklist differentiating implemented controls from account-level actions.

- [ ] **Step 1: Write a failing documentation assertion for non-negotiable controls.**

```js
test("commercial readiness distinguishes code controls from account controls", async () => {
  const document = await readFile("docs/operations/commercial-readiness-controls.md", "utf8");
  assert.match(document, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(document, /durable rate limit/);
  assert.match(document, /restore drill/);
  assert.match(document, /leaked-password protection/);
});
```

- [ ] **Step 2: Run the test and verify it fails before the document exists.**

Run: `node --test tests/commercial-readiness.test.mjs`

- [ ] **Step 3: Add the operator checklist.**

Include exact account-level owner actions: configure Vercel environment variables without revealing values, enable Supabase password protection when plan permits, configure backups/restore testing, select durable rate limiting, configure error alerts, and record provider commercial terms.

- [ ] **Step 4: Run the documentation test and complete verification.**

Run: `node --test tests/commercial-readiness.test.mjs && git diff --check`

- [ ] **Step 5: Commit readiness controls.**

```bash
git add docs/operations tests/commercial-readiness.test.mjs company-hq/docs/portable-development.md
git commit -m "Document commercial readiness controls"
```

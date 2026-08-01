# Frontline Forecast — Access Inventory & Code/Live Review
*July 31, 2026*

## What I already have (no need to re-share)

The selected folder already contains everything needed to understand and work on this:

- Both repos, fully checked out: `frontline-forecast` (the public product / "cockpit") and `company-hq` (the corporate control plane), each with its own git history and GitHub remote (`abchambers/frontline-forecast`, `abchambers/frontline-forecast-hq`).
- Excellent internal documentation — `docs/`, `operations-hq/`, and `company-hq/docs/` already cover brand, roles, data contracts, roadmap, and decision history in more depth than most projects I see. I read all of it.
- Live Supabase access to **both** projects (`frontline-forecast` and `Company HQ`) — I can query schema, run SQL, check RLS policies, and pull security/performance advisories directly. Already did.
- `.env.example` / `.env.local` show which providers are wired up: Supabase, OpenWeather, plus NWS/NOAA, Open-Meteo, RainViewer, OSM per the provider register.

## What's still useful to add

1. **Chrome extension connection** (or approve Safari screen access when prompted) — I tried to review the live site interactively and couldn't: the Chrome extension isn't connected, and Safari access wasn't granted, so I fell back to code-only review. This matters most for testing login/session behavior and mobile layout, which is where the team's own docs say the biggest open risk is.
2. **Vercel access** (API token, or just tell me what the dashboard shows) if you want me to confirm production env vars directly rather than inferring from `.env.local`. Not urgent — see finding #1 below, which I'd like your read on either way.
3. Nothing else conceptually — I did not need you to explain the product; the docs already do that well.

One housekeeping note: the local folder is still named "The Weather Desk," but that's just the folder label — the code, brand assets, and docs have already migrated to Frontline Forecast per `operations-hq/BRAND_TRANSITION.md`. No action needed unless you want the folder itself renamed.

---

## Live site review — partial (view-only screenshot)

Chrome extension still isn't connected, so I only have read-only screenshot access via Safari (no clicks, typing, scrolling, or console/network logs). From the one screenshot available:

### Confirmed: the "signed-in users shouldn't see a Sign in tab" bug is live in production

The header shows an active session — `drew.chamberz@gmail.com`, a "Sign out" button, and the `ATSC 4121 MWF Desk` workspace badge are all visible — but the top nav still shows a **"Sign in"** tab alongside Weather / Radar / Forecast / Verify / Class / Control panel.

This is notable because there's a unit test specifically guarding against this exact case (`tests/public-navigation-and-radar.test.mjs`: *"signed-in users do not receive a redundant public sign-in tab"*, asserting `item.target !== "login" || !session`). The test passes because it only checks that a matching string/regex exists somewhere in `src/app/page.tsx` — it doesn't render the component or simulate a signed-in session, so it can't actually catch this. This is a good concrete example of why the current test suite (see finding #6) isn't catching real regressions: the code has the right *intent* somewhere, but the live behavior doesn't match it.

### Undocumented: a custom domain is already live

The browser shows `frontline-forecast.com` as the address — not the `frontline-forecast-the-weather-desk.vercel.app` Vercel URL that `docs/START_HERE.md` and `operations-hq/PROJECT_AND_URL_TRANSITION.md` describe as current production, and `operations-hq/DOMAIN_AND_ACCESS_PLAN.md` describes domain acquisition as a step that hasn't happened yet. Either the domain was bought and pointed at production since those docs were last updated (in which case the docs need a pass, and it's worth double-checking the Supabase Auth Site URL/redirect allow-list was updated to match, per the transition doc's own checklist), or something unexpected is serving that domain. Worth a quick confirm on your end.

Reconnect the Chrome extension for a full interactive pass — I still can't click, scroll, log in as a fresh user, or read console/network errors through Safari's read-only access.

---

## Code & database review — findings

### 1. Two Supabase projects have both grown HQ schema, and neither app points at the one the docs call canonical

`docs/COMPANY_WORKSPACE.md` and `company-hq/docs/consolidated-platform.md` describe the **Company HQ** Supabase project (`avjmhbouzxdfcyoouril`) as "the central platform for both Company HQ and Frontline Forecast" post-migration. I checked both live projects directly:

- Both apps' `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`) point at the **original** `frontline-forecast` project (`qklixlnhzpabrewixkub`), not the Company HQ project.
- That original project has *also* independently accumulated a full HQ control-plane schema (`company_hq_control_plane`, `hq_people_and_workspace_controls`, `hq_provider_review_register`, `hq_employee_records`, `hq_llc_readiness_records`, etc.) — the same kind of tables the Company HQ project has.
- The Company HQ project's migration history stops at `seed_frontline_identity_and_publish` (Jul 26), while the original project has 35+ additional migrations after that, through Jul 31.

So the "consolidation" appears to have been prototyped in the Company HQ project but never actually cut over — the real data both apps write to is the original project, which now has two parallel HQ schemas maturing in two places. This is exactly the drift `company-hq-architecture.md` warns about ("No schema changes should be made until that drift is reconciled") — worth confirming it's still intentional, since it's easy for a future change to land in the wrong project.

### 2. A documented "release blocker" already appears fixed — but the docs don't know it

`company-hq-architecture.md` currently states: *"`hq_profiles` policies query `hq_profiles` again... likely recursive-RLS path. Treat it as a release blocker."*

I pulled the live policies and function definitions on `hq_profiles`. The RLS helpers (`private.is_hq_admin()`, `private.is_hq_active()`, `private.current_hq_role()`) are already `SECURITY DEFINER` functions in a separate `private` schema (migration `move_rls_helpers_to_private_schema`) — the standard fix for this exact recursion pattern. Good news, but the architecture doc should be updated so nobody re-"fixes" it or loses time re-verifying it.

### 3. Session/auth handling is still the manual, pre-hardening version

The Operating Board lists "Auth hardening — cookie-backed Supabase SSR auth" as **Next**, not done. I confirmed this in code: the root app has no `@supabase/supabase-js` or `@supabase/ssr` dependency at all — `src/app/page.tsx` talks to Supabase via raw `fetch` calls and stores access/refresh tokens directly in `localStorage`/`sessionStorage`. Company HQ, by contrast, already uses `@supabase/ssr` with cookie sessions.

This is the team's own top-priority item ("Production confirmation return... Exit criteria: a new user can register, confirm email, join the right workspace, submit a forecast, and be reviewed without manual database repair") and it's still open. I'd treat this as the highest-leverage next build task — it blocks a trustworthy pilot more than anything else in the codebase.

### 4. Security advisor flags on both projects

- **Both** projects: leaked-password protection is disabled in Supabase Auth (checks against HaveIBeenPwned) — one toggle, no code change.
- Several `SECURITY DEFINER` RPCs are callable by `authenticated` (and one, `get_published_site_config`, by `anon` too): `create_classroom_join_code`, `redeem_classroom_join_code`, `redeem_organization_license`, `get_published_site_config`, plus several `can_view_*`/`can_manage_*` helpers. These look intentional (they're the join-code and permission-check functions the product needs), but they're worth one deliberate pass to confirm each is meant to be callable directly via REST and not just from server code.
- `weather_daily_observations` has RLS enabled with **no policies** — meaning the table is currently fully locked down to everyone except service-role, which matches the doc's stated intent ("intentionally service-role-only for now"), just flagging so it's a conscious choice, not an oversight.
- Performance advisors on both projects are routine (unindexed foreign keys, a few unused indexes, some RLS policies re-evaluating `auth.uid()` per row instead of via subselect) — nothing urgent, worth a cleanup pass before scale.

### 5. `src/app/page.tsx` is 2,513 lines — the entire public product UI in one file

Everything (forecast workspace, radar, control center, workspace switching, classroom flows) lives in a single client component. It typechecks clean and passes its tests today, but the roadmap describes this surface growing substantially (organization/seat views, auth hardening, mobile acceptance). Worth breaking into modules before the next big feature lands — it'll only get more expensive to touch later. `company-hq/app/actions.ts` (1,219 lines) has the same shape of issue, one level down.

### 6. Test coverage is thin and mostly string-matching

Three tests total across both repos, and each one asserts that a specific string/regex exists in a source file — not real behavioral or integration tests. Nothing exercises RLS policies, the auth/session flow, or the licensing redemption logic despite those being the areas flagged as highest-risk in the docs. Typecheck is clean in both repos, which is good, but typechecking doesn't catch RLS or auth-flow regressions.

### 7. Company HQ is very early relative to its stated purpose

Company HQ's product spec says it should let non-engineers edit the public site's content/navigation without code. Today it has one API route total and Phase 1 of a 6-phase roadmap is checked off — the dashboard and role foundation exist, but content/navigation editing, publishing/rollback, and the Frontline Forecast entitlement contract don't exist yet. Not a bug, just worth knowing "the cockpit can edit the public site" isn't true yet if that's an near-term expectation.

### 8. Commercial launch gates are real and already documented — re-flagging because they're hard blockers

`operations-hq/PROVIDER_REGISTER.md` already calls this out clearly: Open-Meteo's free tier and RainViewer's free tier both explicitly prohibit commercial use in their terms. This isn't a code fix — it's a "don't flip on billing until you've upgraded or replaced these" gate. Already on your radar per the docs, just confirming it's still accurate and unresolved.

---

## Suggested next actions, in order

1. Decide/confirm which Supabase project is actually canonical going forward and update `consolidated-platform.md` to match reality (or finish the cutover if the Company HQ project was meant to become primary).
2. Update `company-hq-architecture.md` to remove the stale "release blocker" RLS recursion note.
3. Build the SSR/cookie session hardening for the main app — it's the one item standing between "works for me locally" and "safe for a real pilot user."
4. Reconnect Chrome (or grant Safari access) so I can actually test the live app end-to-end, not just read the code.
5. Toggle on leaked-password protection in both Supabase projects — five-minute fix.

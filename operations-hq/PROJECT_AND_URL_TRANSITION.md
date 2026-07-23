# Project and URL transition

This records the controlled transition from the legacy technical project name to Frontline Forecast **before** a custom domain is purchased.

## Decision

- Customer app Vercel project: `frontline-forecast` ✓
- Current Vercel production URL: `https://frontline-forecast-the-weather-desk.vercel.app` ✓
- Company HQ future Vercel project: `frontline-forecast-hq`
- GitHub repository: keep `abchambers/nextjs` for this pass. It is an internal source identifier, not a customer-facing brand.

The project and URL were verified through Vercel. Do not type another assumed address into authentication settings from memory.

## Manual order

1. The Vercel Project Name has been changed to `frontline-forecast` and its production deployment has been verified.
2. In **Settings → Environment Variables**, set the Production value of `NEXT_PUBLIC_SITE_URL` to `https://frontline-forecast-the-weather-desk.vercel.app`. Do not put a trailing path in it. Redeploy the latest successful commit after saving it.
3. In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to `https://frontline-forecast-the-weather-desk.vercel.app`. Add these redirect URLs:
   - the new exact production URL followed by `/**`
   - `https://*-the-weather-desk.vercel.app/**` for Vercel previews
   - `http://localhost:3000/**` and `http://localhost:3001/**` for local work
   - keep `https://nextjs-the-weather-desk.vercel.app/**` only while it still resolves and until confirmation-email testing succeeds.
4. Send one confirmation or password-reset message to a test account. It must return to Frontline Forecast rather than `localhost` or an obsolete Vercel address.
5. The repository fallbacks, README, and operating docs are updated in this same change. Do not rename the GitHub repository, Supabase project, database, or API identifiers in this step.

## Why this order

Vercel automatically gives projects a `.vercel.app` address based on the project name. Supabase uses its Site URL as the default for confirmation and reset messages, and it only honors explicit redirect targets in its allow-list. Configure both deliberately so registration never points at a local machine. See the [Vercel project naming guide](https://vercel.com/kb/guide/how-do-i-change-the-name-of-my-vercel-project) and [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).

## Intentionally not done here

- Buying or configuring a company domain.
- Renaming the Vercel team (`the-weather-desk`).
- Renaming the GitHub repository.
- Renaming the Supabase project, database, or API identifiers.
- Pointing a public link at HQ.

Those are separate changes with their own rollback and authentication checks.

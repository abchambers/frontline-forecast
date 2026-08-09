# Frontline Forecast launchpad

Use this page to resume work from any computer. Bookmark the links you use most.

**AI collaborators**: read [`WORKING_WITH_ANDREW.md`](WORKING_WITH_ANDREW.md) first — it's auto-loaded via `CLAUDE.md` in this repo, but worth knowing it exists.

**Setting up on a brand-new Mac with nothing installed?** Use [`new-machine-setup.md`](new-machine-setup.md) — covers Homebrew, GitHub CLI, and everything below from zero.

## Use the product

- [Frontline Forecast production app](https://frontline-forecast.com/)
- [Same-Wi-Fi local development link](http://Bulldogs-MacBook-Pro.local:3000) — works only while this Mac is awake, on the same Wi-Fi, and running `npm run dev:lan`.

For normal work on another device, use production. `localhost` is private to the computer on which the server is running.

## Build and deploy

- [Production repository](https://github.com/abchambers/frontline-forecast)
- [Production Vercel project](https://vercel.com/the-weather-desk/frontline-forecast)
- [Company HQ repository](https://github.com/abchambers/frontline-forecast-hq)
- [Company HQ Vercel project](https://vercel.com/the-weather-desk/frontline-forecast-hq)
- [Supabase project dashboard](https://supabase.com/dashboard/project/qklixlnhzpabrewixkub)
- [Radar worker app](https://frontline-forecast-radar.fly.dev/) — `radar-worker/` in this repo, a persistent Fly.io service (not Vercel), does NOT auto-deploy from git push. Deploy with `fly deploy --app frontline-forecast-radar` from inside `radar-worker/`.

## Workspaces and decisions

- [Operations HQ](../operations-hq/README.md)
- [Operating board](../operations-hq/OPERATING_BOARD.md)
- [Company workspace](COMPANY_WORKSPACE.md)
- [Concept Lab](../concept-lab/README.md)
- [Project and URL transition](../operations-hq/PROJECT_AND_URL_TRANSITION.md)

## Local development, when needed

From the production repository:

```bash
npm install
cp .env.example .env.local
npm run dev:lan
```

Company HQ is a separate repository, gitignored from this one — clone it into `company-hq/` inside this project:

```bash
git clone https://github.com/abchambers/frontline-forecast-hq.git company-hq
cd company-hq && npm install && cp .env.example .env.local
```

Then open the same-Wi-Fi link above from another device. Keep `.env.local` private; never copy server-only keys into a chat, document, or public repository. Note: several Vercel-stored values are marked "Sensitive" and cannot be re-viewed there once saved — get the Supabase keys from the [Supabase dashboard](https://supabase.com/dashboard/project/qklixlnhzpabrewixkub) (Settings → API) instead if you don't already have them saved.

## Current boundaries

- The public app, Company HQ, and Concept Lab remain separate projects.
- HQ is connected to its own GitHub and Vercel project but is not a public production control plane yet.
- School license data now exists in Supabase; the owner-facing code and entitlement screens will be a later, deliberate feature pass.

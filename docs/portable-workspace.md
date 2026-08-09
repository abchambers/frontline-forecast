# Run Frontline Forecast on another computer

If you're an AI collaborator setting this up, also read [`WORKING_WITH_ANDREW.md`](WORKING_WITH_ANDREW.md) — auto-loaded via `CLAUDE.md`, but flagging it here too.

## The easy way: open the live site

Use [production Frontline Forecast](https://frontline-forecast.com/) on any phone, tablet, or computer. It is deployed on Vercel, so it remains available when this Mac is asleep, powered off, or its Terminal windows are closed.

## Develop from another computer

1. Install Git and Node.js (via Xcode Command Line Tools, or `brew install node` — no specific version is currently pinned).
2. Clone the repository (private — you'll need `gh auth login` or an SSH key set up first, plain HTTPS password auth won't work):

   ```bash
   git clone https://github.com/abchambers/frontline-forecast.git
   cd frontline-forecast
   ```

3. Company HQ is a genuinely separate repository, gitignored from this one — clone it into `company-hq/` inside this project if you need it:

   ```bash
   git clone https://github.com/abchambers/frontline-forecast-hq.git company-hq
   ```

4. Install packages (in both folders if you cloned Company HQ too):

   ```bash
   npm install
   cd company-hq && npm install && cd ..
   ```

5. Copy `.env.example` to `.env.local` in each folder and fill in the values from the existing development computer or the provider dashboards. The Supabase service-role key and cron secret are server-only; keep them private. `.env.local` is intentionally private and is not included in Git. Several values in Vercel's dashboard are marked "Sensitive" and can never be re-viewed there once saved — get the Supabase URL/keys directly from the [Supabase dashboard](https://supabase.com/dashboard/project/qklixlnhzpabrewixkub) (Settings → API) instead.
6. Start development:

   ```bash
   npm run dev
   ```

7. Open the address printed by Next.js, usually `http://localhost:3000`. If you're on Safari and the page loads with no styling at all, that's a known Safari quirk (it auto-upgrades `localhost` requests to HTTPS, which fails against the plain-HTTP dev server) — use `http://localhost:3000` explicitly, or just use Chrome.

Run `npm run typecheck` and `npm run build` before committing. Push work to a review branch; Vercel creates a preview, and reviewed changes can then be promoted or merged to `main`.

## Important distinction

- Closing a Terminal window stops only the local development server on that computer.
- The Vercel production site, Supabase authentication/archive, and scheduled verification jobs keep running independently.
- A local draft and browser preferences are stored per browser. Sign in to see the same cloud archive on another device; copy or recreate an unfinished local-only draft if you need it on a new machine.
- Published wording and design tokens come from Company HQ with code-defined fallbacks. If HQ is unavailable, the last deployed application remains usable.

## Optional: show a running local build on another device

Only while the development computer remains on and connected to the same network:

```bash
npm run dev:lan
```

From another device on the same Wi-Fi network, open [http://Bulldogs-MacBook-Pro.local:3000](http://Bulldogs-MacBook-Pro.local:3000). If that name does not resolve, use the network address printed by Next.js instead. Do not use this as a replacement for Vercel; closing the terminal or computer stops it.

For every-day links to production, dashboards, repositories, and the local-development workflow, use the [Frontline Forecast launchpad](START_HERE.md).

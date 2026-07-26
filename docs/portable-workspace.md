# Run Frontline Forecast on another computer

## The easy way: open the live site

Use [production Frontline Forecast](https://frontline-forecast-the-weather-desk.vercel.app/) on any phone, tablet, or computer. It is deployed on Vercel, so it remains available when this Mac is asleep, powered off, or its Terminal windows are closed.

## Develop from another computer

1. Install Git and Node.js 24 (the repository records this in `.nvmrc`).
2. Clone the repository:

   ```bash
   git clone https://github.com/abchambers/frontline-forecast.git
   cd frontline-forecast
   ```

3. Install packages once:

   ```bash
   npm ci
   ```

4. Copy `.env.example` to `.env.local` and fill in the values from the existing development computer or the provider dashboards. The Supabase service-role key and cron secret are server-only; keep them private. `.env.local` is intentionally private and is not included in Git.
5. Start development:

   ```bash
   npm run dev
   ```

6. Open the address printed by Next.js, usually `http://localhost:3000`.

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

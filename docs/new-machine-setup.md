# Setting up a brand-new Mac from scratch

The complete path from a fresh Mac with nothing installed to a running local copy of
Frontline Forecast. This is the exact sequence that worked migrating off a previous
laptop — every step here was actually run and hit real issues along the way, which are
called out inline so they don't need re-discovering.

Run each numbered block, confirm it worked, then move to the next one. A few steps need
you to interact (typing your Mac password, approving a browser login, filling in real
secret values) — those can't be safely scripted end-to-end, so go one block at a time
rather than pasting the whole file at once.

## 1. Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It'll ask for your **Mac's login password** partway through (the one you use to unlock
the computer — not anything to do with GitHub). Type it, hit enter — no characters will
show as you type, that's normal.

**When it finishes**, it prints a "Next steps" section with one or two commands to add
Homebrew to your PATH — run whatever it shows you there. If you miss it, close and
reopen Terminal, then check:

```bash
brew --version
```

If that doesn't print a version number, Homebrew isn't on your PATH yet — re-run
whatever the installer's "Next steps" said, or close/reopen Terminal again.

## 2. GitHub CLI + login

```bash
brew install gh
gh auth login
```

Answer the prompts: **GitHub.com** → **HTTPS** → **Yes** (authenticate Git with your
GitHub credentials) → **Login with a web browser**. It shows a one-time code and opens
your browser — paste the code, approve, done. This also configures `git` itself to use
this login automatically, so no more password prompts on clone/push.

## 3. Node.js

```bash
brew install node
node -v
npm -v
```

Both should print version numbers.

## 4. Clone both repositories

Pick (or create) the folder you want this project to live in, then:

```bash
git clone https://github.com/abchambers/frontline-forecast.git
cd frontline-forecast
git clone https://github.com/abchambers/frontline-forecast-hq.git company-hq
```

**Company HQ must end up nested inside `frontline-forecast/company-hq/`** — that's what
the `.gitignore` and the rest of these docs expect. If you ran the second clone from the
wrong directory, move it:
```bash
mv ~/company-hq ~/frontline-forecast/company-hq
```

## 5. Install dependencies

```bash
npm install
cd company-hq && npm install && cd ..
cd radar-worker && npm install && cd ..
```

You may see an `npm warn install-scripts` warning about `esbuild`/`fsevents` in
radar-worker — that's a newer npm security check, safe to ignore unless you're
specifically working on radar-worker and something native-dependent breaks there.

## 6. Secrets — the one step that can't be scripted

```bash
cp .env.example .env.local
cd company-hq && cp .env.example .env.local && cd ..
```

Then fill in real values. **Important**: Vercel's dashboard marks most of these values
"Sensitive," which means Vercel will never show them again once saved — don't rely on
copying from there. Get them from the source instead:

- **Supabase values** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) — [Supabase dashboard](https://supabase.com/dashboard/project/qklixlnhzpabrewixkub)
  → Settings → API. Same three values go in both `.env.local` files (shared project);
  `company-hq/.env.local` only needs the first two.
- **`NEXT_PUBLIC_SITE_URL`** — not secret, just use `https://frontline-forecast.com`
- **`RADAR_WORKER_URL`** — not secret either: `https://frontline-forecast-radar.fly.dev`
  (not in `.env.example` by default, but worth adding — makes local radar use the real
  fast worker instead of always falling back to slow polling)
- **`CRON_SECRET`** — genuinely unrecoverable from Vercel; for local dev it doesn't need
  to match production, just generate a fresh one:
  ```bash
  openssl rand -hex 32
  ```
- **`OPENWEATHER_API_KEY`, `GRIBSTREAM_API_KEY`, `GRIBSTREAM_DISABLED`,
  `COMPANY_HQ_CONFIG_URL`** — leave blank, all optional/retired features that degrade
  gracefully.

Never paste real secret values into a chat with an AI assistant, even one helping you
set this up.

## 7. Run it

```bash
npm run dev
```

Look for `Local: http://localhost:3000` in the output, then open that in a browser.

**If you're on Safari and the page loads completely unstyled** (no colors, plain text,
broken-looking form controls) — that's a known Safari quirk, not a real bug. Safari
auto-upgrades `localhost` requests to HTTPS, which fails against the plain-HTTP dev
server. Type the address explicitly with `http://` in the address bar, or just use
Chrome.

## That's it

You now have a fully working local copy. See [`START_HERE.md`](START_HERE.md) for
day-to-day links (dashboards, production URLs, deploy commands), and
[`WORKING_WITH_ANDREW.md`](WORKING_WITH_ANDREW.md) if you're an AI collaborator picking
this project up for the first time.

# Working with Andrew — a briefing for whichever AI is reading this

Andrew is the solo founder building Frontline Forecast. This file exists so a new AI
session (new machine, new tool, doesn't matter) doesn't have to re-derive from scratch
what's already been learned working with him. Read this once at the start of a session
in this repo; it should shorten the ramp-up considerably.

## How he communicates

- Short, direct messages. A terse "okay it's done" or "let's do it" is a real
  confirmation to proceed — don't wait for a longer sign-off.
- He corrects with concrete, specific observations, not abstract complaints: a
  screenshot, an exact phrase ("looks salmon," "looks dimmer," "didn't load till I
  played the timeline"), a real error message. Take those literally and investigate with
  real evidence rather than guessing at the cause.
- If something's genuinely ambiguous (not just hard), ask — he'll answer directly and
  you can keep moving. Don't ask about things you can verify yourself by reading code or
  running a command.
- He is not a deeply technical operator (comfortable with the product/business side,
  learning the infra/terminal side as he goes). When a task involves raw terminal
  commands, CLI tools, or anything with real security/password implications, walk him
  through it step by step rather than dumping a wall of commands — confirm each step
  landed before giving the next one.

## Standing authorizations (don't re-ask for these)

- **Push commits to `main` by default.** The deployed site builds from git; unpushed
  work is invisible to him. This has been confirmed repeatedly — just push after
  committing, same as any other project convention.
- Full local Bash/tool access on his dev machines is expected for this project —
  running `fly`, `vercel`, `gh`, `npm`, decode/render scripts, etc. directly is normal
  and welcomed, not something to ask permission for each time.

## What NOT to do unilaterally

- **Never make a recurring-cost infrastructure decision without asking first** — e.g.
  upgrading a Fly.io VM tier for more memory, adding a paid service tier. This has come
  up multiple times (radar-worker memory pressure); the fix each time was an
  algorithmic/resolution change instead, specifically because a cost increase wasn't his
  call to make unilaterally. Always flag the tradeoff and let him decide.
- **Never treat "it compiles" or "it typechecks" as "it works."** This project's entire
  working style is real-evidence verification: live `fly logs`/`vercel logs`, actual
  curl timing, direct pixel/color sampling of rendered output, before/after screenshots,
  real benchmark runs on live data. Several serious bugs in this project (a catastrophic
  concurrency pileup, a real memory leak, a striping artifact) were only caught because
  an assumed-fixed state got re-verified with real evidence instead of trusted at face
  value. Don't declare something fixed without checking it actually behaves correctly
  live.
- **Don't guess at colors, timings, or "how X looks" — measure it.** When something
  visual or performance-related is in question (does this look like RadarScope? is this
  actually faster?), pull the real reference data (sample real pixels, benchmark against
  the old code path on the same live data) rather than eyeballing or assuming.
- Entering passwords, secrets, or payment info anywhere is off-limits regardless of
  context — same as the general safety rules, but worth restating since this project
  involves real CLI tool logins (Fly, Vercel, GitHub) that must go through the user's
  own browser-based login flow, never typed credentials.

## Project shape, for orientation

- **Main app**: this repo (`frontline-forecast`), Next.js on Vercel, Supabase for
  auth/data. Start at [`docs/START_HERE.md`](START_HERE.md) for the full dashboard/repo
  link list.
- **`company-hq/`**: a genuinely separate git repo
  (`github.com/abchambers/frontline-forecast-hq`), its own Vercel project, gitignored
  from this repo on purpose. Internal ops/admin tooling, not the public product.
- **`radar-worker/`**: a subproject of *this* repo (tracked in git, not separate), a
  persistent Node service deployed to Fly.io that does the actual NEXRAD radar
  decode/render work — see the extensive history in this machine's memory files (or ask
  Andrew) before touching it, there's a lot of hard-won, non-obvious tuning in there
  (noise floor, despeckle, correlation-coefficient gating, sampling interpolation, memory
  limits on the `shared-cpu-1x` Fly tier).
- **`operations-hq/`, `concept-lab/`**: also part of this repo, internal planning/docs,
  not deployed.
- Deployment topology: Vercel (main app + HQ, auto-deploys from git push), Fly.io
  (`radar-worker`, needs an explicit `fly deploy` — does NOT auto-deploy from git),
  Supabase (shared database/auth backing both the main app and HQ).

## The big picture he's building toward

A human-first weather forecasting workspace, initially for schools/students, with a
long-term goal of radar quality matching professional apps like RadarScope, eventually
his own model radar and multi-radar mosaic. Currently proof-of-concept/pitch stage, not
yet an LLC. He cares a lot about getting foundational pieces (radar rendering quality,
load time, real evidence-based iteration) right before layering on more features — when
in doubt about priority, ask rather than assume the next feature is more urgent than
polishing what exists.

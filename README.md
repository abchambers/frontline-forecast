# The Weather Desk

A human-first weather forecasting workspace for live weather analysis, student forecasting, saved reference evidence, and automated verification.

## Production

[Open the deployed Weather Desk](https://nextjs-the-weather-desk.vercel.app/). The production app runs on Vercel and does not depend on a local Terminal window being open.

## Run locally

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with your private provider values.
npm run dev
```

Open the local address Next.js prints, usually `http://localhost:3000`.

For moving development to another device, see [the portable workspace guide](docs/portable-workspace.md).

## Included workflows

- Live NWS observations, alerts, 7-day guidance, radar, satellite, and forecast map views
- Forecast worksheets with day/night periods, saved evidence, revisions, and withdrawals
- Reference snapshots for model guidance, observed soundings, and model soundings
- Forecast archive with automatic preliminary/final verification and daily observation archival
- Control Center for workspace, appearance, map, operational, and role settings

# Frontline Forecast HQ

This is a **separate, unconnected Next.js application** for the private company control plane. It does not import production Forecast code, use its styles, share credentials, or call production APIs.

## Current scope

- Visual information architecture for company operations.
- Explicit production-control and security boundary.
- No authentication, data, controls, licenses, or deployment connection yet.

## Local preview

From this folder:

```bash
npm install
npm run dev -- --port 3002
```

## Before deploying it

1. Move this folder into its own GitHub repository named `frontline-forecast-hq` (or create a new repository with this folder as its root).
2. Create a **separate Vercel project** from that repository. Do not change the production Forecast project root directory.
3. Add owner-only authentication before exposing any data or controls.
4. Use separate environment variables and least-privilege service credentials.
5. Add server-side audit logging and confirmation flows before any production action exists.

The later production link should be narrow, audited, and server-only. It must never put weather-provider keys, database service keys, or general production control in the browser.

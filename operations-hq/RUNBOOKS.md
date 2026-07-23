# Operating Runbooks

## Production release

1. Review the intended scope and ensure it does not include `.env.local`, secrets, or local artifacts.
2. Run `npx tsc --noEmit --incremental false` and `git diff --check`.
3. Test the affected path locally with the intended role/workspace.
4. Commit only the intended files and push the reviewed branch.
5. Confirm the Vercel deployment is healthy and test the production URL.
6. Record any manual Supabase/Vercel configuration change in the release note or decision log.

## Authentication configuration

For the current production URL, Supabase Authentication → URL Configuration should include:

```text
Site URL: https://frontline-forecast-the-weather-desk.vercel.app
Redirect URLs:
  https://frontline-forecast-the-weather-desk.vercel.app/**
  http://localhost:3001/**
```

Vercel Production environment also needs:

```text
NEXT_PUBLIC_SITE_URL=https://frontline-forecast-the-weather-desk.vercel.app
```

When a custom domain is adopted, replace the Site URL with the canonical custom domain and keep the Vercel URL only as an intentional fallback.

## Provider or source incident

1. Confirm whether the source itself is unavailable, rate-limited, returning malformed data, or blocked by a missing key.
2. Preserve the error timestamp, endpoint, workspace, and provider response class—never the raw user token or secret.
3. Mark affected UI data as unavailable/stale; do not substitute fabricated guidance.
4. Check fallback behavior and status messaging.
5. After resolution, document root cause, customer impact, prevention, and whether provider cost/rate limits need adjustment.

## School onboarding

1. Create/verify the organization entitlement and capacity.
2. Confirm an organization owner/instructor profile.
3. Create the classroom and its instructor membership.
4. Create a time-limited school or classroom invitation code.
5. Test one student account redemption before distributing the code broadly.
6. Confirm student work is private and instructor review is scoped to the classroom.
7. Provide the instructor with the assignment, review, and support workflow.

## Security response

1. Rotate the affected secret at its provider; do not paste the replacement into chat, source, or documentation.
2. Update Vercel/Supabase environment configuration and redeploy if needed.
3. Review access logs, affected data, and active sessions.
4. Revoke sessions or suspend accounts when exposure requires it.
5. Record the incident privately, then add a prevention task to the Operating Board.

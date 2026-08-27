// Client-side error tracking. Scope is deliberately narrow — Andrew's own words: "I just want
// usage and bug fixing if needed. I dont need access to student data." This file is the one place
// that could accidentally turn into a data-collection surface, so every non-default choice below is
// there specifically to keep it from becoming one:
//   - sendDefaultPii is explicitly false — Sentry otherwise auto-attaches IP address and other
//     ambient identifying info to events.
//   - No replayIntegration() — session replay records on-screen content frame by frame, which could
//     capture a classroom name, a student's typed answer, anything visible. Never add it here without
//     revisiting this decision explicitly.
//   - No Sentry.setUser() anywhere in this codebase — don't add one. If you need to tell two error
//     reports apart, use an anonymous, non-reversible id, never an email or real name.
//   - beforeSend strips any `user` object and any `email` embedded in extras as a second layer, in
//     case a future default or integration starts attaching one automatically.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Error tracking only, not performance/APM — keeps event volume (and therefore cost) down to
    // exactly what Andrew asked for.
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      if (event.extra) delete event.extra.email;
      return event;
    },
  });
}

// Required by the SDK to capture errors during client-side route transitions — a no-op if dsn is
// unset (Sentry.init above was never called, so this just has nothing to report to).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

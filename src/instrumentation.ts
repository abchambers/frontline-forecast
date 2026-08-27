// Server + edge runtime error tracking — see instrumentation-client.ts for the full rationale on
// why every non-default option below exists (Andrew: "I just want usage and bug fixing... I dont
// need access to student data"). Same rules apply here: sendDefaultPii stays false, no
// Sentry.setUser() anywhere in server code either, beforeSend strips anything that slips through.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        delete event.user;
        if (event.request) delete event.request.cookies;
        return event;
      },
    });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        delete event.user;
        if (event.request) delete event.request.cookies;
        return event;
      },
    });
  }
}

export const onRequestError = Sentry.captureRequestError;

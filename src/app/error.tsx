"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Reported without any user context on purpose -- see instrumentation-client.ts for why.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <main className="legal-page">
    <div className="legal-page-inner">
      <p className="eyebrow">Something went wrong</p>
      <h1>This page hit a problem</h1>
      <p>It&rsquo;s been reported and we&rsquo;ll look into it. Trying again usually works.</p>
      <p className="legal-back"><button type="button" onClick={reset}>Try again</button> &nbsp; <a href="/">Back to Frontline Forecast</a></p>
    </div>
  </main>;
}

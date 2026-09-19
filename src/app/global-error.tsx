"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort boundary: renders when the root layout itself fails, so it must supply its own <html>
// and cannot depend on the app's stylesheet or fonts.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <html lang="en">
    <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#eef4fb", color: "#16183d", minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <main style={{ maxWidth: 520 }}>
        <p style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", opacity: .7 }}>Something went wrong</p>
        <h1 style={{ margin: "4px 0 12px" }}>Frontline Forecast hit a problem</h1>
        <p>It&rsquo;s been reported and we&rsquo;ll look into it. Reloading usually fixes it.</p>
        <button type="button" onClick={reset} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #1877d1", background: "#1877d1", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Try again</button>
      </main>
    </body>
  </html>;
}

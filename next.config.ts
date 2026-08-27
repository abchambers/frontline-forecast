import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // nexrad-level-3-data scans its own packets/ directory with fs.readdirSync
  // and require()s each file dynamically at runtime (to sidestep a circular
  // dependency, per its own source comment) — a pattern no bundler can
  // statically analyze. Turbopack fails outright rather than guess; this
  // tells it to skip bundling the package entirely and let Node's own
  // require() handle it at runtime, same as it always did outside a bundler.
  serverExternalPackages: ["nexrad-level-3-data"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
};

// Source-map upload (readable production stack traces) needs SENTRY_ORG/SENTRY_PROJECT/
// SENTRY_AUTH_TOKEN env vars, none of which are set up yet — left disabled so the build never fails
// or warns for their absence. Error capture itself only needs NEXT_PUBLIC_SENTRY_DSN (see
// src/instrumentation.ts / src/instrumentation-client.ts) and works fully without this.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});

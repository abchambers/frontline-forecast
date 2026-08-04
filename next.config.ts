import type { NextConfig } from "next";
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

export default nextConfig;

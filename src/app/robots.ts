import type { MetadataRoute } from "next";

// The Weather Desk is still a private work-in-progress. This keeps public
// crawlers from indexing the development deployment without affecting the
// authenticated forecasting workspace or its API routes.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}

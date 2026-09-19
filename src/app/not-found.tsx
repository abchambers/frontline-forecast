import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return <main className="legal-page">
    <div className="legal-page-inner">
      <p className="eyebrow">404</p>
      <h1>We couldn&rsquo;t find that page</h1>
      <p>The link may be old or mistyped. The live weather, radar, and forecast tools are all one click away.</p>
      <p className="legal-back"><Link href="/">Back to Frontline Forecast</Link></p>
    </div>
  </main>;
}

import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import "./verify-overrides.css";
import { SiteConfiguration } from "./site-configuration";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

// Bump this whenever the favicon/app-icon files in public/ change — see the comment on `icons`
// below for why a plain content swap at the same URL isn't enough to bust Safari's favicon cache.
const ICON_VERSION = "3";

export const metadata: Metadata = {
  // Keep previews and social cards on the canonical production hostname.
  // Auth redirects use the browser's current origin, so this does not override a user's sign-in return URL.
  metadataBase: new URL("https://frontline-forecast.com"),
  title: {
    default: "Frontline Forecast",
    template: "%s | Frontline Forecast",
  },
  description: "Weather analysis, forecasting, and verification.",
  applicationName: "Frontline Forecast",
  openGraph: {
    title: "Frontline Forecast",
    description: "Weather analysis, forecasting, and verification.",
    siteName: "Frontline Forecast",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Frontline Forecast",
    description: "Weather analysis, forecasting, and verification.",
  },
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  // Andrew, live (2026-08-29): after shipping the new FF-lightning mark, Safari's tab icon and
  // bookmark-bar icon both kept showing the old favicon — confirmed via curl that the server was
  // already serving the new files correctly (right byte sizes, `must-revalidate` cache-control), so
  // this wasn't a deploy problem. Safari (and browsers generally) cache favicons more stubbornly
  // than normal assets and don't reliably re-fetch just because the file content changed at the same
  // URL. A version query string makes the URL itself different, which forces every browser to treat
  // it as a new resource — bump ICON_VERSION by hand whenever the icon files change again.
  icons: {
    icon: [
      { url: `/favicon-16.png?v=${ICON_VERSION}`, sizes: "16x16", type: "image/png" },
      { url: `/favicon-32.png?v=${ICON_VERSION}`, sizes: "32x32", type: "image/png" },
      { url: `/icon-192.png?v=${ICON_VERSION}`, sizes: "192x192", type: "image/png" },
      { url: `/icon-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png" },
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: "any" },
    ],
    apple: `/apple-touch-icon.png?v=${ICON_VERSION}`,
    shortcut: `/favicon.ico?v=${ICON_VERSION}`,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-site-content="loading" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}><body><SiteConfiguration />{children}<Analytics /><SpeedInsights /></body></html>;
}

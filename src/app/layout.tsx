import type { Metadata } from "next";
import "./globals.css";
import "./verify-overrides.css";
import { SiteConfiguration } from "./site-configuration";

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
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><SiteConfiguration />{children}</body></html>;
}

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
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-site-content="loading" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}><body><SiteConfiguration />{children}<Analytics /><SpeedInsights /></body></html>;
}

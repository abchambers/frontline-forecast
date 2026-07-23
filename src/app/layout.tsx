import type { Metadata } from "next";
import "./globals.css";
import "./verify-overrides.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://frontline-forecast-the-weather-desk.vercel.app"),
  title: {
    default: "Frontline Forecast",
    template: "%s | Frontline Forecast",
  },
  description: "A human-first weather forecasting workspace for analysis, forecasts, and learning.",
  applicationName: "Frontline Forecast",
  openGraph: {
    title: "Frontline Forecast",
    description: "A human-first weather forecasting workspace for analysis, forecasts, and learning.",
    siteName: "Frontline Forecast",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Frontline Forecast",
    description: "A human-first weather forecasting workspace for analysis, forecasts, and learning.",
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
  return <html lang="en"><body>{children}</body></html>;
}

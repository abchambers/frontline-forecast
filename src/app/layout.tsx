import type { Metadata } from "next";
import "./globals.css";
import "./verify-overrides.css";

export const metadata: Metadata = {
  title: "The Weather Desk",
  description: "A human-first weather forecasting workspace.",
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

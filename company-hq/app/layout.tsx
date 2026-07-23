import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontline Forecast HQ",
  description: "Private company operations workspace for Frontline Forecast.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

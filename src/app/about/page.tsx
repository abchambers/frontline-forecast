import type { Metadata } from "next";
import { AboutPage } from "./about-page";

export const metadata: Metadata = {
  title: "About",
  description: "How Frontline Forecast turns weather evidence into useful context.",
};

export default function Page() { return <AboutPage />; }

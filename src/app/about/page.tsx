import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "About",
  description: "How Frontline Forecast turns weather evidence into useful context.",
};

export default function Page() { redirect("/?view=about"); }

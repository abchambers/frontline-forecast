"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Principle = { title: string; body: string };
type AboutContent = { eyebrow: string; title: string; description: string; principles: Principle[] };
const fallback: AboutContent = { eyebrow: "About Frontline Forecast", title: "Weather tools built around context.", description: "Frontline Forecast brings observations, radar, guidance, and verification together so a forecast can show its reasoning—not just its result.", principles: [{ title: "Read the atmosphere", body: "Start with what is happening now, then make the evidence visible." }, { title: "Make the forecast useful", body: "Turn guidance into a clear, time-bound decision for a real place." }, { title: "Learn from the result", body: "Compare the forecast with what happened and keep improving the next call." }] };
const themeKey = "frontline-forecast-theme";
const savedTheme = () => document.cookie.split("; ").find((item) => item.startsWith(`${themeKey}=`))?.split("=")[1] === "dark" ? "dark" : "light";

export function AboutPage() {
  const [content, setContent] = useState(fallback);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const next = savedTheme(); setTheme(next); document.documentElement.dataset.theme = next;
    fetch("/api/site-config").then((response) => response.ok ? response.json() : null).then((config) => {
      const value = config?.content?.find((item: { content_key?: string }) => item.content_key === "about")?.value as Partial<AboutContent> | undefined;
      if (!value) return;
      setContent({ eyebrow: typeof value.eyebrow === "string" ? value.eyebrow : fallback.eyebrow, title: typeof value.title === "string" ? value.title : fallback.title, description: typeof value.description === "string" ? value.description : fallback.description, principles: Array.isArray(value.principles) ? value.principles.filter((item): item is Principle => Boolean(item) && typeof item === "object" && typeof (item as Principle).title === "string" && typeof (item as Principle).body === "string") : fallback.principles });
    }).catch(() => undefined);
  }, []);
  const toggle = () => { const next = theme === "light" ? "dark" : "light"; setTheme(next); document.documentElement.dataset.theme = next; document.cookie = `${themeKey}=${next}; Path=/; Domain=.frontline-forecast.com; Max-Age=31536000; SameSite=Lax; Secure`; };
  return <main className="about-app"><header className="about-header"><Link href="/" className="about-brand"><img src="/brand/frontline-forecast-mark.png" alt="" /><img className="about-wordmark" src="/brand/frontline-forecast-wordmark.png" alt="Frontline Forecast" /></Link><div><button type="button" className="theme-toggle" onClick={toggle}>{theme === "light" ? "Dark mode" : "Light mode"}</button><Link href="/">Forecast</Link></div></header><section className="about-hero"><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1><p>{content.description}</p></section><section className="about-principles" aria-label="About Frontline Forecast">{content.principles.map((principle, index) => <article key={`${principle.title}-${index}`}><span>0{index + 1}</span><h2>{principle.title}</h2><p>{principle.body}</p></article>)}</section></main>;
}

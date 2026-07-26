"use client";

import { useEffect } from "react";

type PublishedConfig = {
  content?: Array<{ content_key: string; value: Record<string, unknown> }>;
  themes?: Array<{ tokens: Record<string, unknown> }>;
};

const tokenMap: Record<string, string> = {
  colorBackground: "--hq-background",
  colorSurface: "--surface",
  colorText: "--ink",
  colorMuted: "--muted",
  colorAccent: "--accent",
  fontFamily: "--hq-font-family",
  radius: "--hq-radius",
};

export function SiteConfiguration() {
  useEffect(() => {
    let active = true;
    fetch("/api/site-config")
      .then((response) => response.ok ? response.json() as Promise<PublishedConfig> : null)
      .then((config) => {
        if (!active || !config) return;
        const tokens = config.themes?.[0]?.tokens ?? {};
        for (const [key, cssVariable] of Object.entries(tokenMap)) {
          const nextValue = tokens[key];
          if (typeof nextValue === "string" && nextValue.length <= 120) {
            document.documentElement.style.setProperty(cssVariable, nextValue);
          }
        }
        const brand = config.content?.find((item) => item.content_key === "brand")?.value;
        if (brand) {
          const name = document.querySelector<HTMLElement>("[data-hq-content='brand.name']");
          const tagline = document.querySelector<HTMLElement>("[data-hq-content='brand.tagline']");
          if (name && typeof brand.name === "string") name.textContent = brand.name;
          if (tagline && typeof brand.tagline === "string") tagline.textContent = brand.tagline;
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return null;
}

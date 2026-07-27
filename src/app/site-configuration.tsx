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

const colorTokenKeys = new Set([
  "colorBackground",
  "colorSurface",
  "colorText",
  "colorMuted",
  "colorAccent",
]);

function applySharedAppearance(tokens: Record<string, unknown>) {
  const root = document.documentElement;
  root.dataset.accent = typeof tokens.accent === "string" ? tokens.accent : "weather-blue";
  root.dataset.radius = typeof tokens.radius === "string" ? tokens.radius : "medium";
  root.dataset.density = typeof tokens.density === "string" ? tokens.density : "comfortable";
  root.dataset.cards = typeof tokens.cardStyle === "string" ? tokens.cardStyle : "flat";
  root.dataset.gradients = tokens.showGradients === true ? "on" : "off";
}

export function SiteConfiguration() {
  useEffect(() => {
    let active = true;
    let observer: MutationObserver | null = null;
    fetch("/api/site-config")
      .then((response) => response.ok ? response.json() as Promise<PublishedConfig> : null)
      .then((config) => {
        if (!active || !config) return;
        const tokens = config.themes?.[0]?.tokens ?? {};

        const applyTokens = () => {
          const darkMode = document.documentElement.dataset.theme === "dark";
          for (const [key, cssVariable] of Object.entries(tokenMap)) {
            const nextValue = tokens[key];
            if (darkMode && colorTokenKeys.has(key)) {
              document.documentElement.style.removeProperty(cssVariable);
            } else if (typeof nextValue === "string" && nextValue.length <= 120) {
              document.documentElement.style.setProperty(cssVariable, nextValue);
            } else {
              document.documentElement.style.removeProperty(cssVariable);
            }
          }
          applySharedAppearance(tokens);
        };

        applyTokens();
        observer = new MutationObserver(applyTokens);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });

        const brand = config.content?.find((item) => item.content_key === "brand")?.value;
        if (brand) {
          const name = document.querySelector<HTMLElement>("[data-hq-content='brand.name']");
          const tagline = document.querySelector<HTMLElement>("[data-hq-content='brand.tagline']");
          if (name && typeof brand.name === "string") name.textContent = brand.name;
          if (tagline && typeof brand.tagline === "string") tagline.textContent = brand.tagline;
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, []);
  return null;
}

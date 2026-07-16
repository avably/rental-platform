"use client";

import { useEffect } from "react";

import { captureLandingEvent } from "@/lib/analytics";

export function LandingAnalytics({ locale }: { locale: "en" | "pl" }) {
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    captureLandingEvent("waitlist_page_view", {
      language: locale,
      source: search.get("utm_source") ?? undefined,
      campaign: search.get("utm_campaign") ?? undefined,
    });

    const seen = new Set<string>();
    const sections = document.querySelectorAll<HTMLElement>("[data-analytics-section]");
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = (entry.target as HTMLElement).dataset.analyticsSection;
          if (!section || seen.has(section)) continue;
          seen.add(section);
          captureLandingEvent("waitlist_section_view", { language: locale, section });
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.35 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [locale]);

  return null;
}

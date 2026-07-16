"use client";

import { captureLandingEvent } from "@/lib/analytics";

interface TrackedCtaProps {
  children: React.ReactNode;
  className: string;
  dataHeroCta?: boolean;
  locale: "en" | "pl";
  placement: string;
}

export function TrackedCta({ children, className, dataHeroCta, locale, placement }: TrackedCtaProps) {
  return (
    <a
      className={className}
      data-hero-cta={dataHeroCta ? "" : undefined}
      href="#waitlist"
      onClick={() => captureLandingEvent("waitlist_cta_click", { language: locale, placement })}
    >
      {children}
    </a>
  );
}

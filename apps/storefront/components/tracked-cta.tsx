"use client";

import { captureLandingEvent } from "@/lib/analytics";

interface TrackedCtaProps {
  children: React.ReactNode;
  className: string;
  locale: "en" | "pl";
  placement: string;
}

export function TrackedCta({ children, className, locale, placement }: TrackedCtaProps) {
  return (
    <a
      className={className}
      href="#waitlist"
      onClick={() => captureLandingEvent("waitlist_cta_click", { language: locale, placement })}
    >
      {children}
    </a>
  );
}

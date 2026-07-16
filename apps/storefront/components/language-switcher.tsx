"use client";

import { Link } from "@/i18n/navigation";
import { captureLandingEvent } from "@/lib/analytics";

interface LanguageSwitcherProps {
  copy: {
    english: string;
    languageLabel: string;
    polish: string;
  };
  locale: "en" | "pl";
}

function currentSection(): string {
  const sections = [...document.querySelectorAll<HTMLElement>("[data-analytics-section]")];
  const current = sections.findLast((section) => section.getBoundingClientRect().top <= 120);
  return current?.dataset.analyticsSection ?? "header";
}

export function LanguageSwitcher({ copy, locale }: LanguageSwitcherProps) {
  return (
    <nav aria-label={copy.languageLabel} className="landing-ghost-pill flex items-center p-1 text-sm">
      {(["en", "pl"] as const).map((target) => (
        <Link
          aria-current={target === locale ? "page" : undefined}
          className="landing-pill px-3 py-1.5 font-medium aria-[current=page]:bg-foreground aria-[current=page]:text-background"
          href="/"
          hrefLang={target}
          key={target}
          locale={target}
          onClick={() => {
            if (target !== locale) {
              captureLandingEvent("language_switch", {
                from: locale,
                to: target,
                section: currentSection(),
              });
            }
          }}
        >
          {target === "pl" ? copy.polish : copy.english}
        </Link>
      ))}
    </nav>
  );
}

"use client";

import { LOCALES, type Locale } from "@avably/core";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link, usePathname } from "@/i18n/navigation";

/**
 * Przełącznik języka w belce (ADR-059).
 *
 * ADR-056 D5 odnotował brak przełącznika jako świadomy: „produkt nie ma dziś
 * przełączania locale w interfejsie". Produkt jest dwujęzyczny od ADR-013,
 * więc jedynym sposobem zmiany języka był ręcznie przepisany adres.
 *
 * ZACHOWUJE ŚCIEŻKĘ I QUERY. `usePathname` z `@/i18n/navigation` oddaje
 * ścieżkę BEZ prefiksu locale, a `Link` z propem `locale` dokłada właściwy —
 * dzięki temu przełączenie języka na przefiltrowanej liście zamówień zostaje
 * na tej samej liście z tymi samymi filtrami, zamiast odsyłać na stronę
 * główną. Gubienie query byłoby cichą utratą pracy operatora.
 *
 * To LINKI, nie przycisk przełączający: zmiana języka jest nawigacją pod inny
 * adres, więc ma się dać otworzyć w nowej karcie i wylądować w historii.
 */
export function LocaleSwitcher() {
  const t = useTranslations("nav");
  const active = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = Object.fromEntries(searchParams.entries());

  return (
    <div className="border-border flex items-center rounded-md border" data-locale-switcher>
      {LOCALES.map((locale: Locale) => {
        const current = locale === active;
        return (
          <Link
            key={locale}
            href={{ pathname, query }}
            locale={locale}
            hrefLang={locale}
            data-locale-option={locale}
            // Bieżący język niesie `aria-current`, tak samo jak bieżąca pozycja
            // nawigacji — czytnik ma wiedzieć, który z dwóch linków jest stanem.
            aria-current={current ? "true" : undefined}
            aria-label={t(locale === "pl" ? "localePolish" : "localeEnglish")}
            className={[
              "flex h-9 min-w-9 items-center justify-center px-2 text-[13px] font-medium uppercase no-underline outline-none",
              "transition-[color,background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
              "first:rounded-l-md last:rounded-r-md",
              "hover:underline hover:underline-offset-[3px]",
              "focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
              current
                ? "bg-accent text-foreground dark:text-accent-foreground"
                : "text-muted-foreground",
            ].join(" ")}
          >
            {locale}
          </Link>
        );
      })}
    </div>
  );
}

import { CANONICAL_SITE_URL, PANEL_URL } from "@avably/core";
import { Check, ChevronLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { BrandLogo } from "@/components/shell/brand-mark";

/**
 * Wspólne płótno ekranów wejścia — logowanie, rejestracja, „sprawdź skrzynkę",
 * reset hasła i ustawienie nowego hasła (ADR-156).
 *
 * DLACZEGO KOMPONENT, A NIE `layout.tsx`. Pas marki mówi co innego przy
 * rejestracji (roszczenie + korzyści) niż przy logowaniu (wizual produktu,
 * ADR-208), a layout Next.js nie przyjmuje propsów od strony. Wspólny
 * komponent zamyka geometrię i chrom w jednym miejscu, a każdy ekran wybiera
 * wariant pasa jednym słowem.
 *
 * ZNAK MARKI JEST STĄD, NIE Z NOWEGO PLIKU: `BrandLogo` żyje w powłoce panelu
 * i jest przypięty kontraktem do artefaktu Fazy 2 (`brand-mark-contract`).
 * Druga kopia ścieżek SVG rozjechałaby się z artefaktem przy pierwszej
 * poprawce znaku — a ekran, na którym wpisuje się hasło, jest ostatnim
 * miejscem, w którym marka może wyglądać inaczej niż wszędzie indziej.
 *
 * SZEROKOŚĆ KOLUMNY JEST JAWNA (`w-full max-w-[26rem]`) i to nie jest ozdoba.
 * Ekrany sprzed tej zmiany stały na `<main class="mx-auto … max-w-sm">`
 * WEWNĄTRZ `<body class="flex flex-col">`: automatyczny margines na elemencie
 * flex wyłącza rozciąganie i zwija go do szerokości treści. Kolumna miała więc
 * tyle, ile domyślny `<input>` (~200 px), a dwa odnośniki pod przyciskiem
 * („Załóż konto" + „Nie pamiętam hasła") wypełniały ją co do piksela i
 * sklejały się w jeden ciąg — dokładnie to zgłosił właściciel. Jawna
 * szerokość odbiera temu mechanizmowi wejście.
 */

/** Wariant pasa marki: rejestracja sprzedaje, logowanie uspokaja. */
export type AuthBandVariant = "signup" | "signin";

/**
 * TRZY pozycje, nie pięć — redukcja na uwagę właściciela (ADR-208). Nota
 * drugiego planu została tylko przy okresie próbnym; pozostałe pozycje są
 * jednozdaniowe, więc `note` jest opcjonalne zamiast dopisywać treść,
 * której właściciel nie zamówił.
 */
function BandSignals({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("authShell");
  const signals: Array<{ title: string; note?: string }> = [
    { title: t("signals.trialTitle"), note: t("signals.trialNote") },
    { title: t("signals.seatsTitle") },
    { title: t("signals.noLockInTitle") },
  ];

  return (
    <ul className={compact ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {signals.map((signal) => (
        <li key={signal.title} className="flex items-start gap-2.5 text-sm">
          <Check
            aria-hidden="true"
            className={
              compact
                ? "text-signal-strong dark:text-primary mt-0.5 size-4 shrink-0"
                : "mt-0.5 size-4 shrink-0 opacity-85"
            }
          />
          <span>
            <span className={compact ? "font-medium" : "block font-semibold"}>{signal.title}</span>
            {compact || !signal.note ? null : (
              <span className="text-background/70 dark:text-muted-foreground block text-[0.8125rem] leading-[18px]">
                {signal.note}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Wizual pasa logowania — zabstrahowany podgląd panelu w ramce „okna
 * przeglądarki" (ADR-208, uwaga właściciela: w miejsce treści ma stanąć
 * „screen na mockupie"). ŚWIADOMIE markup + tokeny, nie plik graficzny:
 * zero nowych zasobów, zero rozjazdu z motywem ciemnym, a docelowy realny
 * zrzut ekranu (decyzja właściciela) podmieni wyłącznie ten komponent.
 * Całość jest dekoracją — `aria-hidden` zdejmuje ją czytnikom w całości.
 */
function BandPanelPreview() {
  // Atrapa listy rezerwacji: szerokości pasków są stałe (nie losowe), żeby
  // SSR i klient rysowały ten sam obraz — bez hydration mismatch.
  const rows: Array<{ name: string; meta: string; pill: string }> = [
    { name: "w-24", meta: "w-14", pill: "w-12" },
    { name: "w-32", meta: "w-10", pill: "w-9" },
    { name: "w-20", meta: "w-16", pill: "w-12" },
    { name: "w-28", meta: "w-12", pill: "w-9" },
  ];

  return (
    <div
      aria-hidden="true"
      data-auth-band-visual
      className="border-background/25 bg-background/5 dark:border-foreground/20 dark:bg-foreground/5 overflow-hidden rounded-lg border"
    >
      {/* Belka okna: trzy kropki + pigułka adresu. */}
      <div className="border-background/15 dark:border-foreground/15 flex items-center gap-2.5 border-b px-3.5 py-2.5">
        <span className="flex gap-1.5">
          <span className="bg-background/30 dark:bg-foreground/25 size-2 rounded-full" />
          <span className="bg-background/30 dark:bg-foreground/25 size-2 rounded-full" />
          <span className="bg-background/30 dark:bg-foreground/25 size-2 rounded-full" />
        </span>
        <span className="bg-background/10 dark:bg-foreground/10 h-4 max-w-40 flex-1 rounded-full" />
      </div>
      {/* Treść: nagłówek listy + wiersze rezerwacji. */}
      <div className="flex flex-col gap-3 px-3.5 py-4">
        <div className="flex items-center justify-between">
          <span className="bg-background/45 dark:bg-foreground/40 h-2.5 w-24 rounded-full" />
          <span className="bg-background/20 dark:bg-foreground/20 h-2.5 w-14 rounded-full" />
        </div>
        {rows.map((row) => (
          <div key={`${row.name}-${row.meta}`} className="flex items-center gap-2.5">
            <span className="bg-background/25 dark:bg-foreground/25 size-5 shrink-0 rounded-full" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={`bg-background/35 dark:bg-foreground/30 h-2 rounded-full ${row.name}`} />
              <span className={`bg-background/15 dark:bg-foreground/15 h-2 rounded-full ${row.meta}`} />
            </span>
            <span className={`bg-background/20 dark:bg-foreground/20 h-4 shrink-0 rounded-full ${row.pill}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Sygnały pod formularzem na wąskim ekranie — pas marki zwija się wtedy do
 * samej belki z logo, więc powody, dla których ktoś zakłada konto, muszą
 * dojechać inną drogą. Tylko tytuły: pod formularzem to przypis, nie oferta.
 */
export function AuthNarrowSignals() {
  return (
    <div className="text-muted-foreground lg:hidden">
      <BandSignals compact />
    </div>
  );
}

export function AuthShell({
  band,
  bandLegalLinks = true,
  children,
}: {
  band: AuthBandVariant;
  /**
   * Odnośniki Regulamin/Polityka w stopce pasa. Ekran, który niesie WŁASNĄ
   * notę informacyjną (art. 13 RODO) w kolumnie formularza — rejestracja —
   * wyłącza duplikat stopki (ADR-208): stopka jest `hidden lg:flex`, więc to
   * nota w kolumnie, widoczna na każdej szerokości, jest jedynym zestawem,
   * który wolno zostawić bez utraty odnośników na mobile.
   */
  bandLegalLinks?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("authShell");
  const locale = useLocale();
  const siteHost = CANONICAL_SITE_URL.replace(/^https?:\/\//, "");
  const panelHost = PANEL_URL.replace(/^https?:\/\//, "");

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* Pas marki. Kolory z tokenów systemu: jasny motyw stawia go na
          `--foreground` (ten sam ciemny pas, co sekcja marki strony), ciemny
          na `--secondary` — czarne na czarnym nie odcina niczego od tła. */}
      <aside className="bg-foreground text-background dark:bg-secondary dark:text-foreground lg:border-border flex flex-none flex-col justify-between gap-8 px-5 py-4 lg:w-[42%] lg:max-w-[32.5rem] lg:border-r lg:px-11 lg:py-10">
        <div className="flex w-full items-center justify-between gap-4 lg:w-auto">
          {/* Nazwa dostępna idzie ATRYBUTEM na odnośniku, a nie tekstem dla
              czytnika w środku: `BrandLogo` niesie własne `aria-label="Avably"`
              (i nie da się go stąd wyłączyć — znak jest przypięty kontraktem),
              więc dołożony `sr-only` dawałby odczyt „Avably Strona Avably".
              Jawny `aria-label` na kotwicy zastępuje nazwę z treści, zamiast
              się do niej dokładać. */}
          <a
            href={CANONICAL_SITE_URL}
            aria-label={t("brandHome")}
            className="inline-flex rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
          >
            <BrandLogo className="h-auto w-[7.375rem] lg:w-[8.625rem]" />
          </a>
          <a
            href={CANONICAL_SITE_URL}
            className="text-background/70 hover:text-background dark:text-muted-foreground dark:hover:text-foreground inline-flex items-center gap-1 rounded-sm text-[0.8125rem] no-underline outline-none transition-[color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
          >
            <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
            {siteHost}
          </a>
        </div>

        <div className="hidden lg:block">
          {/* Pas logowania stracił roszczenie i pudełko bezpieczeństwa na
              uwagę właściciela (ADR-208) — stoi tu wizual produktu. */}
          {band === "signup" ? (
            <>
              <p className="mb-5 max-w-[14ch] text-[1.625rem] leading-[1.14] font-medium tracking-[-0.02em]">
                {t("signupClaim")}
              </p>
              <BandSignals />
            </>
          ) : (
            <BandPanelPreview />
          )}
        </div>

        <div className="text-background/70 dark:text-muted-foreground hidden flex-wrap items-center gap-x-4 gap-y-1.5 text-xs lg:flex">
          {bandLegalLinks ? (
            <>
              <a
                href={`${CANONICAL_SITE_URL}/${locale}/terms`}
                className="hover:text-background dark:hover:text-foreground rounded-sm no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
              >
                {t("terms")}
              </a>
              <a
                href={`${CANONICAL_SITE_URL}/${locale}/privacy`}
                className="hover:text-background dark:hover:text-foreground rounded-sm no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
              >
                {t("privacy")}
              </a>
            </>
          ) : null}
          <span className="ml-auto tracking-[0.02em]">{panelHost}</span>
        </div>
      </aside>

      {/*
        Kolumna treści. `justify-center` ustawia ją w poziomie, a `my-auto` na
        dziecku w pionie: automatyczny margines na elemencie flex ma
        pierwszeństwo przed `align-items`, więc krótki ekran („link wygasł")
        stoi w środku, a długi (rejestracja) normalnie się przewija.
      */}
      <main className="flex flex-1 justify-center px-5 pt-6 pb-10 lg:px-10 lg:py-14">
        <div
          data-auth-column
          className="my-auto flex w-full max-w-[26rem] flex-col gap-[1.125rem]"
        >
          {children}
        </div>
      </main>
    </div>
  );
}

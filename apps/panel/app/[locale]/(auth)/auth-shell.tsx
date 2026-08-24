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
 * Wizual pasa logowania — DOSŁOWNA ramka laptopa z REALNYM zrzutem pulpitu
 * (ADR-211, decyzja właściciela; zastępuje zabstrahowany `BandPanelPreview`
 * z ADR-208, który był jawnie oznaczony jako tymczasowy do tej decyzji).
 *
 * ZRZUT JEST ŚWIEŻY, NIE Z ARCHIWUM PRODUKTOWEGO (uwaga właściciela przy
 * ADR-211: zrzuty w `apps/storefront/public/produkt/` są sprzed zmian
 * designu panelu). Plik `public/mockup-pulpit.webp` to pulpit BIEŻĄCEGO
 * designu, złapany w 2× (2880×1920, viewport 1440×960) na zasianym demo
 * z 12 miesiącami zamówień — populowany, bez skeletonów. Leży w `public/`
 * PANELU, bo CSP panelu ma `img-src 'self'` — zero linkowania między
 * aplikacjami.
 *
 * RAMKA JEST WŁASNA (markup + tokeny), nie ściągnięty mockup — licencje.
 * Korpus stoi na tych samych tintach co poprzednik (`background/…` na
 * jasnym pasie, `foreground/…` na ciemnym), więc czyta się w obu motywach.
 *
 * ANIMACJA: powolny pionowy pan zrzutu w „ekranie". Kadr trzyma 16:10,
 * a obraz 3:2 jest o ~6,7% wyższy — jest czym panować. Keyframes
 * `auth-laptop-pan` żyją w `globals.css` POD bramką
 * `prefers-reduced-motion: no-preference`: operator z reduced motion widzi
 * statyczną górę pulpitu (translateY(0) to stan bazowy). Czysty CSS, zero
 * JS i zero losowości — SSR i klient rysują to samo.
 *
 * ZERO CLS: kadr ma `aspect-[16/10]`, `<img>` jawne wymiary — układ stoi,
 * zanim plik dojedzie. Całość jest dekoracją — `aria-hidden` zdejmuje ją
 * czytnikom w całości.
 */
function BandLaptopMockup() {
  return (
    <div aria-hidden="true" data-auth-band-visual className="select-none">
      {/* Pokrywa: cienki beżel wokół ekranu, delikatnie grubsza „broda" u dołu. */}
      <div className="border-background/30 bg-background/15 dark:border-foreground/25 dark:bg-foreground/15 mx-[3.5%] rounded-t-[0.875rem] border border-b-0 p-[2.25%] pb-[2.75%]">
        <div
          data-auth-mockup-screen
          className="bg-background/10 dark:bg-foreground/10 aspect-[16/10] overflow-hidden rounded-[0.25rem]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- statyczny plik dekoracyjny z /public tej aplikacji: optymalizator next/image nic tu nie wnosi (jeden webp 44 KB, stały kadr), a zjada limit transformacji Hobby. */}
          <img
            src="/mockup-pulpit.webp"
            alt=""
            width={2880}
            height={1920}
            loading="eager"
            decoding="async"
            draggable={false}
            className="h-auto w-full"
          />
        </div>
      </div>
      {/* Podstawa: szersza niż pokrywa, z wycięciem na kciuk pośrodku. */}
      <div className="bg-background/25 dark:bg-foreground/20 relative h-[0.8125rem] rounded-t-[0.1875rem] rounded-b-[0.75rem]">
        {/* Wycięcie = kolor pasa na wierzchu podstawy: czyta się jak otwór,
            bez filtrów i bez drugiej palety w ciemnym motywie. */}
        <div className="bg-foreground dark:bg-secondary absolute top-0 left-1/2 h-[45%] w-[13%] -translate-x-1/2 rounded-b-[0.5rem]" />
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
            <BrandLogo className="h-auto w-[7.5rem] lg:w-[8.625rem]" />
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
              uwagę właściciela (ADR-208) — stoi tu wizual produktu: od
              ADR-211 dosłowny laptop z realnym zrzutem pulpitu. */}
          {band === "signup" ? (
            <>
              <p className="mb-5 max-w-[14ch] text-[1.625rem] leading-[1.14] font-medium tracking-[-0.02em]">
                {t("signupClaim")}
              </p>
              <BandSignals />
            </>
          ) : (
            <BandLaptopMockup />
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

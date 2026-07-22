import { ReviewOverlayGate } from "@avably/review/overlay";
import { getTranslations } from "next-intl/server";

import { BrandLogo } from "@/components/shell/brand-mark";
import { PanelTopbar } from "@/components/shell/panel-topbar";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { SuperadminEntry } from "@/components/shell/superadmin-entry";
import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Shell tras tenanta (ADR-056, rozszerzony w ADR-059).
 *
 * Grupa `(panel)` nie wchodzi do adresu — `/zamowienia` zostaje
 * `/zamowienia`. Dzięki temu shell obejmuje wyłącznie ekrany tenanta, a
 * `(auth)`, `(superadmin)`, publiczny akcept zaproszenia i galeria
 * `/design-system` zostają poza nim, bez ruszania jednego znaku w linkach.
 *
 * Layout NIE jest guardem: kontekst czytamy wyłącznie po to, żeby belka
 * pokazała tożsamość sesji, a sidebar — wejście superadmina. Każdy ekran
 * trzyma własne sprawdzenie dostępu (`requireMemberPage` / `getAuthContext`),
 * a strona główna panelu celowo wpuszcza zalogowanego BEZ organizacji —
 * dokładanie tu przekierowania zrobiłoby z tego pętlę.
 *
 * P6 dokłada trzy rzeczy: skok do treści (pierwszy Tab), znak marki na górze
 * sidebara i wejście superadmina na jego dole — to ostatnie POZA
 * `<nav data-panel-nav>`, żeby kontrakt struktury z ADR-056 został nietknięty.
 */
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getAuthContext(await createSupabaseServerClient());
  const t = await getTranslations("nav");

  return (
    <div className="flex min-h-screen flex-1">
      <SkipLink label={t("skipToContent")} />
      <aside className="border-border bg-sidebar hidden w-[236px] shrink-0 flex-col border-r md:sticky md:top-0 md:flex md:h-screen md:overflow-y-auto">
        {/* Pełne logo wg reguł sekcji 02: minimalna szerokość w interfejsie to
            120 px — stąd wartość JAWNA, a nie płynna, która przy wąskim
            sidebarze zeszłaby poniżej progu.

            Decyzja właściciela 2026-07-21 (recenzja PR #89): znak o jedną
            trzecią mniejszy. 132 px × 2/3 = 88 px, czyli PONIŻEJ podłogi
            artefaktu — więc redukcja zatrzymuje się na 120 px. Podłoga jest
            twardą regułą znaku, nie sugestią, a niżej logo przestaje być
            czytelne. Pilnuje jej kontrakt shella. */}
        <div className="p-4 pb-2">
          <Link
            href="/"
            aria-label="Avably"
            className="inline-flex rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
          >
            <BrandLogo className="h-auto w-[120px]" />
          </Link>
        </div>
        <SidebarNav />
        <SuperadminEntry superadmin={Boolean(ctx?.superadmin)} label={t("superadminPanel")} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelTopbar userEmail={ctx?.user.email ?? ""} />
        {/*
          `tabIndex={-1}` czyni <main> celem programowego fokusu: bez tego
          skok „Przejdź do treści" przewija stronę, ale zostawia fokus przy
          linku, więc następny Tab wraca do nawigacji.
        */}
        <main id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="min-w-0 flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0"
        >
          <div
            data-panel-container="true"
            className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6"
          >
            {children}
          </div>
        </main>
      </div>
      {/* Nakładka przeglądu (ADR-071): renderowana WYŁĄCZNIE przy
          REVIEW_MODE=1 w env deploymentu I sesji superadmina; trzeci warunek
          (?review=1) domyka bramka kliencka — bez niego zero DOM/JS. Zapis
          i tak pilnuje RLS 0033, więc warunek na ctx to higiena, nie guard. */}
      {process.env.REVIEW_MODE === "1" && ctx?.superadmin ? (
        <ReviewOverlayGate surface="panel" />
      ) : null}
    </div>
  );
}

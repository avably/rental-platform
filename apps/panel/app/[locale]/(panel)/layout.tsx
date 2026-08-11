import { ReviewOverlayGate } from "@avably/review/overlay";
import { isClosingWindowOpen } from "@avably/core";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

import { BillingStatusBanner } from "@/components/shell/billing-banner";
import { BrandLogo, BrandSymbol } from "@/components/shell/brand-mark";
import { PanelTopbar } from "@/components/shell/panel-topbar";
import { PlatformTermsOverlay } from "@/components/shell/platform-terms-overlay";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { SidebarToggle } from "@/components/shell/sidebar-toggle";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { SuperadminEntry } from "@/components/shell/superadmin-entry";
import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/lib/auth";
import { readTenantBillingState } from "@/lib/closing";
import { readPlatformTermsGate } from "@/lib/platform-terms";
import { SIDEBAR_BOOTSTRAP_SCRIPT } from "@/lib/shell/sidebar-collapse";
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
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  const t = await getTranslations("nav");

  // JEDEN fail-silent odczyt stanu rozliczeń na żądanie shella (ADR-138):
  // karmi baner (licznik dni okna) i filtr nawigacji. Layout dalej NIE jest
  // guardem — `closing` tu to wyłącznie decyzja „czego nie pokazywać";
  // twardą bramką pozostaje requireMember na każdym ekranie i akcji.
  const billing = ctx?.tenantId ? await readTenantBillingState(supabase, ctx.tenantId) : null;
  const closing = billing?.status === "suspended" && isClosingWindowOpen(billing.suspendedAt);

  // PRZESŁONA REGULAMINU PLATFORMY (0070, ADR-141): owner bez ŻYWEJ
  // akceptacji obowiązującej wersji dostaje ZAMIAST treści ekran akceptacji
  // — gasimy TREŚĆ, nie trasę (wzorzec ADR-133; zero redirectów = zero
  // ryzyka pętli onboardingu: sesja bez organizacji i personel przechodzą
  // bez pytania, decyzja w readPlatformTermsGate). Layout dalej NIE jest
  // guardem: dopóki żadna wersja nie obowiązuje (stan przed treścią od
  // prawnika), bramka nie kosztuje nic poza jednym odczytem RPC.
  const termsGate = await readPlatformTermsGate(supabase, ctx);

  // Nonce żądania (ADR-012) — bez niego CSP `strict-dynamic` odmówi wykonania
  // skryptu startowego sidebara i pasek wracałby do rozwiniętego przy każdym
  // wejściu (ta sama mechanika co skrypt motywu).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <div className="flex min-h-screen flex-1">
      {/*
        Skrypt startowy zwijania: ustawia `html[data-sidebar]` z `localStorage`
        PRZED pierwszym malowaniem, żeby zwinięty pasek nie mrugnął pełną
        szerokością. Stoi jako pierwszy węzeł powłoki, więc wykonuje się, zanim
        `<aside>` zostanie sparsowany. `suppressHydrationWarning` — przeglądarka
        ukrywa `nonce` przed DOM-em, więc render serwera i klienta różnią się
        tym jednym atrybutem (recenzja PR #89, ten sam wzorzec co skrypt motywu).
      */}
      <script
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOTSTRAP_SCRIPT }}
      />
      <SkipLink label={t("skipToContent")} />
      {/*
        WARSTWA POWŁOKI (naprawa M1, uwaga przeglądu 2026-07-24).

        `md:sticky` sam z siebie ustanawia KONTEKST UKŁADANIA — element
        przyklejony tworzy go niezależnie od `z-index` (CSS Positioned Layout,
        tak samo we wszystkich silnikach). Cały pasek jest więc jedną paczką
        malowania, a `z-index` dymka etykiety licytuje się WEWNĄTRZ niej i nie
        sięga poza pasek. Treść strony ma własne elementy pozycjonowane
        (np. panel filtrów `sm:z-30` w `orders-toolbar`), które w porządku
        drzewa stoją PO pasku — i wygrywały z dymkiem.

        Rozwiązanie jest jedno i stoi TUTAJ: cała powłoka dostaje numer
        warstwy wyższy niż cokolwiek w treści. Dymki wewnątrz paska mają wtedy
        `z-10` (porządkuje je względem siebie) i NIE MUSZĄ licytować — dodanie
        `z-50` na dymku niczego by nie zmieniło, bo problem nigdy nie był
        w jego wartości. Pilnuje tego `sidebar-collapse-contract`.

        Numer 40 mieści się pod nakładkami dialogowymi Radiksa (portal na
        `<body>`, poza tym poddrzewem), więc modale i szuflada nadal wygrywają.
      */}
      <aside
        data-sidebar-rail
        className="border-border bg-sidebar hidden w-[236px] shrink-0 flex-col border-r sidebar-collapsed:w-[72px] md:sticky md:top-0 md:z-40 md:flex md:h-screen md:overflow-y-auto"
      >
        {/* Pełne logo wg reguł sekcji 02: minimalna szerokość w interfejsie to
            120 px — stąd wartość JAWNA, a nie płynna, która przy wąskim
            sidebarze zeszłaby poniżej progu.

            Decyzja właściciela 2026-07-21 (recenzja PR #89): znak o jedną
            trzecią mniejszy. 132 px × 2/3 = 88 px, czyli PONIŻEJ podłogi
            artefaktu — więc redukcja zatrzymuje się na 120 px. Podłoga jest
            twardą regułą znaku, nie sugestią, a niżej logo przestaje być
            czytelne. Pilnuje jej kontrakt shella.

            Stan ZWINIĘTY (uwaga przeglądu 2026-07-23): pełne logo nie mieści
            się w pasku 72 px, więc ustępuje sygnetowi (podłoga sekcji 02 dla
            sygnetu to 24 px — `size-7` = 28 px). Wybór wariantu robi CSS
            (`sidebar-collapsed:`), a nie React: elementy paska nie
            przerysowują się przy zmianie stanu klienta, więc reagują na
            `html[data-sidebar]` samym stylem. */}
        <div className="flex items-center gap-2 p-4 pb-2 sidebar-collapsed:flex-col sidebar-collapsed:gap-3 sidebar-collapsed:px-2">
          <Link
            href="/"
            aria-label="Avably"
            className="inline-flex rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent sidebar-collapsed:hidden dark:focus-visible:outline-ring"
          >
            <BrandLogo className="h-auto w-[120px]" />
          </Link>
          <Link
            href="/"
            aria-label="Avably"
            className="hidden rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent sidebar-collapsed:inline-flex dark:focus-visible:outline-ring"
          >
            <BrandSymbol className="size-7" />
          </Link>
          <div className="ml-auto sidebar-collapsed:ml-0">
            <SidebarToggle />
          </div>
        </div>
        <SidebarNav closing={closing} />
        <SuperadminEntry superadmin={Boolean(ctx?.superadmin)} label={t("superadminPanel")} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelTopbar userEmail={ctx?.user.email ?? ""} closing={closing} />
        {/* Baner rozliczeń (ADR-136/138): past_due/suspended — presja na
            najemcę zostaje w panelu (zasada 3), sklep działa; w oknie
            domykania baner niesie licznik dni. Fail-silent, nie guard. */}
        <BillingStatusBanner state={billing} />
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
            {termsGate ? (
              <PlatformTermsOverlay
                versionId={termsGate.versionId}
                versionLabel={termsGate.versionLabel}
                effectiveFrom={termsGate.effectiveFrom}
              />
            ) : (
              children
            )}
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

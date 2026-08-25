"use client";

/**
 * LISTA STRON SKLEPU (0048, ADR-093; znaczenie po fazie 2 — 0073/ADR-157) —
 * ekran, który zastąpił launcher.
 *
 * Do 0072 wiersz `sites` był WERSJĄ jednej strony i lista odpowiadała na
 * pytanie „którą wersję widzi klient". Od 0073 wiersze są osobnymi STRONAMI,
 * a od 0074 publikacja jednej NIE GASI pozostałych — więc lista odpowiada
 * odtąd na pytanie „co stoi w sklepie i pod jakim adresem". Formularzy tu nie
 * ma: treść składa się na płótnie kreatora.
 *
 * DWIE RZECZY, KTÓRE MUSZĄ BYĆ WIDOCZNE OD RAZU, bo bez nich lista kłamie:
 *
 *   1. Które strony są ŻYWE. Chip osi `site-publish` dostaje KAŻDA z nich —
 *      po fazie 2 może ich być wiele; strony robocze dostają zdanie, a nie
 *      chip udający stan spoza mapy (zasada z launchera sprzed 0048).
 *   2. Że żywej strony NIE DA SIĘ usunąć. Przycisk jest wyłączony i mówi, co
 *      zrobić — tym samym zdaniem, którym odmawia trigger w bazie. Interfejs,
 *      który pozwala kliknąć i dopiero potem tłumaczy odmowę, uczy operatora,
 *      że komunikaty błędów są normalną częścią pracy.
 *
 * Publikacja i usunięcie mają POTWIERDZENIE, bo obie zmieniają coś, czego
 * operator nie widzi z tego ekranu: publikacja wystawia stronę klientom pod
 * jej adresem, usunięcie kasuje treść bez kosza.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avably/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  HOME_PAGE_SLUG,
  PRODUCT_TEMPLATE_SITE_KIND,
  isProductTemplateKind,
  pagePathFromSlug,
  suggestPageSlug,
  type SiteKind,
} from "@avably/core/site";

import { PublishDialog } from "@/components/publish-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { PublishWarning } from "@/lib/publish-warnings";
import { createSite, deleteSite, publishSite, renameSite, unpublishSite } from "@/lib/actions/site";
import {
  forkProductPage,
  restoreDefaultProductPage,
} from "@/lib/actions/site-product-exception";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import {
  MAX_PRODUCT_EXCEPTIONS,
  MAX_SITES,
  countProductExceptions,
  hasHomePage,
  hasProductTemplate,
  pageSlugIssue,
} from "@/lib/site-validation";

export interface SitePageRow {
  id: string;
  name: string;
  /** Czy TĘ stronę widzi klient. Jedyna prawda o żywości (ADR-093 D1). */
  live: boolean;
  /**
   * ROLA wiersza (0080, ADR-178). `product` = SZABLON strony produktu: nie ma
   * adresu, więc wiersz nie pokazuje ścieżki, nie liczy się do strony głównej
   * i nie dostaje przekierowań.
   */
  kind: SiteKind;
  /** ADRES SZKICU (0073): pusty = strona główna (`/`). Szablon ma go pustego. */
  slug: string;
  /** ADRES OPUBLIKOWANY; null = strona nigdy nie opublikowana. */
  slugPublished: string | null;
  /** Czy stary adres dostanie 308 przy najbliższej publikacji (0075). */
  redirectOldSlug: boolean;
  /**
   * STARE ADRESY, które dziś prowadzą 308 do tej strony (0075, ADR-159).
   * Potrzebne, bo zdjęcie strony ze sklepu gasi je razem z nią — przekierowanie
   * pod adres oddający 404 byłoby gorsze niż jego brak — a operator ma o tym
   * usłyszeć PRZED kliknięciem, a nie z reklamacji klienta.
   */
  redirectedFrom: string[];
  /**
   * PRZYPIĘCIE DO PRODUKTU (0088, ADR-199/200): niepuste ⇔ wiersz jest
   * WYJĄTKIEM — własną stroną tego jednego sprzętu, która opublikowana wygrywa
   * ze wspólnym szablonem. Pominięte/null = szablon-matka albo zwykła strona.
   */
  productId?: string | null;
  /**
   * NAZWA sprzętu z katalogu — dla odznaki. `null` przy wyjątku znaczy
   * „nieudany odczyt nazwy": odznaka zostaje, podpis gaśnie.
   */
  productName?: string | null;
  publishedAtLabel: string | null;
  createdAtLabel: string | null;
  /**
   * SZKIC MA COŚ, CZEGO KLIENCI NIE MAJĄ (K-05, audyt UX 2026-08-25).
   * `null` = pytanie bez odpowiedzi: strona robocza (nie ma bliźniaka, z którym
   * można by porównywać) albo nieudany odczyt sekcji. Odznaka rysuje się
   * WYŁĄCZNIE przy `true` — „nie wiadomo" nie ma prawa wyglądać jak „nic nie
   * czeka" ani jak „czeka" (kanon ADR-171).
   */
  draftPending?: boolean | null;
  /**
   * OSTRZEŻENIA PRZED PUBLIKACJĄ TEJ strony (K-13/K-14) — liczone serwerowo tą
   * samą funkcją, którą kreator liczy je ze szkicu w pamięci. Pusta lista =
   * „nie mam nic do powiedzenia"; okno jej wtedy nie rysuje.
   */
  warnings?: readonly PublishWarning[];
}

export function SitePages({
  rows,
  appearancePending = null,
  forkProducts = null,
}: {
  rows: SitePageRow[];
  /**
   * CZY WYGLĄD SKLEPU CZEKA NA PUBLIKACJĘ (ADR-171) — `null` znaczy „nieudany
   * odczyt", a nie „bez zmian". Jedzie do okna publikacji, bo publikacja
   * DOWOLNEJ strony wypuszcza wygląd całego sklepu.
   */
  appearancePending?: boolean | null;
  /**
   * SPRZĘT DO WYBORU w oknie „utwórz stronę sprzętu" (ADR-200) — aktywne
   * pozycje katalogu; te z już istniejącym wyjątkiem odsiewa ten komponent
   * z wierszy listy. `null` znaczy „nieudany odczyt katalogu" (przycisk
   * gaśnie, licznik zostaje) — a `[]` to pusty katalog, z własnym zdaniem.
   */
  forkProducts?: { id: string; name: string }[] | null;
}) {
  const t = useTranslations("site");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }

  /**
   * UTWORZENIE STRONY PROWADZI DO KREATORA (K-02, audyt UX 2026-08-25).
   *
   * Do tej poprawki „Utwórz stronę" zostawiało operatora NA LIŚCIE, z pustym
   * wierszem, do którego trzeba było kliknąć osobno — a strona bez ani jednej
   * sekcji nie jest niczym, na co warto patrzeć z listy. Czasownik obiecuje
   * stronę, więc kończy się tam, gdzie się ją robi.
   *
   * Nawigacja idzie WYŁĄCZNIE po sukcesie i wyłącznie z identyfikatorem
   * z akcji: porażka (limit stron, zajęty adres, odmowa RLS) zostawia operatora
   * na liście z komunikatem, bo tam jest formularz, w którym może poprawić.
   */
  function createAndOpen(action: () => Promise<{ ok: true; siteId: string } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/strona/${result.siteId}/kreator`);
    });
  }

  const limitReached = rows.length >= MAX_SITES;
  /*
    STRONY GŁÓWNEJ NIE MA — STAN, KTÓRY MA WŁASNE MIEJSCE NA EKRANIE (ADR-168).
    Do tej poprawki był NIEWIDOCZNY i NIEWYCHODZALNY: okno „Nowa strona"
    wymagało niepustego adresu, a adresem strony głównej jest pusty — więc
    świeży najemca budował podstrony, a pod `/` klienci mieli pustkę. Zdanie
    nazywa skutek (co widzi klient), a nie brak wiersza w tabeli.
  */
  const homeMissing = !hasHomePage(rows);
  /*
    STRONA GŁÓWNA JEST, ALE NIE STOI W SKLEPIE (ADR-170). Stan powstaje na dwa
    sposoby: świeżo utworzona strona główna czeka na publikację albo operator
    właśnie zdjął ją ze sklepu. Jedno i drugie znaczy dla klienta TO SAMO —
    pod `/` nie ma nic — a `homeMissing` tego nie widzi, bo pyta o ISTNIENIE
    wiersza, nie o jego żywość.

    Warunek pyta o `slugPublished`, nie o `slug`: pod `/` stoi ta strona, która
    jest tam OPUBLIKOWANA. Strona z pustym szkicem adresu, opublikowana kiedyś
    pod `/kontakt`, korzenia sklepu nie obsługuje.
  */
  const homeNotLive =
    !homeMissing &&
    !rows.some(
      (row) => row.live && !isProductTemplateKind(row.kind) && row.slugPublished === HOME_PAGE_SLUG,
    );
  /*
    SZABLON STRONY PRODUKTU (faza 5, ADR-178) — stan „najemca go nie ma" ma
    własne miejsce na ekranie z tego samego powodu, co brak strony głównej:
    jest NIEWIDOCZNY i NIEWYCHODZALNY z okna „Nowa strona". Tamto okno wymaga
    adresu, a szablon adresu nie ma i mieć nie może — więc bez osobnego
    czasownika operator nie ma jak go założyć.

    Zdanie nazywa SKUTEK (co widzi klient na stronie sprzętu), a nie brak
    wiersza w tabeli: dopóki szablonu nie ma, strona sprzętu jest wbudowana
    i działa — to jest informacja, nie ostrzeżenie.
  */
  const templateMissing = !hasProductTemplate(rows);
  /*
    WŁASNE STRONY SPRZĘTU (faza B, ADR-200). Matka rozstrzyga, czy fork ma
    przedmiot (kopiuje JEJ treść roboczą); licznik liczy PRODUKTY z własną
    stroną — tą samą definicją, którą liczy trigger limitu w bazie
    (`countProductExceptions`, count distinct). Blok jest widoczny także bez
    matki, gdy wyjątki już są: licznik, którego nie widać, przestaje pilnować
    (§4.3 dokumentu architektury).
  */
  const hasMother = rows.some(
    (row) => isProductTemplateKind(row.kind) && (row.productId ?? null) === null,
  );
  const exceptionsUsed = countProductExceptions(rows);
  const availableForkProducts = (forkProducts ?? []).filter(
    (product) => !rows.some((row) => row.productId === product.id),
  );

  /*
    PODZIAŁ PŁASKIEJ LISTY NA SEKCJE (C6, ADR-230) — z DANYCH wiersza, bez
    migracji. Trzy grupy rozłączne i wyczerpujące:

      • STRONA GŁÓWNA  = strona (nie szablon) pod korzeniem sklepu. Reguła jest
        ta sama, którą `hasHomePage` (site-validation) uznaje wiersz za główny:
        pusty adres w SZKICU albo w bliźniaku opublikowanym — bo strona
        z przeniesionym szkicem dalej stoi pod `/`, dopóki nie opublikuje nowego
        adresu. Sam `slug` gubiłby ten stan.
      • STRONY PRODUKTÓW = szablon-matka (`productId === null`) i wyjątki
        (`productId != null`) — jedna rodzina roli `product`.
      • STRONY DODATKOWE = pozostałe strony (adres niepusty).

    Nagłówek grupy pokazuje się TYLKO dla grupy niepustej — pusta sekcja
    z samym tytułem byłaby obietnicą wiersza, którego nie ma.
  */
  const isHomeRow = (row: SitePageRow) =>
    !isProductTemplateKind(row.kind) &&
    (row.slug === HOME_PAGE_SLUG || row.slugPublished === HOME_PAGE_SLUG);
  const pageGroups = [
    { key: "home", label: t("pages.groupHome"), rows: rows.filter((row) => isHomeRow(row)) },
    {
      key: "product",
      label: t("pages.groupProducts"),
      rows: rows.filter((row) => isProductTemplateKind(row.kind)),
    },
    {
      key: "additional",
      label: t("pages.groupAdditional"),
      rows: rows.filter((row) => !isProductTemplateKind(row.kind) && !isHomeRow(row)),
    },
  ];

  return (
    <div className="flex flex-col gap-6" data-site-pages>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t("pages.subtitle")}</p>
        <NewPageDialog
          disabled={pending || limitReached}
          onCreate={(name, slug) => createAndOpen(() => createSite({ name, slug }))}
        />
      </div>

      {limitReached ? (
        <p className="text-muted-foreground text-[13px] leading-[18px]">
          {t("pages.limitReached", { max: MAX_SITES })}
        </p>
      ) : null}

      {homeMissing ? (
        <div
          data-site-home-missing
          className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm font-medium">{t("pages.homeMissingTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("pages.homeMissingBody")}
          </p>
          {/*
            OSOBNY CZASOWNIK, a nie tryb w oknie „Nowa strona": strona główna
            różni się od podstrony tym, czego operator NIE podaje (adresu), więc
            przełącznik w jednym oknie kazałby mu wybierać między polem
            wypełnionym a wygaszonym. Adres nie jedzie w wywołaniu w ogóle —
            `createSite({ name })` trafia w gałąź `?? HOME_PAGE_SLUG`.
          */}
          <NewPageDialog
            variant="home"
            disabled={pending || limitReached}
            onCreate={(name) => createAndOpen(() => createSite({ name }))}
          />
        </div>
      ) : null}

      {templateMissing ? (
        <div
          data-site-template-missing
          className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm font-medium">{t("pages.templateMissingTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("pages.templateMissingBody")}
          </p>
          {/*
            OSOBNY CZASOWNIK, dokładnie jak przy stronie głównej: szablon
            różni się od podstrony tym, czego operator NIE podaje (adresu),
            więc przełącznik w oknie „Nowa strona" kazałby mu wybierać między
            polem wypełnionym a wygaszonym. Adres nie jedzie w wywołaniu
            w ogóle — akcja dostaje samą nazwę i rolę.
          */}
          <NewPageDialog
            variant="template"
            disabled={pending || limitReached}
            onCreate={(name) =>
              createAndOpen(() => createSite({ name, kind: PRODUCT_TEMPLATE_SITE_KIND }))
            }
          />
        </div>
      ) : null}

      {/*
        WŁASNA STRONA WYBRANEGO SPRZĘTU (faza B, ADR-200; §4 dokumentu
        architektury). Blok niesie LICZNIK („użyto X z 5" — wyjątek, którego
        nie da się policzyć, przestaje być wyjątkiem) i wejście do forka.
        Przycisk NIE gaśnie przy 5 z 5: limitu pilnuje BAZA (PT409), a jej
        odmowa dociera tu jako zdanie — wyłącznik w interfejsie byłby drugą,
        słabszą wersją tej samej reguły.
      */}
      {hasMother || exceptionsUsed > 0 ? (
        <div
          data-site-exceptions
          className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm font-medium">{t("pages.exceptionsTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("pages.exceptionsBody")}
          </p>
          <p data-site-exceptions-counter className="text-[13px] leading-[18px]">
            {t("pages.exceptionsCounter", { used: exceptionsUsed, max: MAX_PRODUCT_EXCEPTIONS })}
          </p>
          {hasMother && forkProducts !== null ? (
            <NewExceptionDialog
              disabled={pending || limitReached}
              products={availableForkProducts}
              onCreate={(productId) => run(() => forkProductPage({ productId }))}
            />
          ) : null}
        </div>
      ) : null}

      {homeNotLive ? (
        <p
          data-site-home-not-live
          className="border-border bg-card text-muted-foreground rounded-lg border p-4 text-[13px] leading-[18px]"
        >
          {t("pages.homeNotLive")}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div data-site-pages-empty className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6">
          <p className="text-sm font-medium">{t("pages.emptyTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("pages.emptyBody")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6" data-site-pages-groups>
          {pageGroups.map((group) =>
            group.rows.length === 0 ? null : (
              <section
                key={group.key}
                data-site-page-group={group.key}
                className="flex flex-col gap-3"
              >
                <h2 className="text-muted-foreground flex items-center gap-2 text-[13px] leading-[18px] font-semibold tracking-wide uppercase">
                  {group.label}
                  <span className="text-muted-foreground/70 font-mono text-[11px] leading-[16px] font-medium">
                    {group.rows.length}
                  </span>
                </h2>
                <ul className="flex list-none flex-col gap-3 p-0">
                  {group.rows.map((row) => (
                    <li
                      key={row.id}
                      data-site-page={row.id}
              data-site-page-live={row.live ? "on" : "off"}
              /*
               * Kotwica z mockupu fazy 2 (`data-publish-status`) PRZENOSI SIĘ
               * z launchera na WIERSZ listy: stan publikacji przestał być
               * własnością ekranu, a stał się własnością wersji strony.
               * Kontrakt spójności ekranów dalej ją znajduje.
               */
              data-publish-status
              className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                {row.live ? (
                  <SecondaryStatusChip axis="site-publish" value="published" />
                ) : (
                  <span className="text-muted-foreground text-[13px] leading-[18px]">
                    {t("pages.statusDraft")}
                  </span>
                )}
                {/*
                  DRUGA ODZNAKA, A NIE PODMIANA PIERWSZEJ (K-05). Oba zdania są
                  prawdziwe naraz i oba są operatorowi potrzebne: strona JEST
                  w sklepie (chip osi `site-publish` — ta sama mapa statusów, co
                  wszędzie) i JEDNOCZEŚNIE to, co klienci widzą, jest starsze niż
                  to, co operator ma w kreatorze. Zamiana chipa na „szkic"
                  kłamałaby o pierwszym, żeby powiedzieć drugie.
                */}
                {row.live && row.draftPending === true ? (
                  <span
                    data-site-page-draft-pending
                    className="border-border text-foreground rounded-full border px-2 py-0.5 text-[12px] leading-[16px]"
                  >
                    {t("pages.draftPendingBadge")}
                  </span>
                ) : null}
              </div>
              {row.live && row.draftPending === true ? (
                <p className="text-muted-foreground text-[13px] leading-[18px]">
                  {t("pages.draftPendingBody")}
                </p>
              ) : null}

              {/*
                STRONA GŁÓWNA JEST PODPISANA (ADR-161). Sam adres `/` jest
                poprawny i jednocześnie nieczytelny: to jedyny wiersz listy,
                którego adres nie mówi, czym ta strona jest — „kontakt"
                i „o-nas" mówią to same. Podpis stoi OBOK adresu, a nie zamiast
                niego, bo adres strony głównej też jest informacją (operator
                pyta o niego przy przekierowaniach i w sitemapie).
              */}
              {/*
                SZABLON NIE UDAJE STRONY Z ADRESEM (faza 5, ADR-178). Jego
                `slug` jest pusty, więc `pagePathFromSlug` dałoby `/` — czyli
                ścieżkę STRONY GŁÓWNEJ, pod którą szablon nie stoi i stać nie
                może. Pokazany adres, którego nie ma, jest tą samą klasą
                cichego kłamstwa interfejsu, co podgląd obiecujący powłokę,
                której nie rysuje (ADR-172). Zamiast ścieżki idzie zdanie
                o tym, GDZIE ten szablon naprawdę się pokazuje.
              */}
              {/*
                WYJĄTEK PRZED MATKĄ (faza B, ADR-200): wiersz z `productId` jest
                WŁASNĄ STRONĄ JEDNEGO sprzętu — odznaka wymienia go z nazwy, bo
                „szablon strony produktu" byłoby o nim zdaniem prawdziwym
                o innym wierszu (matka obowiązuje wszędzie, wyjątek w jednym
                miejscu). Brak nazwy = nieudany odczyt katalogu: odznaka
                zostaje, podpis mówi tylko tyle, ile wiadomo.
              */}
              {isProductTemplateKind(row.kind) && row.productId ? (
                <p
                  data-site-page-exception
                  className="text-muted-foreground flex flex-wrap items-center gap-2 text-[13px] leading-[18px]"
                >
                  <span className="border-border text-foreground rounded-full border px-2 py-0.5 text-[12px] leading-[16px]">
                    {t("pages.exceptionBadge")}
                  </span>
                  <span>
                    {row.productName
                      ? t("pages.exceptionAddress", { name: row.productName })
                      : t("pages.exceptionAddressUnknown")}
                  </span>
                </p>
              ) : isProductTemplateKind(row.kind) ? (
                <p
                  data-site-page-template
                  className="text-muted-foreground flex flex-wrap items-center gap-2 text-[13px] leading-[18px]"
                >
                  <span className="border-border text-foreground rounded-full border px-2 py-0.5 text-[12px] leading-[16px]">
                    {t("pages.templateBadge")}
                  </span>
                  <span>{t("pages.templateAddress")}</span>
                </p>
              ) : (
                <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-[13px] leading-[18px]">
                  <span className="font-mono">{pagePathFromSlug(row.slug)}</span>
                  {row.slug === HOME_PAGE_SLUG ? (
                    <span
                      data-site-page-home
                      className="border-border text-foreground rounded-full border px-2 py-0.5 text-[12px] leading-[16px]"
                    >
                      {t("pages.homeBadge")}
                    </span>
                  ) : null}
                </p>
              )}

              {/*
                ADRES ZMIENIONY, ALE JESZCZE NIEOPUBLIKOWANY. Bez tego zdania
                operator zmienia adres, widzi go na liście i jest przekonany,
                że klienci już go mają — a żywy adres zmienia WYŁĄCZNIE
                publikacja (bliźniak `slug_published`, 0073/ADR-091).
              */}
              {row.slugPublished !== null && row.slugPublished !== row.slug ? (
                <p className="text-muted-foreground text-[13px] leading-[18px]">
                  {t("pages.addressPending", { current: pagePathFromSlug(row.slugPublished) })}
                </p>
              ) : null}

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                {row.live && row.publishedAtLabel
                  ? t("pages.publishedAt", { date: row.publishedAtLabel })
                  : /*
                     * Zdanie o wersji roboczej mówi o TERAŹNIEJSZOŚCI, a nie
                     * o historii — i to jest poprawka znaleziona na weryfikacji
                     * przeglądarkowej. Dotychczasowe `publish.notPublished`
                     * („strona nie była jeszcze publikowana") jest po 0048
                     * FAŁSZEM dla wersji, która była w sklepie i została
                     * zastąpiona: `published_at` zdejmujemy przy przełączeniu
                     * (świadomy koszt D1), więc historii z tej kolumny już nie
                     * odczytamy. Zdanie o stanie bieżącym jest prawdziwe zawsze.
                     */
                    t("pages.notLive")}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button asChild type="button" size="sm">
                  <Link href={`/strona/${row.id}/kreator`} data-open-builder={row.id}>
                    {t("builder.open")}
                  </Link>
                </Button>

                {/*
                  * Publikacja stoi przy KAŻDEJ stronie, także przy żywej, i to
                  * nie jest przeoczenie: dla roboczej znaczy „wystaw ją pod jej
                  * adresem", a dla żywej — „wypuść do klientów zmiany, które
                  * w niej zrobiłem". To drugie jest podstawowym obiegiem od K5a.
                  * Różnicę niesie treść potwierdzenia, nie obecność przycisku.
                  *
                  * Stało tu wyszukanie „która INNA strona jest żywa" (ADR-165):
                  * dialog mówił z niego, że dotychczasowa strona przestanie być
                  * publiczna. Od 0074 nie przestaje — więc wyszukanie zniknęło,
                  * a jego miejsce zajął ADRES tej strony.
                  */}
                <PublishDialog
                  disabled={pending}
                  live={row.live}
                  name={row.name}
                  /*
                    ZMIANY CZEKAJĄCE W SZKICU CZYNIĄ PUBLIKACJĘ CZYNNOŚCIĄ
                    GŁÓWNĄ tego wiersza (K-05): to jedyny przycisk, który
                    cokolwiek z tym stanem robi. Przy stronie wypuszczonej co do
                    przecinka zostaje drugorzędny — inaczej lista krzyczałaby
                    „opublikuj" nad każdą stroną, która niczego nie potrzebuje.
                  */
                  emphasize={row.draftPending === true}
                  warnings={row.warnings ?? []}
                  address={pagePathFromSlug(row.slug)}
                  productTemplate={isProductTemplateKind(row.kind)}
                  /*
                    WYJĄTEK MA INNY ZASIĘG NIŻ MATKA (ADR-200): publikacja
                    matki zmienia stronę KAŻDEGO sprzętu, wyjątku — JEDNEGO.
                    Zdanie „szablon zacznie obowiązywać wszędzie" byłoby przy
                    tym wierszu nieprawdą, a operator ma usłyszeć prawdziwy
                    zasięg PRZED kliknięciem.
                  */
                  exceptionProductName={
                    row.productId ? (row.productName ?? t("pages.exceptionProductFallback")) : null
                  }
                  appearancePending={appearancePending}
                  onConfirm={() => run(() => publishSite(row.id))}
                />

                <RenameDialog
                  disabled={pending}
                  current={row.name}
                  kind={row.kind}
                  exception={row.productId != null}
                  currentSlug={row.slug}
                  publishedSlug={row.slugPublished}
                  redirectOldSlug={row.redirectOldSlug}
                  onRename={(name, slug, redirect) =>
                    run(() =>
                      renameSite({
                        siteId: row.id,
                        name,
                        ...(slug === undefined ? {} : { slug }),
                        ...(redirect === undefined ? {} : { redirectOldSlug: redirect }),
                      }),
                    )
                  }
                />

                {/*
                  ZDJĘCIE ZE SKLEPU (ADR-170) — czasownik, którego do 0078 nie
                  było w ogóle. Stoi PRZY przycisku usunięcia i tylko przy
                  stronie żywej, bo to jest dokładnie ta para: usunięcia broni
                  trigger, a jedyną drogą do niego jest wcześniejsze zdjęcie
                  strony ze sklepu. Zdanie odmowy usunięcia wskazuje odtąd ten
                  przycisk, a nie „opublikuj inną" — czynność, która od 0074
                  nie zmienia w statusie tej strony niczego.
                */}
                {row.live ? (
                  <UnpublishDialog
                    disabled={pending}
                    name={row.name}
                    address={pagePathFromSlug(row.slugPublished ?? row.slug)}
                    /*
                      SZABLON MA PUSTY `slug_published`, więc bez członu o roli
                      wpadałby w gałąź STRONY GŁÓWNEJ i obiecywał operatorowi,
                      że po zdjęciu „korzeń sklepu będzie pusty" — zdanie
                      prawdziwe o innym wierszu i fałszywe o tym. Zdjęcie
                      szablonu przywraca stronę WBUDOWANĄ, a korzenia nie
                      dotyka w ogóle.
                    */
                    kind={row.kind}
                    exceptionProductName={
                      row.productId
                        ? (row.productName ?? t("pages.exceptionProductFallback"))
                        : null
                    }
                    home={!isProductTemplateKind(row.kind) && row.slugPublished === HOME_PAGE_SLUG}
                    redirectedFrom={row.redirectedFrom}
                    onConfirm={() => run(() => unpublishSite(row.id))}
                  />
                ) : null}

                {/*
                  „PRZYWRÓĆ SZABLON DOMYŚLNY" (ADR-200; §4.5 dokumentu
                  architektury) zastępuje na wierszu WYJĄTKU parę
                  usuń/„widoczna w sklepie": jest tym samym usunięciem,
                  nazwanym skutkiem, który operator kupuje — produkt wraca pod
                  wspólny szablon. Działa też na wierszu ŻYWYM (akcja najpierw
                  zdejmuje go ze sklepu), bo wyjątek opublikowany przez pomyłkę
                  z wyłączonym przyciskiem byłby pułapką bez wyjścia.
                */}
                {row.productId ? (
                  <RestoreDefaultDialog
                    disabled={pending}
                    name={row.productName ?? t("pages.exceptionProductFallback")}
                    live={row.live}
                    onConfirm={() => run(() => restoreDefaultProductPage(row.id))}
                  />
                ) : row.live ? (
                  <Button type="button" size="sm" variant="ghost" disabled data-delete-site-blocked={row.id}>
                    {t("pages.deleteBlocked")}
                  </Button>
                ) : (
                  <DeleteDialog
                    disabled={pending}
                    name={row.name}
                    onConfirm={() => run(() => deleteSite(row.id))}
                  />
                )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * POLE ADRESU — jedno miejsce na podpowiedź z nazwy, walidację i uzasadnienie.
 *
 * Odmowa pada W POLU, zanim cokolwiek zostanie wysłane, i mówi CO poprawić:
 * strona o adresie `koszyk` czy `regulamin` nie wyświetliłaby się NIGDY —
 * statyczna trasa zawsze wygrywa z dynamiczną — a operator widziałby ją
 * w panelu jako opublikowaną i nie dostałby ani jednego sygnału.
 */
function SlugField({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  hint: string;
}) {
  const t = useTranslations("site");
  const issue = disabled ? null : pageSlugIssue(value);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-[13px] leading-[18px]">/</span>
        <Input
          value={value}
          maxLength={60}
          disabled={disabled}
          className="font-mono"
          aria-label={t("pages.slugLabel")}
          aria-invalid={issue ? true : undefined}
          data-site-slug-input
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{hint}</p>
      {issue ? (
        <p role="alert" data-site-slug-error className="text-destructive text-[13px] leading-[18px] font-medium">
          {issue}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Nowa strona — nazwa I ADRES od razu (Faza 2, ADR-158).
 *
 * Adres podpowiada się z nazwy DOPÓKI operator go nie tknie (wzorzec formularza
 * kategorii, ADR-155): dalsze przepisywanie po ręcznej zmianie kasowałoby jego
 * pracę przy każdym znaku nazwy.
 *
 * WARIANT `home` (ADR-168) — TO SAMO OKNO, INNY CZASOWNIK. Strona główna nie
 * ma adresu do podania: jej adresem jest `/`. Pole adresu jest więc WYGASZONE,
 * a nie ukryte (ta sama zasada, co w oknie zmiany nazwy), a wywołanie idzie
 * BEZ klucza `slug` — bo pusty adres wpisany w pole dalej jest błędem
 * („z tej nazwy nie da się go wyprowadzić"), a pominięty znaczy stronę główną.
 * Dwie kopie okna rozjechałyby się przy pierwszej zmianie w polu nazwy.
 */
/**
 * OKNO ZAKŁADANIA STRONY — trzy warianty, jedna różnica (faza 5, ADR-178).
 *
 * Warianty dzieli dokładnie jedno: czy operator PODAJE ADRES.
 *   • `page` — podaje; adres jest treścią decyzji;
 *   • `home` — nie podaje, bo adresem strony głównej jest `/`;
 *   • `template` — nie podaje, bo szablon nie ma adresu W OGÓLE.
 *
 * Dwa ostatnie różnią się między sobą wyłącznie tekstem i rolą wysyłaną do
 * akcji — dlatego wariant jest SŁOWNIKIEM, a nie parą flag boolowskich:
 * `home && template` nie jest stanem, który cokolwiek znaczy, a para flag
 * pozwalałaby go zapisać.
 */
type NewPageVariant = "page" | "home" | "template";

function NewPageDialog({
  disabled,
  variant = "page",
  onCreate,
}: {
  disabled: boolean;
  variant?: NewPageVariant;
  /** `slug === undefined` = adres z gałęzi domyślnej akcji (strona główna / szablon). */
  onCreate: (name: string, slug: string | undefined) => void;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const addressless = variant !== "page";

  // Nazwa jest daną WYŁĄCZNIE panelową (sklep jej nie widzi), więc warianty
  // bez adresu startują z gotową propozycją: operator ma tu do podjęcia jedną
  // decyzję, nie dwie.
  const initialName =
    variant === "home"
      ? t("pages.homeDefaultName")
      : variant === "template"
        ? t("pages.templateDefaultName")
        : "";
  const blocked = name.trim().length === 0 || (!addressless && pageSlugIssue(slug) !== null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(initialName);
          setSlug("");
          setSlugTouched(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          {...(variant === "home"
            ? { "data-new-home-page": "" }
            : variant === "template"
              ? { "data-new-product-template": "" }
              : { "data-new-site": "" })}
        >
          <Plus className="size-4" aria-hidden />
          {variant === "home"
            ? t("pages.newHome")
            : variant === "template"
              ? t("pages.newTemplate")
              : t("pages.new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {variant === "home"
              ? t("pages.newHomeTitle")
              : variant === "template"
                ? t("pages.newTemplateTitle")
                : t("pages.newTitle")}
          </DialogTitle>
          <DialogDescription>
            {variant === "home"
              ? t("pages.newHomeBody")
              : variant === "template"
                ? t("pages.newTemplateBody")
                : t("pages.newBody")}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          maxLength={80}
          placeholder={t("pages.defaultName")}
          aria-label={t("pages.nameLabel")}
          onChange={(event) => {
            setName(event.target.value);
            if (!addressless && !slugTouched) setSlug(suggestPageSlug(event.target.value));
          }}
        />
        <SlugField
          value={slug}
          disabled={addressless}
          hint={
            variant === "home"
              ? t("pages.slugHome")
              : variant === "template"
                ? t("pages.slugTemplate")
                : t("pages.slugHint")
          }
          onChange={(next) => {
            setSlugTouched(true);
            setSlug(next);
          }}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            {...(variant === "home"
              ? { "data-new-home-page-confirm": "" }
              : variant === "template"
                ? { "data-new-product-template-confirm": "" }
                : { "data-new-site-confirm": "" })}
            disabled={blocked}
            onClick={() => {
              onCreate(name.trim(), addressless ? undefined : slug.trim());
              setOpen(false);
            }}
          >
            {variant === "home"
              ? t("pages.newHomeConfirm")
              : variant === "template"
                ? t("pages.newTemplateConfirm")
                : t("pages.newConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * NAZWA I ADRES w JEDNYM oknie (Faza 2, ADR-158).
 *
 * Adres jest daną publiczną, więc zmienia się WYŁĄCZNIE publikacją — zapis
 * z tego okna idzie do kolumny szkicu. To jest zarazem jedyne miejsce, w którym
 * operator zmienia adres, czyli jedyne, w którym trzeba go zapytać o los
 * starego adresu (ADR-159, checkbox przekierowania).
 *
 * STRONA GŁÓWNA MA POLE ADRESU WYŁĄCZONE, a nie ukryte: jej adresem jest `/`
 * i to jest informacja, nie brak funkcji. Ukrycie pola kazałoby operatorowi
 * zgadywać, czy strona główna w ogóle ma adres.
 */
function RenameDialog({
  disabled,
  current,
  kind,
  exception = false,
  currentSlug,
  publishedSlug,
  redirectOldSlug,
  onRename,
}: {
  disabled: boolean;
  current: string;
  /** ROLA wiersza (ADR-178) — rozstrzyga zdanie przy wygaszonym polu adresu. */
  kind: SiteKind;
  /**
   * WYJĄTEK (ADR-200): własna strona jednego sprzętu. Pole adresu zachowuje
   * się jak przy matce (wygaszone, adres nie jedzie w wywołaniu), ale POWÓD
   * jest inny — strona pokazuje się pod adresem TEGO sprzętu, nie każdego —
   * a powód jest tym, co operator czyta.
   */
  exception?: boolean;
  currentSlug: string;
  publishedSlug: string | null;
  redirectOldSlug: boolean;
  onRename: (name: string, slug: string | undefined, redirect: boolean | undefined) => void;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);
  const [slug, setSlug] = useState(currentSlug);
  const [redirect, setRedirect] = useState(redirectOldSlug);
  const isTemplate = isProductTemplateKind(kind);
  /*
    SZABLON MA PUSTY SLUG, więc bez rozróżnienia po roli wpadałby w gałąź
    strony głównej i dostawał zdanie „Strona główna sklepu ma adres „/”…" —
    zdanie PRAWDZIWE o innym wierszu i FAŁSZYWE o tym. Zachowanie pola
    (wygaszone, adres nie jedzie w wywołaniu) jest w obu przypadkach to samo
    i to jest właściwe: ani strona główna, ani szablon adresu nie zmieniają.
    Różni je wyłącznie POWÓD — a powód jest tym, co operator czyta.
  */
  const isHome = !isTemplate && currentSlug === HOME_PAGE_SLUG;
  const addressless = isHome || isTemplate;

  /*
    PYTANIE O STARY ADRES PADA TAM, GDZIE ZMIENIA SIĘ ADRES (ADR-159).
    Widoczne wyłącznie wtedy, gdy stary adres NAPRAWDĘ istnieje — strona nigdy
    nieopublikowana nie ma czego przekierowywać, a checkbox bez konsekwencji
    uczy operatora, że opcje w tym oknie nic nie znaczą.
  */
  const zmienionyAdres =
    !addressless && publishedSlug !== null && publishedSlug !== "" && slug.trim() !== publishedSlug;

  const blocked = name.trim().length === 0 || (!addressless && pageSlugIssue(slug) !== null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(current);
          setSlug(currentSlug);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-rename-site>
          {t("pages.rename")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.renameTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          maxLength={80}
          aria-label={t("pages.nameLabel")}
          onChange={(event) => setName(event.target.value)}
        />
        <SlugField
          value={slug}
          disabled={addressless}
          hint={
            isTemplate
              ? exception
                ? t("pages.slugException")
                : t("pages.slugTemplate")
              : isHome
                ? t("pages.slugHome")
                : t("pages.slugChangeHint")
          }
          onChange={setSlug}
        />
        {zmienionyAdres ? (
          <label className="flex items-start gap-2 text-[13px] leading-[18px]">
            <Checkbox
              checked={redirect}
              data-redirect-old-slug
              onCheckedChange={(next) => setRedirect(next === true)}
            />
            <span>
              {t("pages.redirectOld", { old: pagePathFromSlug(publishedSlug ?? "") })}
              <span className="text-muted-foreground block">{t("pages.redirectOldHint")}</span>
            </span>
          </label>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            data-rename-site-confirm
            disabled={blocked}
            onClick={() => {
              onRename(
                name.trim(),
                addressless ? undefined : slug.trim(),
                zmienionyAdres ? redirect : undefined,
              );
              setOpen(false);
            }}
          >
            {t("pages.renameConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * POTWIERDZENIE ZDJĘCIA STRONY ZE SKLEPU (0078, ADR-170).
 *
 * Okno mówi trzy rzeczy, z których każda jest osobnym powodem, żeby operator
 * przerwał — i każda jest niewidoczna z listy:
 *
 *   1. CO ZOBACZY KLIENT POD TYM ADRESEM. Dla podstrony to strona błędu, dla
 *      STRONY GŁÓWNEJ — korzeń sklepu bez treści, i to jest wyjątek, który
 *      musi zostać nazwany. Zdjęcie strony głównej przywraca dokładnie ten stan,
 *      który naprawił ADR-168; zakaz byłby jednak gorszy od ostrzeżenia, bo
 *      stroną opublikowaną przez pomyłkę bywa właśnie ona, a wtedy operator
 *      zostawałby z pomyłką w sklepie i bez żadnego wyjścia.
 *   2. ŻE PRACA NIE GINIE. Bliźniaki `*_published` zostają (ADR-093 D2), więc
 *      ponowna publikacja przywraca stronę — inaczej operator myliłby to
 *      okno z usunięciem.
 *   3. ŻE GASNĄ PRZEKIEROWANIA ZE STARYCH ADRESÓW. `app.get_tenant_pages`
 *      wypuszcza 308 wyłącznie dla strony, która dalej jest żywa (0075), więc
 *      zdjęcie strony gasi też każdy link, który do niej prowadził. Zdanie
 *      pojawia się tylko wtedy, gdy takie adresy naprawdę są.
 */
function UnpublishDialog({
  disabled,
  name,
  address,
  kind,
  exceptionProductName = null,
  home,
  redirectedFrom,
  onConfirm,
}: {
  disabled: boolean;
  name: string;
  address: string;
  /** ROLA wiersza (ADR-178) — rozstrzyga, o czym mówi zdanie o skutku. */
  kind: SiteKind;
  /**
   * WYJĄTEK (ADR-200): zdjęcie ze sklepu nie „przywraca układu wbudowanego"
   * (zdanie prawdziwe o MATCE), tylko oddaje adres tego sprzętu z powrotem
   * wspólnemu szablonowi — a wbudowanej dopiero, gdy szablonu nie ma żywego.
   */
  exceptionProductName?: string | null;
  home: boolean;
  redirectedFrom: string[];
  onConfirm: () => void;
}) {
  const t = useTranslations("site");
  const isTemplate = isProductTemplateKind(kind);
  const isException = isTemplate && exceptionProductName !== null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-unpublish-site>
          {t("pages.unpublish")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.unpublishTitle", { name })}</DialogTitle>
          <DialogDescription
            data-unpublish-scope={
              isException ? "exception" : isTemplate ? "template" : home ? "home" : "page"
            }
          >
            {isException
              ? t("pages.unpublishBodyException", { name: exceptionProductName })
              : isTemplate
                ? t("pages.unpublishBodyTemplate")
                : home
                  ? t("pages.unpublishBodyHome")
                  : t("pages.unpublishBody", { address })}
          </DialogDescription>
        </DialogHeader>
        {redirectedFrom.length > 0 ? (
          <p data-unpublish-redirects className="text-muted-foreground text-[13px] leading-[18px]">
            {t("pages.unpublishRedirects", {
              list: redirectedFrom.map((slug) => pagePathFromSlug(slug)).join(", "),
            })}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              type="button"
              variant="destructive"
              data-unpublish-site-confirm
              onClick={onConfirm}
            >
              {t("pages.unpublishConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * OKNO FORKA: „utwórz stronę sprzętu" (faza B, ADR-200 — B1).
 *
 * Operator podejmuje tu dokładnie JEDNĄ decyzję: KTÓREGO sprzętu dotyczy
 * własna strona. Nazwy nie podaje (bierze ją z katalogu akcja — nazwa strony
 * ma mówić, o który sprzęt chodzi), adresu nie podaje (strona pokazuje się pod
 * adresem sprzętu), treści nie wybiera (przyjeżdża KOPIĄ szkicu wspólnego
 * szablonu — ADR-199 R6: kopia, nie referencja).
 *
 * Lista niesie wyłącznie sprzęt BEZ własnej strony: drugi szkic tego samego
 * produktu jest dla bazy legalny, ale dla operatora byłby dwiema stronami,
 * z których żywa może być jedna — dokładnie ta klasa niejasności, którą przy
 * matce zamyka `hasProductTemplate`.
 */
function NewExceptionDialog({
  disabled,
  products,
  onCreate,
}: {
  disabled: boolean;
  products: { id: string; name: string }[];
  onCreate: (productId: string) => void;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setProductId("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled} data-new-product-exception>
          <Plus className="size-4" aria-hidden />
          {t("pages.newException")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.newExceptionTitle")}</DialogTitle>
          <DialogDescription>{t("pages.newExceptionBody")}</DialogDescription>
        </DialogHeader>
        {products.length === 0 ? (
          <p data-exception-picker-empty className="text-muted-foreground text-[13px] leading-[18px]">
            {t("pages.exceptionPickerEmpty")}
          </p>
        ) : (
          <Select value={productId === "" ? undefined : productId} onValueChange={setProductId}>
            <SelectTrigger
              aria-label={t("pages.exceptionProductLabel")}
              data-exception-product-select
              className="w-full"
            >
              <SelectValue placeholder={t("pages.exceptionProductPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            data-new-product-exception-confirm
            disabled={productId === ""}
            onClick={() => {
              onCreate(productId);
              setOpen(false);
            }}
          >
            {t("pages.newExceptionConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * „PRZYWRÓĆ SZABLON DOMYŚLNY" (faza B, ADR-200 — B3; §4.5 dokumentu
 * architektury) — potwierdzenie usunięcia WYJĄTKU.
 *
 * Dwa zdania o skutku, rozstrzygane ŻYWOŚCIĄ wiersza, bo mówią o dwóch różnych
 * rzeczywistościach: strona żywa ZNIKA KLIENTOM (adres sprzętu wraca pod
 * wspólny szablon), strona robocza znika tylko z panelu — „w sklepie nic się
 * nie zmieni" jest wtedy prawdą, a przy żywej byłoby kłamstwem.
 */
function RestoreDefaultDialog({
  disabled,
  name,
  live,
  onConfirm,
}: {
  disabled: boolean;
  /** NAZWA SPRZĘTU (nie strony): skutek dotyczy adresu sprzętu. */
  name: string;
  live: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-restore-default>
          {t("pages.restoreDefault")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.restoreDefaultTitle", { name })}</DialogTitle>
          <DialogDescription data-restore-default-scope={live ? "live" : "draft"}>
            {live ? t("pages.restoreDefaultBodyLive") : t("pages.restoreDefaultBodyDraft")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              type="button"
              variant="destructive"
              data-restore-default-confirm
              onClick={onConfirm}
            >
              {t("pages.restoreDefaultConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Potwierdzenie usunięcia. Zdanie „klienci nigdy jej nie widzieli, więc
 * w sklepie nic się nie zmieni" jest PRAWDZIWE dokładnie dlatego, że żywej
 * wersji usunąć się nie da (trigger 0048) — gdyby dało, byłoby kłamstwem.
 */
function DeleteDialog({
  disabled,
  name,
  onConfirm,
}: {
  disabled: boolean;
  name: string;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-delete-site>
          {t("pages.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.deleteTitle", { name })}</DialogTitle>
          <DialogDescription>{t("pages.deleteBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" variant="destructive" data-delete-site-confirm onClick={onConfirm}>
              {t("pages.deleteConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * PODGLĄD SZKICU `/strona/[siteId]/podglad` (pinezka właściciela 2026-08-03) — strona
 * taka, jaka BĘDZIE po publikacji, otwierana w nowej karcie.
 *
 * ==================== DLACZEGO TRASA PANELU, A NIE SKLEPU ====================
 *
 * Kanon ADR-091 mówi, że stan publiczny czyta WYŁĄCZNIE `app.get_published_site`,
 * a ta funkcja nie zna słowa „szkic" i znać nie ma. Podgląd szkicu w sklepie
 * wymagałby więc albo drugiej ścieżki odczytu obok niej (czyli dokładnie tego
 * wycieku, który 0045 zamknęło), albo parametru „pokaż mi draft", którego nie da
 * się obronić: adres z parametrem wycieka w linku, w logu i w cache CDN-a.
 *
 * Podgląd jest zatem TRASĄ PANELU. Konsekwencje są dokładnie te, których
 * chcemy, i wynikają z architektury, a nie z uprzejmości tego pliku:
 *
 *   • dane idą przez `requireMemberPage` i RLS (0019) — obcy tenant nie ma jak
 *     zobaczyć cudzego szkicu, bo nie ma go w swoim zapytaniu;
 *   • anonim nie ma tu wstępu: to trasa za bramką sesji panelu;
 *   • sklep publiczny nie dostaje ANI JEDNEJ nowej ścieżki odczytu.
 *
 * ==================== DLACZEGO TEN SAM RENDERER ====================
 *
 * `SiteRenderer` z @avably/ui jest jedynym renderem strony najemcy (ADR-083):
 * ten sam kod maluje płótno kreatora, sklep i ten podgląd. Drugi render byłby
 * drugą prawdą o tym, jak wygląda strona — a podgląd istnieje właśnie po to,
 * żeby prawda była jedna.
 *
 * RÓŻNICA WOBEC PŁÓTNA: tu odsiewamy sekcje wyłączone i usunięte w szkicu.
 * Płótno pokazuje je celowo (są do edycji i do przywrócenia), ale podgląd
 * odpowiada na pytanie „co zobaczy klient po publikacji" — a klient ich nie
 * zobaczy.
 *
 * ==================== POWŁOKA SKLEPU, NIE SAME SEKCJE (ADR-172) ====================
 *
 * Do ADR-172 trasa rysowała WYŁĄCZNIE sekcje strony, a pasek obiecywał przy tym
 * wprost „Tak strona wygląda po publikacji". Sklep stawia nad sekcjami powłokę
 * na KAŻDEJ trasie (znak firmy zamiast nazwy, koszyk) i dokłada pod nimi stopkę
 * ze strony głównej — więc obietnica była fałszywa dokładnie tam, gdzie ma być
 * wiarygodna, a w całym panelu nie istniała ani jedna powierzchnia pokazująca
 * wgrany znak w NAGŁÓWKU, czyli w głównym miejscu jego użycia.
 *
 * Kształt powłoki mieszka od ADR-172 w pakiecie UI (`StoreShellHeader`,
 * `StoreShellFooter`), bo panel nie ma prawa importować ze storefrontu, a dwa
 * kształty powłoki znaczyłyby dwie prawdy o tym, co widzi klient.
 *
 * Nagłówek podglądu NIE PROWADZI donikąd (`interactive={false}`): trasa stoi
 * w panelu, gdzie `/store` i `/cart` nie istnieją, a odnośnik wyprowadzający
 * operatora z podglądu na 404 byłby gorszy niż jego brak. Licznika koszyka nie
 * ma z tego samego powodu — koszyk jest stanem przeglądarki KLIENTA.
 *
 * `force-dynamic` z tego samego powodu, co w kreatorze: bez pinu Next wciągnąłby
 * trasę w statyczny prerender, a CSP panelu (nonce per żądanie) odmówiłaby
 * wykonania skryptów wypieczonych z nonce'em z czasu builda.
 */
import {
  SiteChrome,
  SiteRenderer,
  StoreShellFooter,
  StoreShellHeader,
  type RenderSection,
} from "@avably/ui";
import { isProductTemplateKind } from "@avably/core/site";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { previewShellSections } from "./shell-sections";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { previewProductsFor } from "@/lib/site-preview-data";
import { siteImagePublicBase } from "@/lib/site-image-base";
import { getTenantDraftStyle } from "@/lib/tenant-appearance";
import { tenantLogo, tenantLogoRender } from "@/lib/tenant-logo-render";
import { getSiteWithSections } from "@/lib/site-queries";
import { getTenantSiteLocale, siteRenderLabels } from "@/lib/site-render-labels";
import { getTenantCurrency } from "@/lib/tenant-currency";

export const dynamic = "force-dynamic";

export default async function SiteDraftPreviewPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const ctx = await requireMemberPage(`/strona/${siteId}/podglad`);
  /*
   * Nonce czytamy PO bramce sesji, nie przed. Kolejność jest kontraktem:
   * `headers()` poza zakresem żądania rzuca, a kontrakt tras chronionych
   * woła tę funkcję właśnie tak, żeby sprawdzić, czy anonim wychodzi na
   * logowanie. Odczyt przed bramką zamieniał odesłanie w wyjątek.
   */
  const revealNonce = (await headers()).get("x-nonce") ?? undefined;
  const data = await getSiteWithSections(siteId);
  if (!data) notFound();

  /*
   * DWA JĘZYKI NA JEDNEJ STRONIE — I OBA CELOWO (L6, ADR-102). PASEK podglądu
   * jest chrome PANELU i mówi językiem OPERATORA (`getLocale()`, locale URL).
   * STRONA pod nim jest tym, co zobaczy klient — więc etykiety chrome renderu
   * (`labels`) i formatowanie pieniędzy jadą z `tenants.locale`, tej samej osi
   * tenanckiej, z której czyta sklep. Do L6 wszystko szło językiem panelu:
   * `SiteRenderer` bez `labels` spadał na `DEFAULT_SITE_LABELS` (polskie),
   * a najemca EN oglądał w podglądzie „doba", której jego klient nie zobaczy.
   */
  const t = await getTranslations("site");
  const tenantLocale = await getTenantSiteLocale(ctx.supabase, ctx.tenantId!);
  const labels = siteRenderLabels(tenantLocale);
  const products = await previewProductsFor(ctx, ctx.tenantId!, tenantLocale);
  // Waluta i zapis kwot (E6) — podgląd szkicu pokazuje cennik tak, jak sklep.
  const money = {
    currency: await getTenantCurrency(ctx.supabase, ctx.tenantId!),
    locale: tenantLocale,
  };
  // Wygląd SZKICU jest własnością SKLEPU (ADR-161) — podgląd dowolnej strony
  // pokazuje więc ten sam motyw, akcent i krój, co podgląd każdej innej.
  const style = await getTenantDraftStyle(ctx.supabase, ctx.tenantId!);

  /*
    ZNAK FIRMY W PODGLĄDZIE — z kolumny SZKICU (ADR-160). To jest miejsce, dla
    którego bliźniak w ogóle istnieje: najemca ma zobaczyć wgrany znak, ZANIM
    zobaczy go klient. Sklep czyta wyłącznie `logo_published`, więc te dwie
    powierzchnie mają prawo pokazywać co innego — i to nie jest rozjazd, tylko
    cała różnica między szkicem a publikacją.

    NIEUDANY ODCZYT NIE JEST TU „BRAKIEM ZNAKU" (ADR-174), ale nie jest też
    powodem do wywrócenia trasy — i dlatego ten odczyt kończy się INACZEJ niż
    pozostałe z tej paczki. Znak jest opcjonalny: najemca, który go nie wgrał,
    ogląda poprawny podgląd bez znaku i to jest stan LEGALNY. Wywrócenie
    podglądu z powodu jednej kolumny zabrałoby operatorowi całą odpowiedź na
    pytanie „co zobaczy klient" — a połknięcie błędu dawało odpowiedź FAŁSZYWĄ
    („znaku nie ma"), na którą operator reaguje wgrywaniem znaku jeszcze raz.
    Trzeci stan — „nie udało się odczytać" — jest jedynym, który mówi prawdę:
    podgląd stoi, a operator wie, że o znaku ta strona akurat nic nie wie.
  */
  const { data: tenantRow, error: tenantError } = await ctx.supabase
    .from("tenants")
    .select("name, logo_draft")
    .eq("id", ctx.tenantId!)
    .maybeSingle();
  const storeName = (tenantRow?.name as string | undefined) ?? "";
  const draftLogo = tenantError ? null : tenantLogo(tenantRow?.logo_draft);
  const headerLogo = tenantLogoRender(draftLogo, storeName);
  const footerLogo = draftLogo?.inFooter ? headerLogo : null;

  /*
    NAPIS KOSZYKA W JĘZYKU SKLEPU, nie panelu — powłoka jest tym, co zobaczy
    klient, więc mówi osią tenancką (L6, ADR-102), tak samo jak `labels` wyżej.
    Wartość jest LUSTREM `storefront.nav.cart`; równość przypina kontrakt
    w `test/site-preview-shell.test.tsx`.
  */
  const shellCopy = await getTranslations({ locale: tenantLocale, namespace: "site.shell" });

  /*
    PODZIAŁ NA STRONĘ I POWŁOKĘ (ADR-172) — stopka podstrony nie renderuje się
    w sklepie, więc nie renderuje się i tutaj; zamiast niej podgląd rysuje
    stopkę strony GŁÓWNEJ, dokładnie jak `/store/[slug]`. Patrz `./shell-sections`.
  */
  const { page, shell, shadowedPinned } = await previewShellSections(
    ctx.supabase,
    ctx.tenantId!,
    { slug: data.site.slug, kind: data.site.kind },
    data.sections,
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        PASEK PODGLĄDU. Karta z podglądem żyje obok karty z kreatorem, więc bez
        podpisu operator po minucie nie wie, na którą patrzy — a różnica jest
        istotna: to, co tu widać, klient zobaczy DOPIERO po publikacji.
      */}
      <header
        data-preview-bar
        className="border-border bg-background sticky top-0 z-50 flex items-center justify-between gap-3 border-b px-4 py-2"
      >
        <p className="text-sm font-medium">{t("preview.draftTitle")}</p>
        <div className="flex items-center gap-3">
          {/*
            TRZECI STAN ZNAKU — „nie udało się odczytać" (ADR-174). Stoi w PASKU
            podglądu, bo pasek jest chrome PANELU i mówi językiem operatora,
            a strona pod nim jest tym, co zobaczy klient — i klient o awarii
            odczytu w panelu nic wiedzieć nie ma.

            Znacznik zostaje w rodzinie `data-preview-*` tego paska (obok
            `data-preview-bar` i `data-preview-back`), a nie w `data-builder-*`:
            tamta rodzina istnieje po to, żeby rejestr warstwy edycyjnej sklepu
            pilnował znaczników PŁÓTNA w publicznym renderze, a pasek podglądu
            nie jest warstwą edycyjną i do renderu sklepu nie wchodzi.
          */}
          {tenantError ? (
            <p
              data-preview-logo-unreadable
              role="status"
              className="text-destructive text-sm font-medium"
            >
              {t("preview.logoUnreadable")}
            </p>
          ) : null}
          {/*
            STOPKA TEJ STRONY NIE DOCIERA DO KLIENTA (ADR-172) — i operator ma
            to usłyszeć TUTAJ, bo podgląd jest jedyną powierzchnią, na której
            widzi, co naprawdę dostanie odwiedzający. Ciche pominięcie byłoby
            drugą odmianą tej samej wady: praca dalej znika, tylko bez śladu.
          */}
          {shadowedPinned ? (
            <p data-preview-footer-shadowed className="text-muted-foreground text-sm">
              {t("preview.footerShadowed")}
            </p>
          ) : null}
          <p className="text-muted-foreground hidden text-sm sm:block">{t("preview.draftHint")}</p>
          <Link
            href={`/strona/${siteId}/kreator`}
            data-preview-back
            className="text-sm underline underline-offset-4"
          >
            {t("preview.backToBuilder")}
          </Link>
        </div>
      </header>

      {page.length === 0 && shell.length === 0 ? (
        <p className="text-muted-foreground m-auto max-w-md px-6 text-center text-sm">
          {t("preview.draftEmpty")}
        </p>
      ) : (
        /*
          KORZEŃ STRONY NAJEMCY WYSTAWIA POWŁOKA, NIE RENDERER (K6, ADR-092) —
          tak samo, jak w sklepie: nagłówek stoi POD korzeniem i dzięki temu
          bierze zmienne motywu, zamiast palety panelu. Do ADR-172 korzeń
          wystawiał tu `SiteRenderer` (`asRoot` domyślnie), a nagłówka nie było
          wcale.
        */
        <SiteChrome
          style={style}
          /*
            PODGLĄD JEST W RUCHU (E8, przewód pod E9). Płótno kreatora stoi, bo
            tam się stronę USTAWIA; tutaj się ją OGLĄDA, więc animacje wejścia
            jadą tym samym torem, co na sklepie: liczby bierze preset ruchu
            MOTYWU (ADR-090/K6), a ostatnie słowo ma `prefers-reduced-motion`
            czytelnika (bramka w arkuszu). Wartość stoi JAWNIE, choć jest
            domyślna — inaczej różnica między podglądem a płótnem byłaby brakiem
            linijki. Od ADR-172 niesie ją KORZEŃ, bo to on rozstrzyga o ruchu.
          */
          motion="auto"
          /*
           * NONCE POD SKRYPT UZBRAJAJĄCY (ADR-097). Podgląd ma pokazywać to
           * samo, co sklep — także ruch. Płótno kreatora nonce'a NIE dostaje
           * i to jest drugi zamek obok `motion="off"`: warstwa edycyjna nie ma
           * jak się uzbroić, nawet gdyby ktoś zdjął tamten atrybut.
           */
          revealNonce={revealNonce}
          className="flex min-h-0 flex-1 flex-col"
        >
          <StoreShellHeader
            storeName={storeName}
            logo={headerLogo}
            cartLabel={shellCopy("cart")}
            /*
              NAGŁÓWEK STOI, ALE NIE PROWADZI. Trasa jest w panelu — `/store`
              i `/cart` nie istnieją pod tym adresem, więc żywy odnośnik
              wyprowadzałby operatora z podglądu na 404.
            */
            interactive={false}
          />
          <main className="min-h-0 flex-1">
            <SiteRenderer
              // Rzutowanie jak w płótnie kreatora: `RenderSection` jest unią
              // dyskryminowaną po typie, a mapowanie wyżej gubi dla TS-a związek
              // typu z treścią — w czasie wykonania para jest spójna, bo pochodzi
              // z `toEditorSections`, które parsuje treść schematem TEGO typu.
              sections={page as unknown as RenderSection[]}
              style={style}
              /*
                `asRoot={false}` — korzeń wystawia powłoka wyżej, tym SAMYM
                stylem. Dwa korzenie znaczyłyby dwa kontenery zapytań `site`
                i podwójnie liczoną szerokość, na której stoi responsywność
                sekcji (ADR-085). Lustro trasy sklepu.
              */
              asRoot={false}
              /*
                KOTWICE SEKCJI: podgląd odpowiada na pytanie „co dostanie
                klient", a klient dostaje stronę, na której przycisk hero
                prowadzi na `#produkty`. Podgląd jest — obok sklepu — jedyną
                powierzchnią, która jest CAŁĄ stroną i występuje w dokumencie
                raz, więc `id` mogą tu stanąć bez ryzyka duplikatu (płótno
                i galeria szablonów kotwic nie dostają).
              */
              anchors
              products={products}
              /*
                POZYCJA, NA KTÓREJ STOI SZABLON (faza 5, ADR-178) — lustro
                kreatora i lustro sklepu. Bez niej podgląd szablonu pokazywałby
                stronę z powycinanymi węzłami i obiecywał przy tym „Tak strona
                wygląda po publikacji" — czyli dokładnie to kłamstwo podglądu,
                które zamknął ADR-172.
              */
              record={isProductTemplateKind(data.site.kind) ? products[0] : undefined}
              /*
                ETYKIETY CHROME RENDERU w locale TENANTA (L6, ADR-102) — lustro
                sklepu: bez tego propsu render spada na `DEFAULT_SITE_LABELS`
                (polskie) i najemca EN ogląda podgląd, który kłamie o języku
                jego strony.
              */
              labels={labels}
              money={money}
              siteImageBase={siteImagePublicBase()}
            />
          </main>
          {/*
            STOPKA POWŁOKI ZE STRONY GŁÓWNEJ (ADR-154/172) — ten sam kształt,
            co w sklepie, z tym samym prefiksem zdjęć i tym samym znakiem.
            `footerLogo` rozstrzyga się WYŻEJ (przełącznik najemcy), a nie
            w pakiecie UI.
          */}
          <StoreShellFooter
            sections={shell as unknown as RenderSection[]}
            style={style}
            logo={footerLogo}
            siteImageBase={siteImagePublicBase()}
            labels={labels}
            money={money}
          />
        </SiteChrome>
      )}
    </div>
  );
}

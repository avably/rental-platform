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
 * `force-dynamic` z tego samego powodu, co w kreatorze: bez pinu Next wciągnąłby
 * trasę w statyczny prerender, a CSP panelu (nonce per żądanie) odmówiłaby
 * wykonania skryptów wypieczonych z nonce'em z czasu builda.
 */
import { resolveSiteStyle } from "@avably/core/site";
import { SiteRenderer, type RenderSection } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { previewProductsFor } from "@/lib/site-preview-data";
import { siteImagePublicBase } from "@/lib/site-image-base";
import { getSiteWithSections } from "@/lib/site-queries";
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

  const [t, locale] = await Promise.all([getTranslations("site"), getLocale()]);
  const products = await previewProductsFor(ctx, ctx.tenantId!);
  // Waluta i zapis kwot (E6) — podgląd szkicu pokazuje cennik tak, jak sklep.
  const money = { currency: await getTenantCurrency(ctx.supabase, ctx.tenantId!), locale };
  const style = resolveSiteStyle(data.site.style_draft, data.site.template);

  const sections = toEditorSections(data.sections)
    .filter((section) => section.enabled && !section.deletedInDraft)
    .map((section) => ({
      id: section.id,
      position: section.position,
      type: section.type,
      content: section.content,
    }));

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

      {sections.length === 0 ? (
        <p className="text-muted-foreground m-auto max-w-md px-6 text-center text-sm">
          {t("preview.draftEmpty")}
        </p>
      ) : (
        <main className="min-h-0 flex-1">
          <SiteRenderer
            // Rzutowanie jak w płótnie kreatora: `RenderSection` jest unią
            // dyskryminowaną po typie, a mapowanie wyżej gubi dla TS-a związek
            // typu z treścią — w czasie wykonania para jest spójna, bo pochodzi
            // z `toEditorSections`, które parsuje treść schematem TEGO typu.
            sections={sections as unknown as RenderSection[]}
            style={style}
            /*
             * NONCE POD SKRYPT UZBRAJAJĄCY (ADR-097). Podgląd ma pokazywać to
             * samo, co sklep — także ruch. Płótno kreatora nonce'a NIE dostaje
             * i to jest drugi zamek obok `motion="off"`: warstwa edycyjna nie
             * ma jak się uzbroić, nawet gdyby ktoś zdjął tamten atrybut.
             */
            revealNonce={revealNonce}
            /*
              PODGLĄD JEST W RUCHU (E8, przewód pod E9). Płótno kreatora stoi,
              bo tam się stronę USTAWIA; tutaj się ją OGLĄDA, więc animacje
              wejścia jadą tym samym torem, co na sklepie: liczby bierze preset
              ruchu MOTYWU (ADR-090/K6), a ostatnie słowo ma
              `prefers-reduced-motion` czytelnika (bramka w arkuszu).

              Wartość stoi tu JAWNIE, choć jest domyślna — inaczej różnica
              między podglądem a płótnem byłaby brakiem linijki, a kontrakt
              „warstwa edycyjna stoi" nie miałby czego pilnować po tej stronie.
            */
            motion="auto"
            /*
              KOTWICE SEKCJI z tego samego powodu, co ruch: podgląd odpowiada
              na pytanie „co dostanie klient", a klient dostaje stronę, na
              której przycisk hero prowadzi na `#produkty`. Podgląd jest —
              obok sklepu — jedyną powierzchnią, która jest CAŁĄ stroną i
              występuje w dokumencie raz, więc `id` mogą tu stanąć bez ryzyka
              duplikatu (płótno i galeria szablonów kotwic nie dostają).
            */
            anchors
            products={products}
            money={money}
            siteImageBase={siteImagePublicBase()}
          />
        </main>
      )}
    </div>
  );
}

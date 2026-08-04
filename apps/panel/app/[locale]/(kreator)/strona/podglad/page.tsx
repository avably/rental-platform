/**
 * PODGLĄD SZKICU `/strona/podglad` (pinezka właściciela 2026-08-03) — strona
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
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { previewProductsFor } from "@/lib/site-preview-data";
import { getSiteWithSections } from "@/lib/site-queries";
import { siteImagePublicBase } from "@/lib/site-image-base";

export const dynamic = "force-dynamic";

export default async function SiteDraftPreviewPage() {
  const ctx = await requireMemberPage("/strona/podglad");
  const data = await getSiteWithSections();
  if (!data) notFound();

  const t = await getTranslations("site");
  const products = await previewProductsFor(ctx, ctx.tenantId!);
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
            href="/strona/kreator"
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
            products={products}
            siteImageBase={siteImagePublicBase()}
          />
        </main>
      )}
    </div>
  );
}

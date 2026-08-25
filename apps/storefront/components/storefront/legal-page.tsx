/**
 * Trasy dokumentów prawnych są CZTERY (regulamin, prywatnosc i permalinki
 * wersji obu), a różnią się dwiema wartościami. Wspólny render siedzi tutaj,
 * żeby cztery pliki tras nie były czterema kopiami tej samej bramki — a bramka
 * jest tu istotna: to ona decyduje, czy odwiedzający dostaje dokument, czy 404.
 *
 * DLACZEGO NIE DYNAMICZNY SEGMENT ZAMIAST CZTERECH TRAS: `(tenant)/[dokument]`
 * NIE ZBUDUJE SIĘ. Grupy tras nie zmieniają URL-a, więc taki plik rozwiązuje
 * się do tego samego wzorca co `[locale]/page.tsx` na osi marketingowej —
 * `Ambiguous route pattern`. Pierwszy segment trasy tenanckiej musi być
 * literałem; zagnieżdżone `w/[wersja]` jest już bezpieczne (precedens:
 * `product/[id]`).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentView } from "@/components/storefront/legal-document-view";
import { categoryNavItems } from "@/lib/catalog/category-nav";
import { PageShell } from "@/components/storefront/page-shell";
import {
  getLegalDocumentVersion,
  getPublishedLegalDocument,
  LEGAL_DOCUMENT_PATHS,
  type LegalDocumentKind,
} from "@/lib/legal/published";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
import { loadStorefrontContext } from "@/lib/storefront/context";
import { storeTermInput } from "@/lib/storefront/term-input";

/**
 * Metadane wspólne dla żywej wersji i permalinku.
 *
 * INDEKSUJEMY. Regulamin i polityka prywatności to realna treść budująca
 * zaufanie, a nie strona transakcyjna — `transactional` zostaje wyłączone,
 * więc `noindex` pojawia się wyłącznie tam, gdzie i tak by się pojawił: gdy
 * sklep nie ma opublikowanej strony (reguła z tenant-metadata). Wyjątkiem są
 * ARCHIWALNE wersje: te mają istnieć dla konkretnego klienta z konkretnym
 * zamówieniem, a nie konkurować w wynikach z wersją obowiązującą.
 */
export async function legalMetadata(
  kind: LegalDocumentKind,
  options: { versionNo?: number } = {},
): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const document =
    options.versionNo === undefined
      ? await getPublishedLegalDocument(ctx.tenantId, kind)
      : await getLegalDocumentVersion(ctx.tenantId, kind, options.versionNo);
  if (!document) return {};

  const storeName = ctx.catalog.tenant.name;
  const archived = options.versionNo !== undefined && !("current" in document && document.current);

  const metadata = await tenantMetadata({
    title: pageTitle(storeName, document.title),
    description: document.title,
    storeName,
    published: ctx.site !== null,
    origin: await tenantOrigin(),
    pathname:
      options.versionNo === undefined
        ? LEGAL_DOCUMENT_PATHS[kind]
        : `${LEGAL_DOCUMENT_PATHS[kind]}/w/${options.versionNo}`,
    locale: ctx.locale,
  });

  if (archived) metadata.robots = { index: false, follow: true };
  return metadata;
}

/** Żywa wersja dokumentu. Brak dokumentu = 404 sklepu, nie pusta strona. */
export async function LegalDocumentPage({ kind }: { kind: LegalDocumentKind }) {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const document = await getPublishedLegalDocument(ctx.tenantId, kind);
  if (!document) notFound();

  return (
    <PageShell
      style={ctx.style}
      copy={ctx.copy}
      storeName={ctx.catalog.tenant.name}
      site={ctx.site}
      logo={storeLogo(ctx)}
      siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}
      /*
        TERMIN: JEST — belka jest JEDNA na wszystkich trasach (decyzja PM, F11).
        Do F11 dokument prawny dostawał `null` z rozumowania „ta trasa nie
        sprzedaje" (faza 5, ADR-179). F7b zniosło tryby nagłówka i ta sama
        decyzja objęła kasę: klient ma widzieć TĘ SAMĄ belkę wszędzie, bo belka
        znikająco-zmienna czyta się jak inna strona, a nie jak inny kontekst.
        Pigułka nie jest tu kalendarzem „nad zamówieniem" — jest wyborem, który
        klient niesie ze sobą i do którego wraca z regulaminu jednym tapnięciem.
        Regułę „najemca wyłączył pigułkę" (ADR-203) trzyma dalej `storeTermInput`.
      */
      term={storeTermInput(ctx.storeFlags, ctx.catalog.products, ctx.locale)}
      /* Menu kategorii (S-30) — nagłówek prowadzi do oferty z każdej trasy. */
      categoryNav={categoryNavItems(ctx.catalog)}
      /*
        Self-linki stopki (S-52): „Regulamin" w stopce na /regulaminie dostaje
        `aria-current="page"` zamiast udawać nawigację.
      */
      currentPath={LEGAL_DOCUMENT_PATHS[kind]}
    >
      <LegalDocumentView
        title={document.title}
        body={document.body}
        versionLabel={document.version_label}
        publishedAt={document.published_at}
        sha256={document.sha256}
        locale={ctx.locale}
        copy={ctx.copy}
      />
    </PageShell>
  );
}

/**
 * PERMALINK wersji — decyzja właściciela: klient musi móc okazać to, na co
 * przystał, bez proszenia kogokolwiek o pomoc. Bezpieczne z konstrukcji:
 * wersje są niezmienne i wszystkie są opublikowane.
 */
export async function LegalDocumentVersionPage({
  kind,
  version,
}: {
  kind: LegalDocumentKind;
  version: string;
}) {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  // Numer, nie uuid — adres ma dać się przepisać z potwierdzenia. Wejście
  // spoza zakresu liczb naturalnych kończy się 404, a nie odpytaniem bazy.
  if (!/^[1-9][0-9]{0,8}$/.test(version)) notFound();

  const document = await getLegalDocumentVersion(ctx.tenantId, kind, Number(version));
  if (!document) notFound();

  return (
    <PageShell
      style={ctx.style}
      copy={ctx.copy}
      storeName={ctx.catalog.tenant.name}
      site={ctx.site}
      logo={storeLogo(ctx)}
      siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}
      /*
        TERMIN: JEST — belka jest JEDNA na wszystkich trasach (decyzja PM, F11).
        Do F11 dokument prawny dostawał `null` z rozumowania „ta trasa nie
        sprzedaje" (faza 5, ADR-179). F7b zniosło tryby nagłówka i ta sama
        decyzja objęła kasę: klient ma widzieć TĘ SAMĄ belkę wszędzie, bo belka
        znikająco-zmienna czyta się jak inna strona, a nie jak inny kontekst.
        Pigułka nie jest tu kalendarzem „nad zamówieniem" — jest wyborem, który
        klient niesie ze sobą i do którego wraca z regulaminu jednym tapnięciem.
        Regułę „najemca wyłączył pigułkę" (ADR-203) trzyma dalej `storeTermInput`.
      */
      term={storeTermInput(ctx.storeFlags, ctx.catalog.products, ctx.locale)}
      /* Menu kategorii (S-30) — jak w żywej wersji wyżej. */
      categoryNav={categoryNavItems(ctx.catalog)}
    >
      <LegalDocumentView
        title={document.title}
        body={document.body}
        versionLabel={document.version_label}
        publishedAt={document.published_at}
        sha256={document.sha256}
        locale={ctx.locale}
        copy={ctx.copy}
        currentHref={document.current ? undefined : LEGAL_DOCUMENT_PATHS[kind]}
      />
    </PageShell>
  );
}

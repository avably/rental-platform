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
        TERMIN: `null` — dokument prawny NIE SPRZEDAJE (faza 5, ADR-179).
        Kalendarz nad regulaminem byłby wyborem bez czego wybierać.
      */
      term={null}
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
        TERMIN: `null` — dokument prawny NIE SPRZEDAJE (faza 5, ADR-179).
        Kalendarz nad regulaminem byłby wyborem bez czego wybierać.
      */
      term={null}
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

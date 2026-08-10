/**
 * Dokument embedu (M3, ADR-120) — to jest treść ramki, którą fragment do
 * wklejenia stawia na stronie najemcy.
 *
 * `force-dynamic`: strona zależy od nagłówka tenanta wstrzykniętego przez
 * proxy, a prerender statyczny nie ma go skąd wziąć. Ten sam powód co
 * `(tenant)/store/page.tsx`.
 *
 * Katalog czytamy SERWEROWO i przekazujemy propsami — do przeglądarki idą
 * wyłącznie dane, które publiczny sklep najemcy i tak pokazuje anonimowi.
 * Nie ma tu klucza API ani żadnego sekretu do przekazania (patrz ADR-120).
 */
import { notFound } from "next/navigation";

import { checkoutCustomFields } from "@avably/core";

import { customFieldsFromPublicRows } from "@/lib/checkout/custom-fields";
import { loadEmbedContext } from "@/lib/embed/context";
import { findLegalDocument, LEGAL_DOCUMENT_PATHS } from "@/lib/legal/published";
import { EMBED_THEMES, type EmbedTheme } from "@/lib/embed/contract";
import { EmbedWidget } from "@/components/embed/embed-widget";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmbedWidgetPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const lang = firstValue(params.lang);
  const ctx = await loadEmbedContext(lang);
  if (ctx === null) notFound();

  // Motyw to parametr PREZENTACJI z zamkniętej listy — wartość spoza niej nie
  // trafia do DOM-u w żadnej postaci, więc atrybut ze strony gospodarza nie
  // jest kanałem wstrzyknięcia.
  const requestedTheme = firstValue(params.theme);
  const theme: EmbedTheme = EMBED_THEMES.includes(requestedTheme as EmbedTheme)
    ? (requestedTheme as EmbedTheme)
    : "light";

  // Produkt przypięty w fragmencie — jeśli wskazuje coś, czego nie ma w
  // katalogu TEGO najemcy, po prostu go ignorujemy i pokazujemy wybór. Cudzy
  // identyfikator nie ma jak stać się pozycją w tej liście.
  const pinnedProduct = firstValue(params.product);
  const products = ctx.catalog.products;
  const initialProductId =
    pinnedProduct !== undefined && products.some((product) => product.id === pinnedProduct)
      ? pinnedProduct
      : (products[0]?.id ?? null);

  // Regulamin najemcy — adres jest RELATYWNY, więc rozwiązuje się do domeny
  // sklepu, na której stoi ta ramka, a nie do strony gospodarza.
  const publishedTerms = findLegalDocument(ctx.legalDocuments, "terms");

  return (
    <EmbedWidget
      copy={ctx.copy}
      locale={ctx.locale}
      currency={ctx.currency}
      products={products}
      pickupLocations={ctx.catalog.pickup_locations}
      deliveryMethods={ctx.catalog.delivery_methods}
      initialProductId={initialProductId}
      theme={theme}
      customFields={checkoutCustomFields(customFieldsFromPublicRows(ctx.catalog.custom_fields))}
      terms={
        publishedTerms
          ? { href: LEGAL_DOCUMENT_PATHS.terms, versionLabel: publishedTerms.version_label }
          : undefined
      }
    />
  );
}

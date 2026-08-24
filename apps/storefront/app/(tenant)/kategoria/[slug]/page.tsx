/**
 * STRONA KATEGORII — `/kategoria/{slug}` (faza C, ADR-247; odczyt z ADR-244).
 *
 * ==================== PO CO TA TRASA ISTNIEJE ====================
 *
 * Taksonomia katalogu istnieje od 0072/ADR-155 (kategorie per najemca), a
 * fundament danych pod strony kategorii postawiła Faza A (0101/ADR-244:
 * `app.get_public_category_page` + baner `catalog_categories.image_path`). Do
 * tej trasy kategorie nie miały ani jednego adresu, pod którym klient
 * i wyszukiwarka mogliby przejrzeć jedną półkę oferty. Ta trasa go daje —
 * w tym samym szablonie i kaflem, co `/katalog`.
 *
 * SEGMENT `kategoria` JEST ZAREZERWOWANY (RESERVED_CATEGORY_SLUGS w @avably/core
 * i `app.reserved_store_paths()` w bazie, 0072/0085), więc kategoria najemcy
 * o slugu `kategoria` nie przejmie tej trasy, a proxy przepuści ścieżkę
 * wielosegmentową pod tym korzeniem (jak `/produkt/{slug}`, ADR-182).
 *
 * ==================== TRZY STANY → TRZY ZACHOWANIA (ADR-244) ====================
 *
 *   • najemca poza oknem handlowym → koperta NULL → 404,
 *   • slug nieznany                → `category` NULL → 404,
 *   • kategoria istnieje (też pusta)→ render (pusta pokazuje „nie ma jeszcze
 *     produktów", NIE 404).
 * Numer strony spoza zakresu to także 404 (jak `/katalog`, ADR-186) — poza
 * stroną PIERWSZĄ kategorii pustej. Wszystkie cztery 404 rozstrzyga
 * `loadCategoryPageContext` (kind !== "page"), zanim cokolwiek się wyrenderuje.
 *
 * BRAMKA jak katalog: `tenant_id` z nagłówka (rewrite middleware), inaczej 404.
 * Render dynamiczny (odczyt `headers()` pod CSP z nonce).
 */
import { parseCatalogPageParam } from "@avably/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { parseCategorySortParam } from "@/lib/catalog/category-path";
import { categoryPageMetadata, renderCategoryPage } from "@/lib/catalog/category-page";
import { loadCategoryPageContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Numer strony z adresu albo `null` — `null` znaczy „taki adres nie istnieje". */
async function zadanaStrona(searchParams: Params["searchParams"]): Promise<number | null> {
  const params = await searchParams;
  return parseCatalogPageParam(params.strona);
}

async function zadanySort(searchParams: Params["searchParams"]) {
  const params = await searchParams;
  return parseCategorySortParam(params.sort);
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const page = await zadanaStrona(searchParams);
  // Numer spoza formy kanonicznej nie jest adresem — nie ma czego indeksować.
  if (page === null) return { robots: { index: false, follow: false } };

  const { slug } = await params;
  const sort = await zadanySort(searchParams);
  const resolution = await loadCategoryPageContext(slug, page, sort);
  if (resolution.kind !== "page") return { robots: { index: false, follow: false } };

  return categoryPageMetadata(resolution.ctx);
}

export default async function TenantCategoryPage({ params, searchParams }: Params) {
  const page = await zadanaStrona(searchParams);
  if (page === null) notFound();

  const { slug } = await params;
  const sort = await zadanySort(searchParams);
  const resolution = await loadCategoryPageContext(slug, page, sort);
  if (resolution.kind !== "page") notFound();

  return renderCategoryPage({ ctx: resolution.ctx });
}

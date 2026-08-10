/**
 * Kontekst serwerowy dokumentu embedu (M3, ADR-120).
 *
 * Lustro `lib/storefront/context.ts`, ale CHUDSZE: ramka nie potrzebuje
 * opublikowanej strony sklepu (sekcje, styl, szablon), więc jej nie czyta —
 * to o jedno odpytanie mniej na każde wyświetlenie widgetu na cudzej stronie.
 *
 * Tenant bierze się WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po
 * anty-spoofingu. Brak nagłówka = host nie jest sklepem żadnego najemcy →
 * `null` → strona odda 404. Nie ma tu ścieżki, w której identyfikator najemcy
 * pochodziłby z zapytania, ciała albo atrybutu na stronie gospodarza.
 */
import { cache } from "react";
import { headers } from "next/headers";

import { getPublicCatalog } from "@/lib/checkout/catalog";
import {
  getPublishedLegalDocuments,
  type PublishedLegalDocumentSummary,
} from "@/lib/legal/published";
import { getStorefrontCopy, type StorefrontCopy } from "@/lib/storefront/copy";
import { normalizeStorefrontLocale, type StorefrontLocale } from "@/lib/storefront/locale";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";
import type { PublicCatalog } from "@/lib/checkout/contract";

export interface EmbedContext {
  tenantId: string;
  catalog: PublicCatalog;
  locale: StorefrontLocale;
  currency: string;
  copy: StorefrontCopy;
  /**
   * Spis opublikowanych dokumentów prawnych (B4, ADR-129) — BEZ treści.
   *
   * To jest świadome odstępstwo od zasady „ramka czyta jak najmniej": widget
   * zakłada ZAMÓWIENIA, więc jego zgoda musi wskazywać tę samą wersję
   * regulaminu co zgoda w sklepie. Gdyby embed dalej wysyłał stałą, dowód
   * zgody byłby domknięty tylko na części powierzchni, które sami renderujemy
   * — a to gorsze niż brak domknięcia, bo wygląda na domknięte.
   * Koszt: jedno odpytanie, wykonywane RÓWNOLEGLE z katalogiem.
   */
  legalDocuments: PublishedLegalDocumentSummary[];
}

async function _loadEmbedContext(langOverride?: string): Promise<EmbedContext | null> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return null;

  const [catalog, legalDocuments] = await Promise.all([
    getPublicCatalog(tenantId),
    getPublishedLegalDocuments(tenantId),
  ]);
  if (catalog === null) return null;

  // `lang` z fragmentu to JAWNIE zaprojektowany parametr PREZENTACJI — najemca
  // bywa dwujęzyczny i osadza widget na dwóch wersjach swojej strony. Wartość
  // nieznana normalizuje się do domyślnej; nie ma jak nią wskazać innych danych.
  const locale = normalizeStorefrontLocale(langOverride ?? catalog.tenant.locale);
  const copy = await getStorefrontCopy(locale);

  return { tenantId, catalog, locale, currency: catalog.tenant.currency, copy, legalDocuments };
}

/** `cache()` — layout i strona czytają to samo żądanie, nie dwa. */
export const loadEmbedContext = cache(_loadEmbedContext);

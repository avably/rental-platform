/**
 * Adres bazowy publicznego API pokazywany operatorowi (M2, ADR-110).
 *
 * BEZ ścieżki kontraktu: wtyczka WordPressa i inni klienci maszynowi
 * doklejają `/api/v1/…` SAMI, więc karta, która pokazywała bazę z sufiksem,
 * prowadziła operatora do `/api/v1/api/v1/catalog` → 404 i mylącej diagnozy
 * klucza (recenzja PM #212). Ścieżkę kontraktu nazywamy OSOBNO — stałą niżej,
 * przypiętą testem do realnego katalogu tras `apps/storefront/app/api/v1`.
 */
import { tenantSubdomainHost } from "@avably/core";

/** Ścieżka kontraktu publicznego API — pod nią żyją wszystkie punkty końcowe. */
export const API_CONTRACT_PATH = "/api/v1/";

/** `https://<slug>.avably.io` — bez końcowego ukośnika i bez ścieżki. */
export function apiBaseUrlForSlug(slug: string): string {
  return `https://${tenantSubdomainHost(slug)}`;
}

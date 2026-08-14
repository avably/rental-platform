"use server";

/**
 * Server Action: publiczna dostępność produktu w terminie (2.4b) — cienka
 * owijka na getPublicAvailability (warstwa danych 2.4a, kontrakt+rdzeń NIE
 * edytowane). Podstrona produktu woła ją przy zmianie terminu, żeby pokazać
 * „ile sztuk wolnych" bez ujawniania cudzych rezerwacji (RPC zwraca WYŁĄCZNIE
 * liczby, ADR-042).
 *
 * tenant_id bierzemy z nagłówka x-tenant-id (anty-spoofing middleware, ADR-039),
 * nigdy z klienta — tak samo jak submitCheckout. Brak nagłówka = żądanie spoza
 * gałęzi tenanckiej → null (fail-closed, jak sama warstwa danych).
 */
import { isWithinAvailabilityWindow } from "@avably/core";
import { headers } from "next/headers";

import {
  getPublicAvailability,
  getPublicAvailabilityDays,
  getPublicCatalogAvailability,
} from "@/lib/checkout/catalog";
import type {
  PublicAvailability,
  PublicAvailabilityDays,
  PublicCatalogAvailability,
} from "@/lib/checkout/contract";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Wspólne wejście wszystkich trzech akcji: najemca z NAGŁÓWKA (ADR-039) plus
 * tania walidacja kształtu dat. `null` znaczy „nie ma o co pytać" i jest
 * nieodróżnialne od odmowy bazy — wołający ma jedną ścieżkę degradacji, a nie
 * dwie.
 */
async function requestScope(
  startDate: string,
  endDate: string,
): Promise<{ tenantId: string } | null> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return null;
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || endDate < startDate) return null;
  return { tenantId };
}

export async function checkAvailability(
  productId: string,
  startDate: string,
  endDate: string,
): Promise<PublicAvailability | null> {
  const scope = await requestScope(startDate, endDate);
  if (scope === null || !productId) return null;

  return getPublicAvailability(scope.tenantId, productId, startDate, endDate);
}

/**
 * Dostępność CAŁEGO katalogu najemcy w zadanym terminie (ADR-179).
 *
 * Wejście NIE NIESIE listy produktów i to jest decyzja: gdyby niosło, klient
 * mógłby zapytać o cudze identyfikatory i po kształcie odpowiedzi wnioskować,
 * czy istnieją. Zakres pozycji rozstrzyga baza z najemcy w nagłówku — dokładnie
 * ten sam zbiór, który pokazuje katalog.
 */
export async function checkCatalogAvailability(
  startDate: string,
  endDate: string,
): Promise<PublicCatalogAvailability | null> {
  const scope = await requestScope(startDate, endDate);
  if (scope === null) return null;

  return getPublicCatalogAvailability(scope.tenantId, startDate, endDate);
}

/**
 * Dostępność DZIENNA jednego sprzętu — dane siatki kalendarza (ADR-179).
 *
 * Sufit okna sprawdzamy TU po raz drugi, mimo że bramką jest baza: odrzucenie
 * bez wyjścia do sieci jest tańsze, a gdyby ta gałąź kiedykolwiek rozjechała
 * się z bazą, rozjazd byłby w stronę BEZPIECZNĄ (odmawiamy okna, które baza by
 * przyjęła), nie odwrotnie.
 */
export async function checkAvailabilityDays(
  productId: string,
  startDate: string,
  endDate: string,
): Promise<PublicAvailabilityDays | null> {
  const scope = await requestScope(startDate, endDate);
  if (scope === null || !productId) return null;
  if (!isWithinAvailabilityWindow(startDate, endDate)) return null;

  return getPublicAvailabilityDays(scope.tenantId, productId, startDate, endDate);
}

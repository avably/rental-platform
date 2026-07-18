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
import { headers } from "next/headers";

import { getPublicAvailability } from "@/lib/checkout/catalog";
import type { PublicAvailability } from "@/lib/checkout/contract";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function checkAvailability(
  productId: string,
  startDate: string,
  endDate: string,
): Promise<PublicAvailability | null> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return null;

  // Tania walidacja kształtu przed RPC — RPC i tak zwróci null dla śmieci, ale
  // nie ma po co go wołać dla oczywiście złego wejścia.
  if (!productId || !ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || endDate < startDate) {
    return null;
  }

  return getPublicAvailability(tenantId, productId, startDate, endDate);
}

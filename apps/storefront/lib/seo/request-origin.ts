/**
 * Origin BIEŻĄCEGO żądania na osi tenanckiej (Zadanie 2.7, ADR-044).
 *
 * Osobno od `lib/seo/origin.ts`, bo tamten moduł jest czysty (testowalny bez
 * serwera) — tu dochodzi jedyna nieczysta rzecz: odczyt nagłówków. Strony
 * tenanckie są `force-dynamic`, więc `headers()` nic nie psuje.
 *
 * Canonical sklepu to jego WŁASNA subdomena, dlatego bierzemy host z żądania,
 * a nie stałą kanonu marketingowego.
 */
import { headers } from "next/headers";

import { originFromHost } from "@/lib/seo/origin";

export async function tenantOrigin(): Promise<string | null> {
  const requestHeaders = await headers();
  return originFromHost(requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
}

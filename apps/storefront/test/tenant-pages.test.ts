/**
 * REJESTR ADRESÓW STRON NAJEMCY — cache i parsowanie (Faza 2, ADR-158).
 *
 * SONDA BEZPIECZEŃSTWA. Klucz cache'u bez tożsamości najemcy oddaje CUDZY
 * rejestr, a wtedy adres `/cennik` najemcy A zaczyna się rozstrzygać na hoście
 * najemcy B. Bramka RLS tego nie złapie: rejestr jest czytany funkcją SECURITY
 * DEFINER, poza RLS-em, a wyciek dzieje się w warstwie, do której baza nie
 * sięga. Dlatego klucz jest tu przypięty testem, a nie komentarzem.
 *
 * PARSOWANIE jest fail-closed co do kształtu i TOLERANCYJNE co do nadmiaru —
 * odwrotnie niż koperta strony (`.strict()`). Powód jest asymetryczny: kopertę
 * strony czyta trasa, więc jej porażka gasi jedną stronę; rejestr czyta proxy
 * na KAŻDE żądanie sklepu, więc jego porażka gasiłaby sklep w całości. Koperta
 * rozszerza się w 0075 o wypełnione `redirects`, a migracja wchodzi na produkcję
 * PRZED kodem.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  PAGES_NEGATIVE_TTL_SECONDS,
  PAGES_TTL_SECONDS,
  __resetTenantPagesCacheForTests,
  getCachedTenantPages,
  parseRegistry,
  resolveTenantPages,
  setCachedTenantPages,
  tenantPagesCacheKey,
  type TenantPageRegistry,
} from "../lib/tenant/pages";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => {
  __resetTenantPagesCacheForTests();
});

describe("klucz cache'u niesie tożsamość najemcy", () => {
  it("dwa różne najemcy dają dwa różne klucze", () => {
    expect(tenantPagesCacheKey(TENANT_A)).not.toBe(tenantPagesCacheKey(TENANT_B));
  });

  it("klucz ZAWIERA identyfikator najemcy — inaczej trafienie oddaje cudzy rejestr", () => {
    expect(tenantPagesCacheKey(TENANT_A)).toContain(TENANT_A);
  });

  it("rejestr zapisany dla A nie jest widoczny pod B", async () => {
    await setCachedTenantPages(TENANT_A, { pages: ["kontakt"], redirects: [] }, 60);
    expect(await getCachedTenantPages(TENANT_B), "cache przeciekł między najemcami").toBeUndefined();
    expect((await getCachedTenantPages(TENANT_A))?.entry?.pages).toEqual(["kontakt"]);
  });

  it("odczyt najemcy B NIE trafia we wpis najemcy A — pełny tor przez resolveTenantPages", async () => {
    const zapytani: string[] = [];
    const deps = {
      getCache: getCachedTenantPages,
      setCache: setCachedTenantPages,
      lookup: async (tenantId: string): Promise<TenantPageRegistry> => {
        zapytani.push(tenantId);
        return tenantId === TENANT_A
          ? { pages: ["", "kontakt"], redirects: [] }
          : { pages: [""], redirects: [] };
      },
    };

    const a = await resolveTenantPages(TENANT_A, deps);
    const b = await resolveTenantPages(TENANT_B, deps);

    expect(a?.pages).toEqual(["", "kontakt"]);
    expect(b?.pages, "najemca B dostał rejestr najemcy A").toEqual([""]);
    expect(zapytani, "drugi najemca nie doszedł do bazy — trafił w cudzy wpis").toEqual([
      TENANT_A,
      TENANT_B,
    ]);
  });
});

describe("cache: trafienie, pudło i zapamiętana nieobecność", () => {
  it("drugi odczyt tego samego najemcy nie rusza bazy", async () => {
    let zapytan = 0;
    const deps = {
      getCache: getCachedTenantPages,
      setCache: setCachedTenantPages,
      lookup: async (): Promise<TenantPageRegistry> => {
        zapytan += 1;
        return { pages: [""], redirects: [] };
      },
    };
    await resolveTenantPages(TENANT_A, deps);
    await resolveTenantPages(TENANT_A, deps);
    expect(zapytan).toBe(1);
  });

  it("brak najemcy jest ZAPAMIĘTYWANY z krótkim TTL, żeby nie dobijać bazy", async () => {
    const ttl: number[] = [];
    const deps = {
      getCache: getCachedTenantPages,
      setCache: async (tenantId: string, entry: TenantPageRegistry | null, seconds: number) => {
        ttl.push(seconds);
        await setCachedTenantPages(tenantId, entry, seconds);
      },
      lookup: async (): Promise<TenantPageRegistry | null> => null,
    };
    expect(await resolveTenantPages(TENANT_A, deps)).toBeNull();
    // Drugi odczyt idzie z cache'u negatywnego, nie z bazy.
    expect(await resolveTenantPages(TENANT_A, deps)).toBeNull();
    expect(ttl).toEqual([PAGES_NEGATIVE_TTL_SECONDS]);
    expect(PAGES_NEGATIVE_TTL_SECONDS).toBeLessThan(PAGES_TTL_SECONDS);
  });
});

describe("parsowanie koperty rejestru", () => {
  it("czyta adresy i przekierowania", () => {
    expect(
      parseRegistry({ pages: ["", "kontakt"], redirects: [{ from: "stary", to: "kontakt" }] }),
    ).toEqual({ pages: ["", "kontakt"], redirects: [{ from: "stary", to: "kontakt" }] });
  });

  it("NIEZNANY klucz nie wywraca rejestru — proxy czyta go na każde żądanie", () => {
    expect(parseRegistry({ pages: ["kontakt"], redirects: [], cosNowego: 1 })).toEqual({
      pages: ["kontakt"],
      redirects: [],
    });
  });

  it("brak klucza `redirects` degraduje się do pustej listy (okno wdrożeniowe)", () => {
    expect(parseRegistry({ pages: [""] })).toEqual({ pages: [""], redirects: [] });
  });

  it("kształt bez `pages` → null, czyli proxy zachowa się jak przy braku stron", () => {
    for (const zly of [null, undefined, 42, "kontakt", {}, { pages: "kontakt" }]) {
      expect(parseRegistry(zly), `kształt ${JSON.stringify(zly)} przeszedł`).toBeNull();
    }
  });

  it("wpisy w złym kształcie są POMIJANE, a reszta zostaje", () => {
    expect(
      parseRegistry({
        pages: ["kontakt", 7, null],
        redirects: [{ from: "stary", to: "kontakt" }, { from: 1 }, "nie-obiekt"],
      }),
    ).toEqual({ pages: ["kontakt"], redirects: [{ from: "stary", to: "kontakt" }] });
  });
});

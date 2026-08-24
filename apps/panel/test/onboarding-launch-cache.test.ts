/**
 * CACHE SYGNAŁÓW URUCHOMIENIA per-tenant (ADR-261).
 *
 * Dług perf z ADR-228/229: `readLaunchGuideState` → `fetchLaunchSignals` robił
 * JEDENAŚCIE zapytań (6 karty startowej + 5 dołożonych) na KAŻDYM renderze
 * layoutu panelu — także dla najemcy po ukończeniu onboardingu, na zawsze.
 * `readCachedLaunchSignals` owija ten odczyt w `unstable_cache` z tagiem
 * `launch:<tenantId>`, więc drugi render trafia w cache (ZERO zapytań), a świeże
 * zapytania idą dopiero po `revalidateTag` z mutacji (albo po TTL).
 *
 * DOWODY (procedura recenzji):
 *   1. drugi odczyt ukończonego najemcy NIE odpala zapytań (licznik `from`=0),
 *      po `revalidateLaunchSignals` odpala znów — usunięcie tagu w produkcji
 *      (albo złego tagu) pali ten test;
 *   2. IZOLACJA per-tenant: klucz/tag niosą `tenantId`, więc unieważnienie A nie
 *      rusza B, a sygnały A nie wyciekają do B nawet czytane klientem B.
 *
 * next/cache jest zamockowane WIERNIE (mapa keszu po `keyParts`, `revalidateTag`
 * kasuje wpisy z tagiem) — tak jak reszta suity panelu mockuje next/cache. Licznik
 * `from` mierzy realny koszt: `unstable_cache` przy trafieniu w OGÓLE nie woła
 * domknięcia, więc `supabase.from` nie pada ani razu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const cacheStore = vi.hoisted(
  () => new Map<string, { value: unknown; tags: readonly string[] }>(),
);

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    keyParts: string[] = [],
    opts: { tags?: string[]; revalidate?: number | false } = {},
  ) => {
    const key = JSON.stringify(keyParts);
    return async (...args: unknown[]) => {
      const hit = cacheStore.get(key);
      if (hit) return hit.value;
      const value = await fn(...args);
      cacheStore.set(key, { value, tags: opts.tags ?? [] });
      return value;
    };
  },
  // Sygnatura Next 16: revalidateTag(tag, profile). Mock ignoruje profil.
  revalidateTag: (tag: string) => {
    for (const [key, entry] of cacheStore) {
      if (entry.tags.includes(tag)) cacheStore.delete(key);
    }
  },
  revalidatePath: () => undefined,
}));

const { readCachedLaunchSignals, revalidateLaunchSignals, launchCacheTag } = await import(
  "@/lib/onboarding/launch"
);

type CannedResult = { data?: unknown; count?: number; error?: unknown };

/** Kompletny zestaw wyników — jeden wiersz na tabelę, ukończony najemca (7/7). */
function completeTables(productName = "Rower gravel"): Record<string, CannedResult> {
  return {
    products: { data: { name: productName }, count: 2, error: null },
    product_units: { count: 3, error: null },
    sites: { data: { published_at: "2026-08-01T10:00:00Z" }, error: null },
    tenant_settings: {
      data: [
        { key: "contract_document", value: {} },
        { key: "email_sender", value: {} },
        { key: "delivery_pricing", value: { courier: { price_grosze: 1500 } } },
      ],
      error: null,
    },
    payment_accounts: { data: { charges_enabled: true }, error: null },
    orders: { count: 5, error: null },
    legal_documents: {
      data: [
        { kind: "terms", current_version_id: "v-terms" },
        { kind: "privacy", current_version_id: "v-privacy" },
      ],
      error: null,
    },
    pickup_locations: { count: 1, error: null },
    domains: { data: { id: "dom-1" }, error: null },
  };
}

/** Chainowalny fałszywy builder — terminal maybeSingle ORAZ thenable (count/list). */
function fakeTable(result: CannedResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "not", "order", "limit", "schema", "rpc"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  chain.then = (resolve: (v: CannedResult) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** Fałszywy Supabase liczący wywołania `from` = liczbę zapytań odczytu sygnałów. */
function spySupabase(byTable: Record<string, CannedResult> = completeTables()) {
  let fromCalls = 0;
  const client = {
    from: (table: string) => {
      fromCalls += 1;
      return fakeTable(byTable[table] ?? { data: [], error: null });
    },
  } as unknown as SupabaseClient;
  return {
    client,
    get fromCalls() {
      return fromCalls;
    },
    reset() {
      fromCalls = 0;
    },
  };
}

/** Jedenaście zapytań: 6 karty startowej + 5 dołożonych (ADR-228/229). */
const QUERIES_PER_READ = 11;

afterEach(() => cacheStore.clear());

describe("cache sygnałów uruchomienia (ADR-261)", () => {
  it("liczy DOKŁADNIE 11 zapytań na zimnym odczycie (koszt zdejmowany z każdego renderu)", async () => {
    const spy = spySupabase();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    expect(spy.fromCalls).toBe(QUERIES_PER_READ);
  });

  it("drugi odczyt tego samego najemcy trafia w cache — ZERO zapytań", async () => {
    const spy = spySupabase();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    expect(spy.fromCalls).toBe(QUERIES_PER_READ);

    spy.reset();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    expect(spy.fromCalls).toBe(0);
  });

  it("po revalidateLaunchSignals cache jest zbity — kolejny odczyt znów odpala 11 zapytań", async () => {
    const spy = spySupabase();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    await readCachedLaunchSignals(spy.client, "tenant-A"); // trafienie
    spy.reset();

    // Korelacja: to wołają mutacje zmieniające sygnał. Gdyby emitowały ZŁY tag
    // (albo żaden), wpis „tenant-A" przetrwałby i licznik zostałby 0 — RED.
    revalidateLaunchSignals("tenant-A");
    await readCachedLaunchSignals(spy.client, "tenant-A");
    expect(spy.fromCalls).toBe(QUERIES_PER_READ);
  });

  it("tag jest per-tenant i NIGDY globalny (nośnik tenant_id)", () => {
    expect(launchCacheTag("t1")).toBe("launch:t1");
    expect(launchCacheTag("a")).not.toBe(launchCacheTag("b"));
  });
});

describe("izolacja per-tenant — sygnały A nie wyciekają do B", () => {
  it("każdy najemca ma ROZŁĄCZNY wpis: odczyt B nie jest karmiony z cache A", async () => {
    const spy = spySupabase();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    spy.reset();

    // Klucz B jest inny niż A → PUDŁO, mimo że A już w cache.
    await readCachedLaunchSignals(spy.client, "tenant-B");
    expect(spy.fromCalls).toBe(QUERIES_PER_READ);
  });

  it("unieważnienie A NIE rusza wpisu B", async () => {
    const spy = spySupabase();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    await readCachedLaunchSignals(spy.client, "tenant-B");
    spy.reset();

    revalidateLaunchSignals("tenant-A");

    // B dalej trafia w cache (0), A trzeba przeliczyć (11).
    await readCachedLaunchSignals(spy.client, "tenant-B");
    expect(spy.fromCalls).toBe(0);
    spy.reset();
    await readCachedLaunchSignals(spy.client, "tenant-A");
    expect(spy.fromCalls).toBe(QUERIES_PER_READ);
  });

  it("wartości NIE mieszają się: A czytane nawet klientem B oddaje sygnały A", async () => {
    const spyA = spySupabase(completeTables("Produkt-A"));
    const spyB = spySupabase(completeTables("Produkt-B"));

    const a1 = await readCachedLaunchSignals(spyA.client, "tenant-A");
    const b1 = await readCachedLaunchSignals(spyB.client, "tenant-B");
    expect(a1.firstProductName).toBe("Produkt-A");
    expect(b1.firstProductName).toBe("Produkt-B");

    // Klucz = "tenant-A" → trafienie w cache A, choć klient jest B. Gdyby cache
    // był współdzielony/globalny, wróciłyby sygnały B — to byłby wyciek.
    const a2 = await readCachedLaunchSignals(spyB.client, "tenant-A");
    expect(a2.firstProductName).toBe("Produkt-A");
    expect(spyB.fromCalls).toBe(QUERIES_PER_READ); // tylko odczyt B; A z cache
  });
});

/**
 * Config-first hub „Uruchomienie" (ADR-228) — MODEL faz/kroków, DETEKCJA
 * dołożonych sygnałów i SOFT-GATE publikacji.
 *
 * Trzy kontrakty w jednym pliku, bo dzielą jedno źródło sygnałów:
 *   1. MODEL (`launchSteps`/`launchProgress`/`isLaunchComplete`) — porządek
 *      config-first, kroki wymagane vs opcjonalne, ukończenie po komplecie
 *      WYMAGANYCH.
 *   2. DETEKCJA (`fetchLaunchExtraSignals`) — legalia liczone jak checkout
 *      (`legalGateOpen`: oba dokumenty opublikowane), dostawa jak storefront
 *      (aktywny punkt odbioru LUB skonfigurowana metoda płatna).
 *   3. SOFT-GATE (`publishGateBlockers`) — minimum sprzedażowe. Dowód
 *      mutacyjny na warunku dostawy niżej.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  fetchLaunchExtraSignals,
  firstOpenRequiredKey,
  isLaunchComplete,
  isPublishGateOpen,
  launchProgress,
  launchSteps,
  publishGateBlockers,
  publishGateSignals,
  type LaunchSignals,
} from "@/lib/onboarding/launch";

/** Świeży tenant — nic nie zrobione poza „Dane organizacji" (seed, zawsze ✓). */
function freshSignals(overrides: Partial<LaunchSignals> = {}): LaunchSignals {
  return {
    firstProductName: null,
    unitCount: 0,
    publishedAt: null,
    hasContractDocument: false,
    hasEmailSender: false,
    chargesEnabled: false,
    ordersCount: 0,
    legalReady: false,
    hasDelivery: false,
    activeProductCount: 0,
    customDomainReady: false,
    ...overrides,
  };
}

/** Wszystkie WYMAGANE kroki zrobione — hub znika. */
function completeSignals(): LaunchSignals {
  return freshSignals({
    firstProductName: "Rower gravel",
    unitCount: 2,
    publishedAt: "2026-08-01T10:00:00Z",
    hasContractDocument: true,
    hasEmailSender: true,
    legalReady: true,
    hasDelivery: true,
    activeProductCount: 2,
  });
}

describe("model huba — porządek config-first i wymagane vs opcjonalne", () => {
  it("kolejność faz: firma/zgodność → logistyka → oferta → uruchomienie", () => {
    const steps = launchSteps(freshSignals());
    expect(steps.map((step) => step.key)).toEqual([
      "organization",
      "legal",
      "contract",
      "emails",
      "delivery",
      "payments",
      "domain",
      "product",
      "appearance",
    ]);
    expect(steps.map((step) => step.phase)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 4]);
  });

  it("płatności i domena są OPCJONALNE — nie liczą się do pierścienia (total = 7)", () => {
    const steps = launchSteps(freshSignals());
    const optional = steps.filter((step) => step.optional).map((step) => step.key);
    expect(optional).toEqual(["payments", "domain"]);
    // Świeży tenant: „Dane organizacji" ✓ z seedu, reszta wymaganych otwarta.
    expect(launchProgress(steps)).toEqual({ done: 1, total: 7 });
  });

  it("regulamin i polityka to BRAMKA sprzedaży (wyróżnienie gate) i pierwszy otwarty krok", () => {
    const steps = launchSteps(freshSignals());
    const legal = steps.find((step) => step.key === "legal");
    expect(legal?.gate).toBe(true);
    expect(legal?.required).toBe(true);
    // „Dane organizacji" zawsze zrobione, więc pierwszy otwarty WYMAGANY = legal.
    expect(firstOpenRequiredKey(steps)).toBe("legal");
  });

  it("stan częściowy: dokładnie te kroki, o których mówią sygnały (reużyty startSteps)", () => {
    const steps = launchSteps(
      freshSignals({
        legalReady: true,
        hasContractDocument: true,
        hasEmailSender: true,
        hasDelivery: true,
      }),
    );
    const done = Object.fromEntries(steps.map((step) => [step.key, step.done]));
    expect(done).toMatchObject({
      organization: true,
      legal: true,
      contract: true,
      emails: true,
      delivery: true,
      product: false,
      appearance: false,
    });
    expect(launchProgress(steps)).toEqual({ done: 5, total: 7 });
    expect(isLaunchComplete(steps)).toBe(false);
  });

  it("krok Wygląd/uruchomienie domyka się PUBLIKACJĄ strony głównej (sygnał store)", () => {
    const notPublished = launchSteps(freshSignals());
    const published = launchSteps(freshSignals({ publishedAt: "2026-08-01T10:00:00Z" }));
    const key = (steps: ReturnType<typeof launchSteps>) =>
      steps.find((step) => step.key === "appearance")?.done;
    expect(key(notPublished)).toBe(false);
    expect(key(published)).toBe(true);
  });

  it("komplet WYMAGANYCH → isLaunchComplete (hub znika), mimo opcjonalnych nie ruszonych", () => {
    const steps = launchSteps(completeSignals());
    expect(isLaunchComplete(steps)).toBe(true);
    expect(launchProgress(steps)).toEqual({ done: 7, total: 7 });
    // Opcjonalne dalej otwarte — ale nie blokują ukończenia.
    expect(steps.find((step) => step.key === "payments")?.done).toBe(false);
  });
});

describe("soft-gate publikacji — minimum sprzedażowe", () => {
  const open = { legalReady: true, hasActiveProduct: true, hasDelivery: true };

  it("komplet minimum → bramka OTWARTA, zero braków", () => {
    expect(publishGateBlockers(open)).toEqual([]);
    expect(isPublishGateOpen(open)).toBe(true);
  });

  it("brak legaliów → bramka zamknięta, brak nazwany", () => {
    const blockers = publishGateBlockers({ ...open, legalReady: false });
    expect(blockers).toContain("legal");
    expect(isPublishGateOpen({ ...open, legalReady: false })).toBe(false);
  });

  it("brak produktu AKTYWNEGO → bramka zamknięta", () => {
    const blockers = publishGateBlockers({ ...open, hasActiveProduct: false });
    expect(blockers).toContain("product");
    expect(isPublishGateOpen({ ...open, hasActiveProduct: false })).toBe(false);
  });

  /**
   * DOWÓD MUTACYJNY (procedura recenzji). Ten przypadek PILNUJE warunku
   * dostawy w soft-gate: usunięcie `if (!signals.hasDelivery) push("delivery")`
   * z `publishGateBlockers` (lib/onboarding/launch.ts) sprawia, że dla sklepu
   * bez dostawy bramka błędnie się OTWIERA — i wtedy oba `expect` niżej robią
   * się RED. Przywrócenie warunku → zielony.
   */
  it("gate ZAMKNIĘTY bez dostawy (dowód mutacyjny na warunku dostawy)", () => {
    const noDelivery = { legalReady: true, hasActiveProduct: true, hasDelivery: false };
    expect(publishGateBlockers(noDelivery)).toContain("delivery");
    expect(isPublishGateOpen(noDelivery)).toBe(false);
  });

  it("kolejność braków w liście: legalia · produkt · dostawa (tak jak w UI)", () => {
    expect(
      publishGateBlockers({ legalReady: false, hasActiveProduct: false, hasDelivery: false }),
    ).toEqual(["legal", "product", "delivery"]);
  });

  it("`publishGateSignals` mapuje activeProductCount>0 na produkt sprzedawalny", () => {
    expect(publishGateSignals(freshSignals({ activeProductCount: 0 })).hasActiveProduct).toBe(false);
    expect(publishGateSignals(freshSignals({ activeProductCount: 3 })).hasActiveProduct).toBe(true);
  });
});

// ================== DETEKCJA (fałszywy klient PostgREST) ==================

type CannedResult = { data?: unknown; count?: number; error?: unknown };

/** Chainowalny fałszywy builder — każda metoda zwraca siebie, terminal = canned. */
function fakeTable(result: CannedResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "not", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => result;
  // Zapytania liczące/listy są awaitowane wprost — builder jest „thenable".
  chain.then = (resolve: (v: CannedResult) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fakeSupabase(byTable: Record<string, CannedResult>): SupabaseClient {
  return {
    from: (table: string) => fakeTable(byTable[table] ?? { data: [], error: null }),
  } as unknown as SupabaseClient;
}

const okDelivery = {
  legal_documents: {
    data: [
      { kind: "terms", current_version_id: "v-terms" },
      { kind: "privacy", current_version_id: "v-privacy" },
    ],
    error: null,
  },
  pickup_locations: { count: 0, error: null },
  tenant_settings: {
    data: [{ key: "delivery_pricing", value: { courier: { price_grosze: 1500 } } }],
    error: null,
  },
  products: { count: 2, error: null },
  domains: { data: { id: "dom-1" }, error: null },
} satisfies Record<string, CannedResult>;

describe("detekcja dołożonych sygnałów (jak checkout / storefront)", () => {
  it("legalReady wymaga OBU dokumentów opublikowanych (jak legalGateOpen)", async () => {
    const both = await fetchLaunchExtraSignals(fakeSupabase(okDelivery), "t");
    expect(both.legalReady).toBe(true);

    const onlyTerms = await fetchLaunchExtraSignals(
      fakeSupabase({
        ...okDelivery,
        legal_documents: {
          data: [{ kind: "terms", current_version_id: "v-terms" }],
          error: null,
        },
      }),
      "t",
    );
    expect(onlyTerms.legalReady).toBe(false);
  });

  it("dokument BEZ current_version_id to szkic — nie opublikowany", async () => {
    const draftPrivacy = await fetchLaunchExtraSignals(
      fakeSupabase({
        ...okDelivery,
        legal_documents: {
          data: [
            { kind: "terms", current_version_id: "v-terms" },
            { kind: "privacy", current_version_id: null },
          ],
          error: null,
        },
      }),
      "t",
    );
    expect(draftPrivacy.legalReady).toBe(false);
  });

  it("dostawa: metoda płatna z cennika ustawia hasDelivery", async () => {
    const signals = await fetchLaunchExtraSignals(fakeSupabase(okDelivery), "t");
    expect(signals.hasDelivery).toBe(true);
  });

  it("dostawa: sam aktywny punkt odbioru (bez cennika) też ustawia hasDelivery", async () => {
    const signals = await fetchLaunchExtraSignals(
      fakeSupabase({
        ...okDelivery,
        pickup_locations: { count: 1, error: null },
        tenant_settings: { data: [], error: null },
      }),
      "t",
    );
    expect(signals.hasDelivery).toBe(true);
  });

  it("dostawa: brak punktów i brak cennika → hasDelivery false", async () => {
    const signals = await fetchLaunchExtraSignals(
      fakeSupabase({
        ...okDelivery,
        pickup_locations: { count: 0, error: null },
        tenant_settings: { data: [], error: null },
      }),
      "t",
    );
    expect(signals.hasDelivery).toBe(false);
  });

  it("activeProductCount i customDomainReady z odczytów", async () => {
    const signals = await fetchLaunchExtraSignals(fakeSupabase(okDelivery), "t");
    expect(signals.activeProductCount).toBe(2);
    expect(signals.customDomainReady).toBe(true);

    const noDomain = await fetchLaunchExtraSignals(
      fakeSupabase({ ...okDelivery, domains: { data: null, error: null } }),
      "t",
    );
    expect(noDomain.customDomainReady).toBe(false);
  });

  it("błąd transportu RZUCA (fałszywe zrobione to zmyślony stan konta)", async () => {
    await expect(
      fetchLaunchExtraSignals(
        fakeSupabase({ ...okDelivery, legal_documents: { error: { message: "boom" } } }),
        "t",
      ),
    ).rejects.toThrow(/legal_documents/);
  });
});

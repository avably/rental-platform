/**
 * MODEL karty startowej (UX1, ADR-140) — czyste funkcje `startSteps` /
 * `isStartComplete`: stan każdego kroku wynika WYŁĄCZNIE z danych (świeży
 * tenant 0/6 → wszystko otwarte; częściowy — dokładnie te kroki, które mówią
 * sygnały; komplet → isStartComplete). Zero odhaczania ręcznie.
 *
 * Od ADR-228 render karty przeniósł się do dedykowanego huba `/uruchomienie`
 * (test w `launch-hub.test.tsx`), a na pulpicie został kompaktowy baner
 * (`dashboard-launch-banner` — test tamże). Ten plik pilnuje już WYŁĄCZNIE
 * modelu sygnałów, który REUŻYWA hub (`lib/onboarding/launch.ts`): dopóki
 * `startSteps` jest jednym źródłem prawdy o produkcie/stronie/umowie/e-mailach/
 * płatnościach, jego regresja pali TU, zanim dojdzie do huba.
 */
import { describe, expect, it } from "vitest";

import type { StartCardSignals } from "@/lib/dashboard/start-card";
import { START_STEP_KEYS, isStartComplete, startSteps } from "@/lib/dashboard/start-card";

/** Sygnały świeżego tenanta — dzień zero, nic nie zrobione. */
function freshSignals(overrides: Partial<StartCardSignals> = {}): StartCardSignals {
  return {
    firstProductName: null,
    unitCount: 0,
    publishedAt: null,
    hasContractDocument: false,
    hasEmailSender: false,
    chargesEnabled: false,
    ordersCount: 0,
    ...overrides,
  };
}

describe("model stanów kroków (liczony z danych, nie odhaczany)", () => {
  it("świeży tenant: 0 z 6, kolejność kroków ze spec-u (zamówienie ZAMYKA listę)", () => {
    const steps = startSteps(freshSignals());

    expect(steps.map((step) => step.key)).toEqual([...START_STEP_KEYS]);
    expect(steps.map((step) => step.key)).toEqual([
      "product",
      "store",
      "contract",
      "emails",
      "payments",
      "firstOrder",
    ]);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(isStartComplete(steps)).toBe(false);
  });

  it("stan częściowy: dokładnie te kroki, o których mówią dane", () => {
    const steps = startSteps(
      freshSignals({
        firstProductName: "Rower gravel (rama M)",
        unitCount: 3,
        publishedAt: "2026-08-01T10:00:00Z",
        hasContractDocument: true,
        hasEmailSender: true,
      }),
    );

    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["product", true],
      ["store", true],
      ["contract", true],
      ["emails", true],
      ["payments", false],
      ["firstOrder", false],
    ]);
    expect(isStartComplete(steps)).toBe(false);
  });

  it("produkt BEZ egzemplarza to krok NIEzrobiony (bez egzemplarza nie ma dostępności)", () => {
    const steps = startSteps(freshSignals({ firstProductName: "Rower", unitCount: 0 }));
    expect(steps[0]).toEqual({ key: "product", done: false });
  });

  it("płatności liczą się dopiero od charges_enabled (sam wiersz konta to rozpoczęty onboarding)", () => {
    const notEnabled = startSteps(freshSignals({ chargesEnabled: false }));
    const enabled = startSteps(freshSignals({ chargesEnabled: true }));
    expect(notEnabled[4].done).toBe(false);
    expect(enabled[4].done).toBe(true);
  });

  it("komplet 6/6 → isStartComplete", () => {
    const steps = startSteps(
      freshSignals({
        firstProductName: "Rower",
        unitCount: 1,
        publishedAt: "2026-08-01T10:00:00Z",
        hasContractDocument: true,
        hasEmailSender: true,
        chargesEnabled: true,
        ordersCount: 1,
      }),
    );
    expect(steps.every((step) => step.done)).toBe(true);
    expect(isStartComplete(steps)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";

// Bramka budżetów wydajności (ADR-262). Logika pomiaru i porównania mieszka
// w JEDNYM miejscu — scripts/perf-budget-check.mjs — żeby test i CLI liczyły
// TAK SAMO (ten sam wzorzec współdzielenia co bramka numeracji ADR).
import {
  maBuild,
  sprawdzApke,
  wczytajBudzety,
} from "../../../scripts/perf-budget-check.mjs";

const APKA = "panel";
const zBuildem = maBuild(APKA);

if (!zBuildem) {
  // JAWNY komunikat — nie fałszywa zieleń, nie twardy fail bez buildu.
  // Sam test walidacji jest poniżej POMINIĘTY (skipIf), a nie „zielony”.
  console.warn(
    `[perf-budget:${APKA}] brak .next — walidacja budżetów POMINIĘTA. ` +
      "Uruchom `next build` w apps/" +
      APKA +
      " przed `pnpm test`, aby bramka zadziałała.",
  );
}

describe("budżety wydajności — first-load JS per trasa", () => {
  // Waliduje TYLKO gdy jest artefakt `next build`. Bez buildu → pominięte
  // (widoczne jako „skipped”, nie jako sukces).
  it.skipIf(!zBuildem)(
    "każda budżetowana trasa mieści się w budżecie (wymaga next build)",
    () => {
      const wynik = sprawdzApke(APKA);
      expect(
        wynik.stan,
        wynik.problemy.length
          ? `przekroczenia budżetu:\n  ${wynik.problemy.join("\n  ")}`
          : `nieoczekiwany stan bramki: ${wynik.stan}`,
      ).toBe("ok");
    },
  );

  // Ten dowodzi, że przy braku buildu bramka POMIJA (a nie przechodzi walidację
  // po cichu). Uruchamia się tylko gdy buildu NIE ma.
  it.skipIf(zBuildem)(
    "bez next build walidacja jest pomijana z jawnym komunikatem",
    () => {
      expect(zBuildem).toBe(false);
    },
  );

  // Niezależne od buildu — pilnuje samego pliku budżetów (jest w repo).
  it("perf-budgets.json istnieje, pokrywa trasy krytyczne i ma budżet ≥ baseline", () => {
    const budzety = wczytajBudzety(APKA);
    expect(
      budzety,
      "brak apps/" + APKA + "/perf-budgets.json — `node scripts/perf-budget-check.mjs --update`",
    ).not.toBeNull();
    expect(budzety.shared?.budgetBytes).toBeGreaterThanOrEqual(budzety.shared?.baselineBytes ?? 0);

    const trasyKrytyczne = Object.entries(budzety.routes as Record<string, { critical: boolean }>)
      .filter(([, cfg]) => cfg.critical)
      .map(([trasa]) => trasa);
    expect(trasyKrytyczne, "żadna trasa nie jest oznaczona jako krytyczna").not.toHaveLength(0);

    for (const [trasa, cfg] of Object.entries(
      budzety.routes as Record<string, { baselineBytes: number; budgetBytes: number }>,
    )) {
      expect(cfg.budgetBytes, `budżet < baseline dla ${trasa} (fałszywa czerwień)`).toBeGreaterThanOrEqual(
        cfg.baselineBytes,
      );
    }
  });
});

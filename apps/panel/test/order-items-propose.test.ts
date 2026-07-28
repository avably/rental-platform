/**
 * PROPOZYCJA kwot dla nowej pozycji (R1) liczy się z DAT zamówienia i cennika
 * produktu — tym samym silnikiem, co reszta wyceny (ADR-018/022). Test jest
 * czysty (bez bazy), więc chodzi ZAWSZE i pełni rolę wektora dowodu
 * mutacyjnego: gdy `proposeItemAmounts` przestanie liczyć z dat (np.
 * `false && …` przed silnikiem i stały zwrot), asercja „dłuższy najem = wyższa
 * propozycja" pada natychmiast.
 */
import { calculatePrice, type IsoDate } from "@avably/core";
import { describe, expect, it } from "vitest";

import { proposeItemAmounts } from "@/app/[locale]/(panel)/zamowienia/pricing";
import type { ProductPricingRow } from "@/app/[locale]/(panel)/zamowienia/pricing";

const HEATER: ProductPricingRow = {
  id: "00000000-0000-4000-8000-0000000000c1",
  base_price_day_grosze: 10_000,
  deposit_grosze: 5_000,
  auto_increment_multiplier: 1.0,
  buffer_before_days: 0,
  buffer_after_days: 0,
  pricing_tiers: [],
};

const SHORT = { start: "2027-05-10" as IsoDate, end: "2027-05-12" as IsoDate };
const LONG = { start: "2027-05-10" as IsoDate, end: "2027-05-20" as IsoDate };

describe("proposeItemAmounts — propozycja z dat i cennika", () => {
  it("zwraca DOKŁADNIE to, co silnik wyceny dla tego terminu", () => {
    const proposal = proposeItemAmounts(HEATER, SHORT.start, SHORT.end);
    const engine = calculatePrice(SHORT.start, SHORT.end, {
      basePriceDayGrosze: HEATER.base_price_day_grosze,
      depositGrosze: HEATER.deposit_grosze,
      autoIncrementMultiplier: HEATER.auto_increment_multiplier,
      tiers: [],
    });

    // Tożsamość z silnikiem — żadnej drugiej ścieżki wyceny.
    expect(proposal.rentalGrosze).toBe(engine.rentalGrosze);
    expect(proposal.depositGrosze).toBe(engine.depositGrosze);
  });

  it("dłuższy zakres dat daje WYŻSZY najem (propozycja liczy się z dat)", () => {
    const shortProposal = proposeItemAmounts(HEATER, SHORT.start, SHORT.end);
    const longProposal = proposeItemAmounts(HEATER, LONG.start, LONG.end);

    // Gdyby propozycja była stała (wyłączone przeliczanie z dat), te dwie
    // wartości byłyby równe — i to jest cała pointa tej asercji.
    expect(longProposal.rentalGrosze).toBeGreaterThan(shortProposal.rentalGrosze);
    // Kaucja jest cechą produktu, nie terminu — stała między zakresami.
    expect(longProposal.depositGrosze).toBe(shortProposal.depositGrosze);
  });
});

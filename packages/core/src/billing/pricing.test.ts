/**
 * Bramka cennika SaaS (ADR-135) — kwoty są decyzją właściciela (2026-08-08),
 * nie parametrem implementacji. Zmiana któregokolwiek pola bez zmiany decyzji
 * to zmiana ceny produktu po cichu — dokładnie to, co ta suita ma łapać
 * (lustro bramki LP: apps/storefront/test/marketing-template.test.ts).
 */
import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_API_VERSION,
  SAAS_BOOTSTRAP_PLANS,
} from "../../../../scripts/stripe-billing-bootstrap.mjs";
import { STRIPE_BILLING_API_VERSION } from "../stripe/billing";
import {
  SAAS_PLAN_PRICING,
  SAAS_TRIAL_DAYS,
  SAAS_YEARLY_MONTHS_CHARGED,
} from "./pricing";

describe("cennik SaaS — decyzja właściciela", () => {
  it("Standard 199 zł netto/mies., Premium 399 zł netto/mies.", () => {
    expect(SAAS_PLAN_PRICING.map((p) => [p.id, p.monthlyNetGrosze])).toEqual([
      ["standard", 19900],
      ["premium", 39900],
    ]);
  });

  it("rok z góry = dokładnie dziesięć rat miesięcznych (obietnica: rok w cenie dziesięciu miesięcy)", () => {
    expect(SAAS_YEARLY_MONTHS_CHARGED).toBe(10);
    for (const plan of SAAS_PLAN_PRICING) {
      expect(plan.yearlyNetGrosze, plan.id).toBe(plan.monthlyNetGrosze * SAAS_YEARLY_MONTHS_CHARGED);
    }
  });

  it("trial 14 dni — lustro zegara z migracji 0066", () => {
    expect(SAAS_TRIAL_DAYS).toBe(14);
  });

  it("kwoty są w groszach jako liczby całkowite", () => {
    for (const plan of SAAS_PLAN_PRICING) {
      expect(Number.isInteger(plan.monthlyNetGrosze), plan.id).toBe(true);
      expect(Number.isInteger(plan.yearlyNetGrosze), plan.id).toBe(true);
    }
  });
});

/**
 * PARYTET BOOTSTRAPU (ADR-136): skrypt scripts/stripe-billing-bootstrap.mjs
 * tworzy ceny NA KONCIE dostawcy — to one realnie obciążają kartę. Skrypt
 * jest .mjs (Node bez transpilacji), więc nie może importować tej stałej;
 * rozjazd kwot łapie ten test, nie klient przy checkoutcie.
 */
describe("parytet bootstrapu Stripe ze stałą cennika", () => {
  it("plany i kwoty bootstrapu = SAAS_PLAN_PRICING co do grosza", () => {
    expect(
      SAAS_BOOTSTRAP_PLANS.map((p) => [p.id, p.monthlyNetGrosze, p.yearlyNetGrosze]),
    ).toEqual(SAAS_PLAN_PRICING.map((p) => [p.id, p.monthlyNetGrosze, p.yearlyNetGrosze]));
  });

  it("bootstrap przypina tę samą wersję API co port billingu (W8)", () => {
    expect(BOOTSTRAP_API_VERSION).toBe(STRIPE_BILLING_API_VERSION);
  });
});

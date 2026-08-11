/**
 * Maszyna stanów billingu SaaS (ADR-136) — lustro TS tablicy przejść z 0067.
 *
 * Test TABELARYCZNY na PEŁNEJ macierzy statusów dostawcy: każda wartość
 * słownika ma jawnie zapisany cel — dopisanie statusu do słownika bez
 * decyzji o mapowaniu pali build, nie klienta. Pętle własne są normą
 * (zasada 6): mapowanie jest czystą funkcją stanu, więc „przejście w to
 * samo" niczym nie różni się od pierwszego — dowodem sam kształt funkcji,
 * ale przypinamy to też wprost, żeby regres na diff-logikę był czerwony.
 */
import { describe, expect, it } from "vitest";

import {
  LIVE_SAAS_SUBSCRIPTION_STATUSES,
  OBSERVED_SAAS_BILLING_EVENTS,
  SAAS_SUBSCRIPTION_STATUSES,
  isLiveSaasSubscriptionStatus,
  isObservedSaasBillingEvent,
  mapSaasSubscriptionToTenantStatus,
  planFromPriceLookupKey,
  saasPriceLookupKey,
} from "./billing-state";

describe("mapSaasSubscriptionToTenantStatus — pełna macierz", () => {
  const EXPECTED: Record<(typeof SAAS_SUBSCRIPTION_STATUSES)[number], string | null> = {
    trialing: "active",
    active: "active",
    past_due: "past_due",
    unpaid: "suspended",
    canceled: null,
    incomplete: null,
    incomplete_expired: null,
    paused: null,
  };

  it.each(SAAS_SUBSCRIPTION_STATUSES)("%s → cel z tablicy przejść", (status) => {
    expect(mapSaasSubscriptionToTenantStatus(status)).toBe(EXPECTED[status]);
  });

  it("KAŻDY status słownika ma jawną decyzję — nowy status bez wpisu pali test", () => {
    for (const status of SAAS_SUBSCRIPTION_STATUSES) {
      expect(EXPECTED).toHaveProperty(status);
    }
  });

  it("status spoza słownika → null (o odmowie zapisu decyduje CHECK w bazie, głośno)", () => {
    expect(mapSaasSubscriptionToTenantStatus("nieznany")).toBeNull();
    expect(mapSaasSubscriptionToTenantStatus("")).toBeNull();
  });

  it("pętla własna: mapowanie jest funkcją stanu, nie diffem — dwa wywołania, ten sam wynik", () => {
    expect(mapSaasSubscriptionToTenantStatus("active")).toBe("active");
    expect(mapSaasSubscriptionToTenantStatus("active")).toBe("active");
    expect(mapSaasSubscriptionToTenantStatus("past_due")).toBe("past_due");
    expect(mapSaasSubscriptionToTenantStatus("past_due")).toBe("past_due");
  });
});

describe("LIVE_SAAS_SUBSCRIPTION_STATUSES — bramka jednej subskrypcji (W6)", () => {
  it("żywe: trialing/active/past_due/unpaid/paused; martwe: canceled/incomplete/incomplete_expired", () => {
    expect([...LIVE_SAAS_SUBSCRIPTION_STATUSES].sort()).toEqual(
      ["active", "past_due", "paused", "trialing", "unpaid"].sort(),
    );
    expect(isLiveSaasSubscriptionStatus("unpaid")).toBe(true);
    expect(isLiveSaasSubscriptionStatus("canceled")).toBe(false);
    expect(isLiveSaasSubscriptionStatus("incomplete")).toBe(false);
    expect(isLiveSaasSubscriptionStatus("incomplete_expired")).toBe(false);
  });

  it("zbiór żywych jest podzbiorem słownika CHECK-a", () => {
    for (const status of LIVE_SAAS_SUBSCRIPTION_STATUSES) {
      expect(SAAS_SUBSCRIPTION_STATUSES).toContain(status);
    }
  });
});

describe("lookup_key — konwencja saas_<plan>_<interwał>, mapowanie DWUSTRONNE", () => {
  it("buduje i odwraca każdy legalny klucz", () => {
    for (const planId of ["standard", "premium"] as const) {
      for (const interval of ["monthly", "yearly"] as const) {
        const key = saasPriceLookupKey(planId, interval);
        expect(key).toBe(`saas_${planId}_${interval}`);
        expect(planFromPriceLookupKey(key)).toEqual({ planId, interval });
      }
    }
  });

  it("nieznany klucz → null (nigdy zgadywanie planu)", () => {
    expect(planFromPriceLookupKey(null)).toBeNull();
    expect(planFromPriceLookupKey("")).toBeNull();
    expect(planFromPriceLookupKey("saas_max_monthly")).toBeNull();
    expect(planFromPriceLookupKey("saas_standard_weekly")).toBeNull();
    expect(planFromPriceLookupKey("standard_monthly")).toBeNull();
  });
});

describe("OBSERVED_SAAS_BILLING_EVENTS", () => {
  it("dokładnie sześć zdarzeń budzika — checkout, cykl subskrypcji, faktury", () => {
    expect([...OBSERVED_SAAS_BILLING_EVENTS].sort()).toEqual(
      [
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.deleted",
        "customer.subscription.updated",
        "invoice.paid",
        "invoice.payment_failed",
      ].sort(),
    );
    expect(isObservedSaasBillingEvent("invoice.paid")).toBe(true);
    expect(isObservedSaasBillingEvent("payment_intent.succeeded")).toBe(false);
  });
});

/**
 * Walidacja wejść akcji modelu sekcyjnego (lib/site-validation.ts, ADR-041).
 * Kształt treści sekcji dowodzi @avably/core (packages/core/src/site/site.test.ts)
 * — tu testujemy otoczkę akcji: spójność (type, content), plan reorderu.
 */
import { describe, expect, it } from "vitest";

import {
  reorderPlan,
  reorderSectionsInputSchema,
  updateTemplateInputSchema,
  upsertSectionInputSchema,
} from "../lib/site-validation";

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("upsertSectionInputSchema", () => {
  it("przyjmuje poprawny upsert hero", () => {
    const result = upsertSectionInputSchema.safeParse({
      siteId: uuid(1),
      type: "hero",
      content: { heading: "Wypożycz sprzęt" },
    });
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
  });

  it("odrzuca treść niezgodną z typem sekcji", () => {
    const result = upsertSectionInputSchema.safeParse({
      siteId: uuid(1),
      type: "faq",
      content: { body: "to jest freeform, nie faq" },
    });
    expect(result.success).toBe(false);
  });

  it("odrzuca nieznany typ sekcji i zły uuid", () => {
    expect(
      upsertSectionInputSchema.safeParse({ siteId: uuid(1), type: "banner", content: {} }).success,
    ).toBe(false);
    expect(
      upsertSectionInputSchema.safeParse({ siteId: "nie-uuid", type: "products", content: {} }).success,
    ).toBe(false);
  });
});

describe("updateTemplateInputSchema", () => {
  it("dopuszcza wyłącznie szablony z kontraktu (lustro CHECK-a 0019)", () => {
    expect(updateTemplateInputSchema.safeParse({ siteId: uuid(1), template: "classic" }).success).toBe(true);
    expect(updateTemplateInputSchema.safeParse({ siteId: uuid(1), template: "bold" }).success).toBe(true);
    expect(updateTemplateInputSchema.safeParse({ siteId: uuid(1), template: "neon" }).success).toBe(false);
  });
});

describe("reorderPlan — kolejność jest permutacją kompletu", () => {
  const a = uuid(1);
  const b = uuid(2);
  const c = uuid(3);

  it("nadaje pozycje 0..n-1 wg podanej kolejności", () => {
    const plan = reorderPlan([a, b, c], [c, a, b]);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: c, position: 0 },
        { id: a, position: 1 },
        { id: b, position: 2 },
      ],
    });
  });

  it("odmawia przy pominiętej sekcji (podzbiór = cicha utrata pozycji)", () => {
    expect(reorderPlan([a, b, c], [a, b]).ok).toBe(false);
  });

  it("odmawia przy obcym id (sekcja spoza strony)", () => {
    expect(reorderPlan([a, b], [a, c]).ok).toBe(false);
  });

  it("odmawia przy duplikacie", () => {
    expect(reorderPlan([a, b], [a, a]).ok).toBe(false);
  });

  it("waliduje schematem: pusta lista nie przechodzi", () => {
    expect(reorderSectionsInputSchema.safeParse({ siteId: a, orderedIds: [] }).success).toBe(false);
  });
});

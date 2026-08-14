/**
 * Walidacja formularzy katalogu (lib/catalog-validation.ts): lustra CHECK-ów
 * z 0007 mają odrzucać złe wejście PRZED bazą i z czytelnym komunikatem.
 * Plus getTenantCurrency: waluta tenanta z tenant_settings, fallback PLN.
 */
import { describe, expect, it } from "vitest";

import {
  pickupLocationSchema,
  productSchema,
  tiersSchema,
  unitSchema,
} from "@/lib/catalog-validation";
import { getTenantCurrency } from "@/lib/tenant-currency";

describe("productSchema", () => {
  const valid = {
    name: "Agregat prądotwórczy",
    // Adres pusty = „nadaj z nazwy" (ADR-182) — to jest stan NORMALNY, także
    // przy zapisie z panelu sprzed tej zmiany.
    slug: "",
    description: "",
    basePriceDayGrosze: "100,50",
    depositGrosze: "500",
    autoIncrementMultiplier: "1",
    bufferBeforeDays: "1",
    bufferAfterDays: "2",
    active: "on",
  };

  it("konwertuje kwoty do groszy w jednym przejściu", () => {
    const parsed = productSchema.parse(valid);
    expect(parsed.basePriceDayGrosze).toBe(10050);
    expect(parsed.depositGrosze).toBe(50000);
    expect(parsed.active).toBe(true);
    expect(parsed.description).toBeNull();
  });

  it("cena 0 odrzucona (CHECK base_price_day_grosze > 0), kaucja pusta → 0", () => {
    expect(productSchema.safeParse({ ...valid, basePriceDayGrosze: "0" }).success).toBe(false);
    expect(productSchema.parse({ ...valid, depositGrosze: "" }).depositGrosze).toBe(0);
  });

  it("checkbox nieobecny w FormData → false", () => {
    expect(productSchema.parse({ ...valid, active: undefined }).active).toBe(false);
  });

  // -------------------------------------------------------------------
  // Adres sprzętu (ADR-182) — lustro CHECK-a products_slug_shape
  // -------------------------------------------------------------------
  it("PUSTY adres przechodzi — nadaje go baza z nazwy, nie formularz", () => {
    // To jest warunek działania panelu SPRZED tej zmiany i importu CSV:
    // gdyby pusty adres był błędem, zapis bez tego pola nie miałby jak przejść.
    expect(productSchema.parse({ ...valid, slug: "" }).slug).toBe("");
  });

  it("KONTROLA POZYTYWNA: poprawny adres przechodzi bez zmian", () => {
    expect(productSchema.parse({ ...valid, slug: "rower-gorski" }).slug).toBe("rower-gorski");
  });

  it.each(["Rower", "rower gorski", "rower_2", "rowerą", "-rower", "rower-", "a".repeat(61)])(
    "adres `%s` odrzucony PRZED bazą, z komunikatem przy polu",
    (slug) => {
      const result = productSchema.safeParse({ ...valid, slug });
      expect(result.success, `adres ${slug} przeszedł`).toBe(false);
      const issue = result.error!.issues.find((entry) => entry.path[0] === "slug");
      expect(issue, "komunikat nie trafił do pola adresu").toBeDefined();
    },
  );
});

describe("unitSchema — okno serwisowe (lustro CHECK-ów product_units)", () => {
  const base = { serialNumber: "SN-1", unavailableFrom: "", unavailableTo: "", unavailableReason: "" };

  it("okno pełne albo żadne: samo „od” odrzucone z czytelnym komunikatem", () => {
    const result = unitSchema.safeParse({ ...base, unavailableFrom: "2026-08-01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("OBU dat");
    }
  });

  it("samo „do” również odrzucone", () => {
    expect(unitSchema.safeParse({ ...base, unavailableTo: "2026-08-05" }).success).toBe(false);
  });

  it("zakres inclusive: od = do jest poprawne, do < od nie", () => {
    expect(
      unitSchema.safeParse({ ...base, unavailableFrom: "2026-08-01", unavailableTo: "2026-08-01" })
        .success,
    ).toBe(true);
    expect(
      unitSchema.safeParse({ ...base, unavailableFrom: "2026-08-02", unavailableTo: "2026-08-01" })
        .success,
    ).toBe(false);
  });

  it("brak okna i pusty numer seryjny → null-e (nie puste stringi)", () => {
    const parsed = unitSchema.parse({ ...base, serialNumber: "" });
    expect(parsed).toEqual({
      serialNumber: null,
      unavailableFrom: null,
      unavailableTo: null,
      unavailableReason: null,
    });
  });
});

describe("tiersSchema — edytor progów", () => {
  const row = (tierDays: string, multiplier: string) => ({
    tierDays,
    multiplier,
    label: "",
    sortOrder: "0",
  });

  it("parsuje wiersze z JSON, mnożnik z przecinkiem", () => {
    const parsed = tiersSchema.parse(JSON.stringify([row("3", "2,7"), row("7", "6.5")]));
    expect(parsed).toEqual([
      { tierDays: 3, multiplier: 2.7, label: null, sortOrder: 0 },
      { tierDays: 7, multiplier: 6.5, label: null, sortOrder: 0 },
    ]);
  });

  it("duplikat tier_days odrzucony przed bazą", () => {
    const result = tiersSchema.safeParse(JSON.stringify([row("7", "6"), row("7", "5")]));
    expect(result.success).toBe(false);
  });

  it("multiplier malejący względem dni PRZECHODZI — monotoniczności świadomie nie wymuszamy (ADR-022)", () => {
    expect(tiersSchema.safeParse(JSON.stringify([row("3", "10"), row("7", "2")])).success).toBe(
      true,
    );
  });

  it("tierDays 0 i multiplier 0 odrzucone (CHECK-i > 0)", () => {
    expect(tiersSchema.safeParse(JSON.stringify([row("0", "1")])).success).toBe(false);
    expect(tiersSchema.safeParse(JSON.stringify([row("3", "0")])).success).toBe(false);
  });
});

describe("pickupLocationSchema", () => {
  it("nazwa wymagana, adres opcjonalny → null-e", () => {
    const parsed = pickupLocationSchema.parse({
      name: "Magazyn główny",
      addressStreet: "",
      addressZip: "",
      addressCity: "",
      active: "on",
    });
    expect(parsed.addressStreet).toBeNull();
    expect(pickupLocationSchema.safeParse({ name: "  ", active: "on" }).success).toBe(false);
  });
});

describe("getTenantCurrency", () => {
  // Atrapa PostgREST: .from().select().eq().eq().maybeSingle() → wiersz.
  const clientWith = (value: unknown) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: value === undefined ? null : { value } }),
            }),
          }),
        }),
      }),
    }) as never;

  it("skalar 'EUR' z tenant_settings → EUR", async () => {
    expect(await getTenantCurrency(clientWith("EUR"), "t-1")).toBe("EUR");
  });

  it("brak wiersza, nieznany kod, zły kształt → fallback PLN", async () => {
    expect(await getTenantCurrency(clientWith(undefined), "t-1")).toBe("PLN");
    expect(await getTenantCurrency(clientWith("XYZ"), "t-1")).toBe("PLN");
    expect(await getTenantCurrency(clientWith({ currency: "EUR" }), "t-1")).toBe("PLN");
  });
});

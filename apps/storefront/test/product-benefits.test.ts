/**
 * KORZYŚCI KARTY REZERWACJI — WYŁĄCZNIE Z DANYCH POZYCJI (benchmark pkt 5).
 *
 * Render ma swój test w `product-booking.test.tsx` (lista stoi / znika). Ten
 * plik pilnuje REGUŁY WYBORU, której render nie widzi: który próg cenowy jest
 * korzyścią, a który jest szumem albo wręcz kłamstwem.
 *
 * MUTACJE, KTÓRE MAJĄ TU SPŁONĄĆ:
 *   • dopisanie stałej obietnicy spoza danych („darmowa dostawa") — łapie to
 *     test pustego wyniku i asercje na DOKŁADNEJ liczbie pozycji,
 *   • pokazanie progu bez upustu (`multiplier >= 1`) jako korzyści,
 *   • pokazanie progu jednodniowego („taniej od 1 dni" — fraza niepoprawna
 *     i próg bez sensu, bo najem zaczyna się od doby),
 *   • wybór progu NAJGŁĘBSZEGO zamiast NAJKRÓTSZEGO (klient nad kalendarzem
 *     decyduje o jednym dniu, nie o miesiącu),
 *   • zaokrąglenie upustu w dół do zera i pokazanie „−0%".
 */
import type { PriceParams } from "@avably/core";
import { describe, expect, it } from "vitest";

import { productBenefits } from "@/lib/catalog/product-benefits";
import { getStorefrontCopy } from "@/lib/storefront/copy";

const copy = await getStorefrontCopy("pl");
const copyEn = await getStorefrontCopy("en");

const cena = (over: Partial<PriceParams> = {}): PriceParams => ({
  basePriceDayGrosze: 12_000,
  depositGrosze: 30_000,
  autoIncrementMultiplier: 1,
  tiers: [],
  ...over,
});

const benefits = (params: PriceParams, locale: "pl" | "en" = "pl") =>
  productBenefits({
    priceParams: params,
    copy: locale === "pl" ? copy : copyEn,
    currency: "PLN",
    locale,
  });

describe("wybór korzyści", () => {
  it("kaucja dodatnia daje pozycję z kwotą; kaucja zerowa nie daje nic", () => {
    const zKaucja = benefits(cena({ depositGrosze: 30_000 }));
    expect(zKaucja).toHaveLength(1);
    expect(zKaucja[0]!.kind).toBe("deposit");
    expect(zKaucja[0]!.label).toContain("300,00");

    expect(benefits(cena({ depositGrosze: 0 }))).toEqual([]);
  });

  it("próg z upustem daje pozycję z liczbą dni i procentem", () => {
    const out = benefits(cena({ depositGrosze: 0, tiers: [{ tierDays: 3, multiplier: 0.85 }] }));

    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("tier");
    expect(out[0]!.label).toContain("3");
    expect(out[0]!.label).toContain("15");
  });

  it("wygrywa próg NAJKRÓTSZY, nie najgłębszy", () => {
    const out = benefits(
      cena({
        depositGrosze: 0,
        tiers: [
          { tierDays: 14, multiplier: 0.5 },
          { tierDays: 3, multiplier: 0.9 },
          { tierDays: 7, multiplier: 0.7 },
        ],
      }),
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.label, "pokazany został próg najgłębszy zamiast najkrótszego").toContain("3");
    expect(out[0]!.label).toContain("10");
  });

  it.each([
    ["próg bez upustu", [{ tierDays: 3, multiplier: 1 }]],
    ["próg DROŻSZY od bazy", [{ tierDays: 3, multiplier: 1.2 }]],
    ["próg jednodniowy", [{ tierDays: 1, multiplier: 0.5 }]],
    ["upust poniżej pół procenta", [{ tierDays: 3, multiplier: 0.998 }]],
  ])("%s nie jest korzyścią", (_nazwa, tiers) => {
    expect(benefits(cena({ depositGrosze: 0, tiers }))).toEqual([]);
  });

  it("komplet danych daje DWIE pozycje — i ani jednej więcej", () => {
    const out = benefits(cena({ depositGrosze: 30_000, tiers: [{ tierDays: 3, multiplier: 0.9 }] }));

    expect(out.map((benefit) => benefit.kind)).toEqual(["tier", "deposit"]);
  });

  it("etykiety są w języku najemcy — PL i EN mówią co innego", () => {
    const params = cena({ depositGrosze: 30_000, tiers: [{ tierDays: 3, multiplier: 0.9 }] });
    const pl = benefits(params, "pl").map((benefit) => benefit.label);
    const en = benefits(params, "en").map((benefit) => benefit.label);

    expect(pl).not.toEqual(en);
    expect(pl.join(" "), "etykieta PL nie została podstawiona").not.toContain("{");
    expect(en.join(" "), "etykieta EN nie została podstawiona").not.toContain("{");
  });
});

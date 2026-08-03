// @vitest-environment jsdom

/**
 * SZCZEGÓŁ ZAMÓWIENIA POKAZUJE ZAPISANĄ CENĘ DOSTAWY (R3-1b).
 *
 * ================== CO BYŁO NIE TAK ==================
 *
 * Sekcja dostawy liczyła koszt `calculateDeliveryCost` na cenniku odczytanym
 * PRZY RENDERZE i nie zaglądała do `orders.delivery_grosze` (0016) ani do
 * `orders.delivery_price_source` (0044). Zamówienie z ceną ustaloną ręcznie
 * pokazywało więc kwotę z cennika — sprawdzone na żywo: zapisane 19,00 zł,
 * na ekranie 25,00 zł. Ta sama usterka przepisywała historię po każdej
 * zmianie cennika.
 *
 * ================== DLACZEGO TAK WYGLĄDA DOWÓD ==================
 *
 * „Zmieniony cennik" nie jest tu przypadkiem testowym z danymi, tylko
 * WŁAŚCIWOŚCIĄ KSZTAŁTU: powierzchnia kosztu nie przyjmuje cennika ANI
 * JAKO WEJŚCIA, a sekcja szczegółu w ogóle go nie odczytuje. Komponent,
 * który cennika nie widzi, nie ma jak wrócić do liczenia — i tego pilnują
 * dwie asercje: render (kwota to prop) i skan źródła (zero silnika cen
 * dostawy i zero odczytu klucza cennika w sekcji).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import messages from "../messages/pl.json";

import { DeliveryCost } from "@/app/[locale]/(panel)/zamowienia/[id]/delivery-cost";

const section = messages.orders.delivery.section;

afterEach(cleanup);

function renderCost(grosze: number, source: "pricing" | "manual") {
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <DeliveryCost grosze={grosze} source={source} currency="PLN" locale="pl" />
    </NextIntlClientProvider>,
  );
}

describe("koszt dostawy na szczególe — kwota zapisana, nie przeliczona", () => {
  it("pokazuje kwotę utrwaloną w zamówieniu", () => {
    renderCost(1_900, "manual");
    expect(screen.getByText(/19,00/)).toBeTruthy();
  });

  it("cena ustalona ręcznie jest OZNACZONA, a nie podana jako cennikowa", () => {
    // Bez tego zdania kwota różna od cennika wygląda na usterkę i pierwszym
    // odruchem operatora jest „poprawić" ustalenie z klientem.
    renderCost(1_900, "manual");

    expect(document.querySelector("[data-delivery-cost-manual]")).not.toBeNull();
    expect(screen.getByText(new RegExp(section.deliveryCostManual))).toBeTruthy();
    expect(document.querySelector('[data-delivery-cost="manual"]')).not.toBeNull();
  });

  it("kwota z cennika NIE dostaje plakietki ręcznej (kontrola pozytywna)", () => {
    renderCost(2_500, "pricing");

    expect(screen.getByText(/25,00/)).toBeTruthy();
    expect(document.querySelector("[data-delivery-cost-manual]")).toBeNull();
    expect(document.querySelector('[data-delivery-cost="pricing"]')).not.toBeNull();
  });

  it("zero jest kwotą i mówi „bezpłatnie”, także gdy ustalono je ręcznie", () => {
    renderCost(0, "manual");

    expect(screen.getByText(section.deliveryCostFree)).toBeTruthy();
    expect(document.querySelector("[data-delivery-cost-manual]")).not.toBeNull();
  });

  it("kwota jest cyframi tabelarycznymi, jak każda kwota w panelu", () => {
    renderCost(1_900, "manual");
    expect(document.querySelector("[data-delivery-cost] .tabular-nums")).not.toBeNull();
  });
});

describe("szczegół zamówienia nie ma jak wrócić do przeliczania z cennika", () => {
  const detailRoot = resolve(process.cwd(), "app/[locale]/(panel)/zamowienia/[id]");

  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  const sectionCode = stripComments(readFileSync(resolve(detailRoot, "delivery-section.tsx"), "utf8"));
  const costCode = stripComments(readFileSync(resolve(detailRoot, "delivery-cost.tsx"), "utf8"));
  const pageCode = stripComments(readFileSync(resolve(detailRoot, "page.tsx"), "utf8"));

  it("skany mają na czym pracować (kontrola po pustym zbiorze)", () => {
    expect(sectionCode.length).toBeGreaterThan(1_000);
    expect(costCode.length).toBeGreaterThan(200);
    expect(sectionCode).toContain("DeliveryCost");
  });

  it("sekcja dostawy nie woła silnika cen dostawy ANI nie czyta cennika", () => {
    for (const forbidden of [
      "calculateDeliveryCost",
      "resolveDeliveryCost",
      "deliveryPricingFromSettings",
      "DELIVERY_PRICING_KEY",
    ]) {
      expect(sectionCode, `powrót do przeliczania: ${forbidden}`).not.toContain(forbidden);
      expect(costCode, `powrót do przeliczania: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("kwota i jej źródło jadą z KOLUMN zamówienia, przez stronę szczegółu", () => {
    expect(pageCode).toContain("delivery_grosze");
    expect(pageCode).toContain("delivery_price_source");
    expect(pageCode).toMatch(/deliveryGrosze=\{row\.delivery_grosze\}/);
    expect(pageCode).toMatch(/deliveryPriceSource=\{row\.delivery_price_source\}/);
  });

  it("suma najmu przestała być wejściem sekcji — nie ma z czego liczyć progu", () => {
    // Próg darmowej dostawy liczy się OD SUMY NAJMU. Dopóki sekcja ją
    // dostawała, przeliczanie było o jeden prop od powrotu.
    expect(sectionCode).not.toContain("totalRentalGrosze");
  });
});

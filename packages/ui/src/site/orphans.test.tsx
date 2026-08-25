// @vitest-environment jsdom

/**
 * SIEROTY TYPOGRAFICZNE (S-47, audyt UX 2026-08-25).
 *
 * UWAGA: wzorce OCZEKIWANE zawierają PRAWDZIWE znaki U+00A0 (twarda spacja)
 * w punktach wiązania — w edytorze wyglądają jak zwykłe spacje, a różnica
 * między nimi jest CAŁYM findingiem. Wejścia mają spacje zwykłe. Asercje
 * renderowe czytają `textContent`, czyli dokładnie ten tekst, który
 * przeglądarka będzie łamać na wiersze.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { bindOrphans } from "./orphans";
import { SafeRichText } from "./rich-text";
import { StructuredSectionShell } from "./structured/shell";
import { siteStyles } from "./template";

afterEach(cleanup);

describe("bindOrphans — reguła", () => {
  it("spójnik dostaje twardą spację PO sobie, nie przed", () => {
    expect(bindOrphans("Rezerwuj online, z terminami")).toBe(
      "Rezerwuj online, z terminami",
    );
  });

  it("CIĄG spójników wiąże się w całości („i w weekendy”)", () => {
    expect(bindOrphans("online, i w weekendy")).toBe("online, i w weekendy");
  });

  it("wielka litera na początku zdania też jest spójnikiem", () => {
    expect(bindOrphans("W magazynie od ręki")).toBe("W magazynie od ręki");
    expect(bindOrphans("Z dowozem i montażem")).toBe("Z dowozem i montażem");
  });

  it("spójnik po znaku otwierającym („(w magazynie)”) też się wiąże", () => {
    expect(bindOrphans("sprzęt (w magazynie) czeka")).toBe(
      "sprzęt (w magazynie) czeka",
    );
  });

  it("spójnik po twardym złamaniu linii liczy się od NOWEJ linii", () => {
    expect(bindOrphans("hala.\ni w zestawie")).toBe("hala.\ni w zestawie");
  });

  it("litera będąca KOŃCEM słowa nie jest spójnikiem („dała w” wiąże „w”, nie „a”)", () => {
    expect(bindOrphans("ekipa dała w terminie radę")).toBe(
      "ekipa dała w terminie radę",
    );
  });

  it("interpunkcja ZA literą zdejmuje wiązanie („a,” to nie wiszący spójnik)", () => {
    expect(bindOrphans("raz a, dwa")).toBe("raz a, dwa");
  });

  it("tekst bez spójników i wielokrotne spacje wychodzą nietknięte", () => {
    expect(bindOrphans("Cennik wynajmu sprzętu")).toBe("Cennik wynajmu sprzętu");
    expect(bindOrphans("a  b")).toBe("a  b");
    expect(bindOrphans("w")).toBe("w");
    expect(bindOrphans("")).toBe("");
  });
});

describe("sieroty w warstwie RENDERU sekcji", () => {
  it("nagłówek sekcji strukturalnej wiąże „z terminami” twardą spacją", () => {
    const { container } = render(
      <StructuredSectionShell
        type="usp"
        layout="cards"
        background="default"
        heading="Rezerwacje online, z terminami"
        styles={siteStyles()}
      >
        <p>treść</p>
      </StructuredSectionShell>,
    );
    const heading = container.querySelector("h2")!;
    expect(heading.textContent).toBe("Rezerwacje online, z terminami");
    // Kontrola negatywna wprost: łamliwa para „z ” + „terminami” ZNIKŁA.
    expect(heading.textContent!.includes("z terminami")).toBe(false);
  });

  it("SafeRichText wiąże spójnik także tuż PRZED pogrubieniem — bez łamania znaczników", () => {
    const { container } = render(<SafeRichText body={"Sprzęt czeka w **magazynie** i u partnera"} />);
    const paragraph = container.querySelector("p")!;
    expect(paragraph.textContent).toBe("Sprzęt czeka w magazynie i u partnera");
    // Pogrubienie przeżyło wiązanie: znacznik jest w drzewie, a nie w tekście.
    expect(paragraph.querySelector("strong")?.textContent).toBe("magazynie");
    expect(paragraph.textContent!.includes("**")).toBe(false);
  });
});

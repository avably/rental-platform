/**
 * Kontrakt narracji LP: funkcje są dowodami jednego procesu wynajmu, nie
 * osobnym katalogiem obietnic. Test celowo pilnuje osi między sekcjami, a nie
 * całych zdań — redakcja może się zmieniać bez przepisywania bramki.
 */
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const locales = [
  ["pl", pl.marketing],
  ["en", en.marketing],
] as const;

function klucze(drzewo: unknown, prefiks = ""): string[] {
  if (!drzewo || typeof drzewo !== "object") return [];
  return Object.entries(drzewo).flatMap(([klucz, wartosc]) => {
    const sciezka = prefiks ? `${prefiks}.${klucz}` : klucz;
    return wartosc && typeof wartosc === "object" ? klucze(wartosc, sciezka) : [sciezka];
  });
}

describe("LP opowiada jeden proces wynajmu", () => {
  it("PL i EN zachowują identyczny kontrakt treści marketingowej", () => {
    expect(klucze(pl.marketing)).toEqual(klucze(en.marketing));
  });

  it("hero definiuje produkt, rezerwację i dalszą pracę zespołu", () => {
    expect(pl.marketing.hero.body).toMatch(/stron.* wypożyczalni/i);
    expect(pl.marketing.hero.body).toMatch(/panel\w* operacyjn/i);
    expect(pl.marketing.hero.body).toMatch(/rezerwacj\w*.*(wyd|wysył|zwrot|kaucj)/i);

    expect(en.marketing.hero.body).toMatch(/rental (website|site)/i);
    expect(en.marketing.hero.body).toMatch(/operations (back office|panel)/i);
    expect(en.marketing.hero.body).toMatch(/booking.*(hand|ship|return|deposit)/i);
  });

  it("pięć zakładek idzie od oferty do rozliczonego zwrotu", () => {
    const plTytuly = [1, 2, 3, 4, 5].map(
      (nr) => pl.marketing.tabs[`item${nr}Title` as keyof typeof pl.marketing.tabs],
    );
    const enTytuly = [1, 2, 3, 4, 5].map(
      (nr) => en.marketing.tabs[`item${nr}Title` as keyof typeof en.marketing.tabs],
    );

    expect(plTytuly[0]).toMatch(/ofert|sklep|publik/i);
    expect(plTytuly[1]).toMatch(/rezerw/i);
    expect(plTytuly[2]).toMatch(/dzień|termin|dostępn|przygot/i);
    expect(plTytuly[3]).toMatch(/wyd|dostaw|kurier|odbiór/i);
    expect(plTytuly[4]).toMatch(/zwrot|kaucj|rozlicz/i);

    expect(enTytuly[0]).toMatch(/offer|store|publish/i);
    expect(enTytuly[1]).toMatch(/book/i);
    expect(enTytuly[2]).toMatch(/day|date|availab|prepare/i);
    expect(enTytuly[3]).toMatch(/hand|deliver|ship|pickup/i);
    expect(enTytuly[4]).toMatch(/return|deposit|settle/i);
  });

  it("pulpit mówi o widoku dnia i nie wraca do usuniętych nazw", () => {
    expect(pl.marketing.cta.title).toMatch(/dzis|dzień/i);
    expect(en.marketing.cta.title).toMatch(/today|day/i);

    for (const [locale, marketing] of locales) {
      const copy = JSON.stringify(marketing);
      expect(copy, locale).not.toMatch(/Złoci klienci|Golden customers/i);
      expect(copy, locale).not.toMatch(/Wymaga uwagi|Needs attention/i);
    }
  });

  it("główne bloki są skanowalne, a nie drugim regulaminem", () => {
    for (const [locale, marketing] of locales) {
      expect(marketing.hero.body.length, `${locale}.hero.body`).toBeLessThanOrEqual(480);
      expect(marketing.premise.statement.length, `${locale}.premise.statement`).toBeLessThanOrEqual(520);
      for (let nr = 1; nr <= 5; nr += 1) {
        const body = marketing.tabs[`item${nr}Body` as keyof typeof marketing.tabs];
        expect(body.length, `${locale}.tabs.item${nr}Body`).toBeLessThanOrEqual(430);
      }
    }
  });
});

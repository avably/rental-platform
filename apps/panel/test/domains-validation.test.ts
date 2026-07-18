/**
 * Walidacja własnej domeny najemcy (Zadanie 2.6, ADR-046).
 *
 * Najważniejszy przypadek to BRAMKA HOSTA PLATFORMY. Bez niej najemca wpisałby
 * `www.avably.io` albo `<cudzy-slug>.avably.io` jako swoją domenę — a ponieważ
 * `avably.io` należy do NAS i siedzi w NASZYM projekcie u dostawcy, rejestracja
 * wróciłaby z `verified: true` od ręki. Werdykt dostawcy, na którym opiera się
 * całe zaufanie do własnych domen, potwierdza własność HOSTA, a ta jest tu
 * nasza — nie najemcy. Skutkiem byłoby przejęcie kanonu marketingowego albo
 * cudzego sklepu przez formularz w panelu.
 *
 * DOWÓD MUTACYJNY: usunięcie `.refine(... !isPlatformHost ...)` z
 * customDomainSchema pali testy „host platformy odrzucony".
 */
import { describe, expect, it } from "vitest";

import {
  customDomainInputFromFormData,
  customDomainSchema,
  isPlatformHost,
} from "@/app/[locale]/ustawienia-domen/domains-validation";

function parse(value: string) {
  return customDomainSchema.safeParse({ domain: value });
}

describe("customDomainSchema — kształt hosta", () => {
  it.each([
    ["sklep.twojafirma.pl", "sklep.twojafirma.pl"],
    ["  SKLEP.Twojafirma.PL  ", "sklep.twojafirma.pl"], // trim + lower
    ["sklep.twojafirma.pl.", "sklep.twojafirma.pl"], // kropka końcowa DNS obcięta
    ["wypozyczalnia-1.example.com", "wypozyczalnia-1.example.com"],
  ])("przyjmuje '%s' → '%s'", (input, expected) => {
    const result = parse(input);
    expect(result.success, `odrzucono poprawny host: ${input}`).toBe(true);
    if (result.success) expect(result.data.domain).toBe(expected);
  });

  it.each([
    "https://sklep.twojafirma.pl", // schemat
    "sklep.twojafirma.pl/sklep", // ścieżka
    "localhost", // goła etykieta to nie domena klienta (lustro CHECK-u 0019)
    "sklep..twojafirma.pl",
    "-sklep.twojafirma.pl",
    "sklep.twojafirma.pl:443", // port
    "sklep twojafirma.pl",
    "",
  ])("odrzuca '%s'", (input) => {
    expect(parse(input).success, `przyjęto niepoprawny host: ${input}`).toBe(false);
  });

  it("odrzuca host dłuższy niż limit kolumny (253 znaki)", () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(20)}.pl`;
    expect(long.length).toBeGreaterThan(253);
    expect(parse(long).success).toBe(false);
  });
});

describe("BRAMKA: własną domeną nie może być host platformy", () => {
  it.each([
    "avably.io",
    "www.avably.io",
    "app.avably.io",
    "cudzy-najemca.avably.io",
    "sklep.cudzy.avably.io",
  ])("odrzuca host platformy '%s'", (input) => {
    const result = parse(input);
    expect(result.success, `PRZEJĘCIE HOSTA: '${input}' przeszło jako domena własna`).toBe(false);
  });

  it("isPlatformHost nie łapie domeny, która tylko podobnie się kończy", () => {
    // 'zlyavably.io' NIE jest naszą subdomeną — bramka nie może być zbyt szeroka,
    // bo odbierałaby najemcom legalne domeny.
    expect(isPlatformHost("zlyavably.io")).toBe(false);
    expect(isPlatformHost("avably.io.example.com")).toBe(false);
    expect(isPlatformHost("acme.avably.io")).toBe(true);
  });
});

describe("customDomainInputFromFormData", () => {
  // Lekcja 8b (ADR-036): pole obecne w schemacie, którego akcja NIE czyta
  // z FormData, ginie cicho — sklejka jest osobna i pokryta testem.
  it("czyta pole 'domain' z FormData", () => {
    const fd = new FormData();
    fd.set("domain", "sklep.twojafirma.pl");
    expect(customDomainInputFromFormData(fd)).toEqual({ domain: "sklep.twojafirma.pl" });
  });
});

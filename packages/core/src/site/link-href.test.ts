/**
 * ALLOWLISTA CELU ODNOŚNIKA — GRANICA BEZPIECZEŃSTWA I JEJ JEDNOŚĆ.
 *
 * ==================== DWIE RZECZY, NIE JEDNA ====================
 *
 *   1. CO PRZECHODZI, A CO NIE. To jest zdanie o bezpieczeństwie: wartość
 *      wychodzi z treści najemcy prosto do atrybutu `href` na publicznej
 *      stronie, więc `javascript:` w tym miejscu jest wykonaniem skryptu.
 *      Testujemy allowlistę OD OBU STRON — samo „mailto przechodzi" byłoby
 *      spełnione także przez schemat, który przepuszcza wszystko.
 *
 *   2. ŻE REGUŁA JEST JEDNA. Do tego zadania istniała w TRZECH identycznych
 *      kopiach (`ctaHref` treści v1, `href` elementu płótna, `href` runu
 *      tekstowego), z których każda niosła komentarz o tym, że kopii być nie
 *      może. Rozszerzenie o `tel:`/`mailto:` w jednej z nich rozjechałoby
 *      produkt po cichu: przycisk dałoby się zapisać na płótnie i nie dałoby
 *      się w stopce. Noga ostatnia porównuje więc ZACHOWANIE wszystkich trzech
 *      dróg wejścia na tym samym zbiorze adresów.
 */
import { describe, expect, it } from "vitest";

import { linkHrefSchema } from "./link-href";
import { buttonElementSchema } from "./elements";
import { SECTION_CONTENT_SCHEMAS } from "./index";
import { textRunSchema } from "./rich-text";

/** Adresy, które MAJĄ przechodzić — z powodem, dla którego są na liście. */
const DOZWOLONE: [string, string][] = [
  ["https://przyklad.pl/cennik", "adres absolutny"],
  ["http://przyklad.pl", "http bez S — nadal adres, nie schemat wykonywalny"],
  ["/regulamin", "ścieżka własna"],
  ["#kontakt", "kotwica sekcji"],
  ["mailto:kontakt@przyklad.pl", "e-mail — powód rozszerzenia listy"],
  ["mailto:kontakt@przyklad.pl?subject=Wynajem", "e-mail z tematem: `?` nie unieważnia adresu"],
  ["tel:+48500600700", "telefon w formacie międzynarodowym"],
  ["tel:22 123 45 67", "numer ze spacjami — walidator nie może być mądrzejszy od standardu"],
];

/** Adresy, które MAJĄ odpaść — każdy z innym trybem awarii. */
const ODRZUCONE: [string, string][] = [
  ["javascript:alert(1)", "wykonanie skryptu z treści najemcy"],
  ["JavaScript:alert(1)", "ten sam schemat zapisany inaczej"],
  ["  javascript:alert(1)  ", "schemat schowany za białymi znakami (trim przed refine)"],
  ["data:text/html,<script>alert(1)</script>", "dokument wstrzyknięty adresem"],
  ["blob:https://przyklad.pl/abc", "schemat, którego nie ma na liście"],
  ["file:///etc/passwd", "dostęp do plików czytelnika"],
  ["ftp://przyklad.pl/plik", "schemat spoza listy, choć nieszkodliwy"],
  ["mailto:", "e-mail bez adresu — parsuje się poprawnie i jest martwym przyciskiem"],
  ["mailto:kontakt", "e-mail bez małpy"],
  ["tel:", "telefon bez numeru"],
  ["tel:zadzwon", "telefon bez ani jednej cyfry"],
  ["przyklad.pl", "adres bez schematu — nie jest ani URL-em, ani ścieżką"],
  ["", "pusty napis"],
];

const przechodzi = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: string) =>
  schema.safeParse(value).success;

describe("allowlista schematów", () => {
  it.each(DOZWOLONE)("przepuszcza %s (%s)", (href) => {
    expect(przechodzi(linkHrefSchema, href)).toBe(true);
  });

  it.each(ODRZUCONE)("odrzuca %s (%s)", (href) => {
    expect(przechodzi(linkHrefSchema, href)).toBe(false);
  });

  it("komunikat wymienia WSZYSTKIE dozwolone postaci adresu", () => {
    // Operator, który dostał odmowę, ma z komunikatu wiedzieć, co wolno.
    // Rozszerzenie listy bez poprawienia zdania zostawia go z instrukcją,
    // która kłamie — i to w miejscu, w którym nikt tego nie sprawdza.
    const message = linkHrefSchema.safeParse("javascript:alert(1)");
    const tekst = message.success ? "" : message.error.issues[0]!.message;
    for (const fragment of ["http", "/...", "#...", "mailto:", "tel:"]) {
      expect(tekst, `komunikat nie wymienia ${fragment}`).toContain(fragment);
    }
  });
});

describe("reguła jest JEDNA — trzy drogi wejścia, jedno zachowanie", () => {
  /** `ctaHref` treści v1 — tu przez przycisk sekcji CTA. */
  const przezTrescV1 = (href: string) =>
    SECTION_CONTENT_SCHEMAS.cta.safeParse({
      heading: "Gotowy?",
      buttonLabel: "Zadzwoń",
      buttonHref: href,
    }).success;

  /** `href` elementu płótna v2 — tu przez przycisk na płótnie. */
  const przezPlotnoV2 = (href: string) =>
    buttonElementSchema.safeParse({
      id: "b1",
      layout: { desktop: { x: 0, y: 0, w: 6, h: 2, z: 1 } },
      kind: "button",
      label: "Zadzwoń",
      align: "left",
      href,
    }).success;

  /** `href` runu tekstu sformatowanego. */
  const przezRunTekstu = (href: string) =>
    textRunSchema.safeParse({ text: "Zadzwoń", href }).success;

  const DROGI = [
    ["treść v1 (ctaHref)", przezTrescV1],
    ["płótno v2 (element button)", przezPlotnoV2],
    ["run tekstu", przezRunTekstu],
  ] as const;

  it("kontrola pozytywna: każda droga naprawdę waliduje adres", () => {
    // Bez tego zdania noga niżej przechodziłaby dla drogi, która `href`
    // ignoruje (np. po literówce w nazwie pola) — zgodność byłaby wtedy
    // zgodnością trzech odpowiedzi „tak" na każde pytanie.
    for (const [nazwa, droga] of DROGI) {
      expect(droga("https://przyklad.pl"), `${nazwa}: odrzuciła poprawny adres`).toBe(true);
      expect(droga("javascript:alert(1)"), `${nazwa}: przepuściła javascript:`).toBe(false);
    }
  });

  it.each([...DOZWOLONE, ...ODRZUCONE].map(([href]) => href))(
    "%s: wszystkie trzy drogi odpowiadają TAK SAMO",
    (href) => {
      const oczekiwane = przechodzi(linkHrefSchema, href);
      for (const [nazwa, droga] of DROGI) {
        expect(droga(href), `${nazwa} rozjechała się z allowlistą na ${href || "(pusty)"}`).toBe(
          oczekiwane,
        );
      }
    },
  );
});

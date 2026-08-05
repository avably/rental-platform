/**
 * KONTAKT JAKO TYP STRUKTURALNY (E4, ADR-095) — kontrakty rdzenia.
 *
 * Trzy rzeczy rozstrzygają się tutaj, a widać je dopiero u klienta:
 *
 *   1. KONWERSJA STAREJ TREŚCI. Kontakt — inaczej niż FAQ — jest
 *      konwertowalny w obu generacjach, ale płótno niesie już same NAPISY.
 *      Rodzaj wpisu wyprowadzamy z ich KSZTAŁTU, więc test musi pokazać, że
 *      wynik pochodzi ze starej sekcji, a nie z presetu (lekcja E3, mutacja M5:
 *      „tyle samo wpisów" nie odróżnia przeniesionej treści od zastępczej).
 *   2. ADRESAT. Formularz wysyła na adres z TREŚCI sekcji, więc reguła „który
 *      adres" jest regułą bezpieczeństwa, a nie detalem prezentacji.
 *   3. JEDNA WALIDACJA WIADOMOŚCI. Ta sama funkcja stoi w przeglądarce i w
 *      akcji serwerowej; gdyby były dwie, jedna z nich zawsze przepuszczałaby
 *      coś, czego druga nie przyjmuje.
 */
import { describe, expect, it } from "vitest";

import {
  CONTACT_ENTRY_KINDS,
  contactEntriesFromLegacy,
  contactFormVisible,
  contactMapHref,
  contactMessageErrors,
  parseContactMessage,
  contactRecipient,
  contactStructuredSchema,
  contactTelHref,
  parsePublishedSite,
  sectionCanvasFrom,
  structuredFromLegacy,
  structuredPresetFor,
  type ContactStructuredContent,
} from "./index";

/** Sekcja kontaktu w kształcie SPRZED płótna (v1) — wejście obu konwersji. */
const V1 = {
  heading: "Skontaktuj się z nami",
  email: "biuro@wypozyczalnia.test",
  phone: "+48 512 345 678",
  address: "ul. Polna 12, 30-001 Kraków",
  mapQuery: "Polna 12, Kraków",
};

function kontakt(patch: Partial<ContactStructuredContent> = {}): ContactStructuredContent {
  return { ...(structuredPresetFor("contact", "pl") as ContactStructuredContent), ...patch };
}

describe("konwersja starej treści (v1)", () => {
  it("przenosi WSZYSTKIE pola z rodzajem zapisanym wprost i w kolejności renderu", () => {
    expect(contactEntriesFromLegacy(V1)).toEqual([
      { kind: "email", value: "biuro@wypozyczalnia.test" },
      { kind: "phone", value: "+48 512 345 678" },
      { kind: "address", value: "ul. Polna 12, 30-001 Kraków" },
      { kind: "map", value: "Polna 12, Kraków" },
    ]);
  });

  it("pola nieobecne po prostu nie tworzą wpisów (bez pustych rubryk)", () => {
    expect(contactEntriesFromLegacy({ phone: "+48 512 345 678" })).toEqual([
      { kind: "phone", value: "+48 512 345 678" },
    ]);
    expect(contactEntriesFromLegacy({ heading: "Kontakt", email: "   " })).toEqual([]);
  });

  it("wynik konwersji przechodzi schemat i NIE JEST presetem", () => {
    const converted = structuredFromLegacy("contact", V1, "pl") as ContactStructuredContent;
    expect(contactStructuredSchema.safeParse(converted).success).toBe(true);
    expect(converted.heading).toBe("Skontaktuj się z nami");
    /*
     * Preset kontaktu ma CZTERY wpisy i konwersja z v1 też ma cztery — sama
     * liczba nie odróżnia więc przeniesionej treści od zastępczej (dokładnie
     * pułapka M5 z E3). Porównujemy WARTOŚCI i żądamy, żeby były operatora.
     */
    expect(converted.items.map((item) => item.value)).toEqual([
      "biuro@wypozyczalnia.test",
      "+48 512 345 678",
      "ul. Polna 12, 30-001 Kraków",
      "Polna 12, Kraków",
    ]);
    expect(
      converted.items,
      "wynik jest presetem — czyli dane kontaktowe najemcy przepadły po cichu",
    ).not.toEqual(kontakt().items);
  });
});

describe("konwersja płótna (v2) czyta KSZTAŁT, nie znaczenie", () => {
  /** Realne płótno: dokładnie to, co robi z sekcji v1 konwersja K2. */
  const plotno = sectionCanvasFrom("contact", V1);

  it("rozpoznaje adres, numer i adres pocztowy po kształcie wartości", () => {
    const entries = contactEntriesFromLegacy(plotno);
    expect(entries.map((entry) => entry.kind)).toEqual(["email", "phone", "address", "map"]);
    expect(entries.map((entry) => entry.value)).toEqual([
      "biuro@wypozyczalnia.test",
      "+48 512 345 678",
      "ul. Polna 12, 30-001 Kraków",
      "Polna 12, Kraków",
    ]);
  });

  it("adres pocztowy ZACZYNAJĄCY SIĘ OD CYFRY zostaje adresem, nie numerem", () => {
    // „00-001 Warszawa, Kwiatowa 5” ma cyfry na początku, ale też litery —
    // rozpoznanie po samym pierwszym znaku zamieniłoby adres w `tel:`.
    const entries = contactEntriesFromLegacy({ address: "00-001 Warszawa, Kwiatowa 5" });
    expect(entries).toEqual([{ kind: "address", value: "00-001 Warszawa, Kwiatowa 5" }]);
  });

  it("kolejność bierze się z CZYTANIA płótna, nie z kolejności dodawania", () => {
    const przestawione = {
      ...plotno,
      // Elementy w tablicy w odwrotnej kolejności — geometria zostaje ta sama.
      elements: [...plotno.elements].reverse(),
    };
    expect(contactEntriesFromLegacy(przestawione).map((entry) => entry.kind)).toEqual([
      "email",
      "phone",
      "address",
      "map",
    ]);
  });

  it("nagłówek płótna staje się nagłówkiem sekcji, a nie wpisem kontaktowym", () => {
    const converted = structuredFromLegacy("contact", plotno, "pl") as ContactStructuredContent;
    expect(converted.heading).toBe("Skontaktuj się z nami");
    expect(converted.items.map((entry) => entry.value)).not.toContain("Skontaktuj się z nami");
  });

  it("przycisk prowadzący GDZIE INDZIEJ niż mapa nie jest daną kontaktową", () => {
    const zPrzyciskiem = {
      ...plotno,
      elements: plotno.elements.map((element) =>
        element.kind === "button" ? { ...element, href: "https://sklep.przyklad.test/cennik" } : element,
      ),
    };
    const entries = contactEntriesFromLegacy(zPrzyciskiem);
    expect(entries.map((entry) => entry.kind)).toEqual(["email", "phone", "address"]);
  });

  it("płótno BEZ danych kontaktowych degraduje do presetu, a nie do pustki", () => {
    expect(structuredFromLegacy("contact", { heading: "Kontakt" }, "pl")).toEqual(kontakt());
    expect(structuredFromLegacy("contact", null, "pl")).toEqual(kontakt());
  });
});

describe("adresat formularza", () => {
  it("to PIERWSZY poprawny adres e-mail z treści sekcji", () => {
    const content = kontakt({
      items: [
        { kind: "phone", value: "+48 512 345 678" },
        { kind: "email", value: "biuro@wypozyczalnia.test" },
        { kind: "email", value: "serwis@wypozyczalnia.test" },
      ],
    });
    expect(contactRecipient(content)).toBe("biuro@wypozyczalnia.test");
  });

  it("wpis w rodzaju e-mail, ale NIE-adres, adresatem nie jest", () => {
    const content = kontakt({ items: [{ kind: "email", value: "napisz do nas!" }] });
    expect(contactRecipient(content)).toBeNull();
    expect(contactFormVisible(content), "formularz wysyłałby donikąd").toBe(false);
  });

  it("sekcja bez e-maila nie ma adresata (i to jest STAN, nie awaria)", () => {
    expect(contactRecipient(kontakt({ items: [{ kind: "phone", value: "+48 512 345 678" }] }))).toBeNull();
  });

  it("formularz wymaga OBU warunków: przełącznika i adresata", () => {
    expect(contactFormVisible(kontakt())).toBe(true);
    expect(contactFormVisible(kontakt({ showForm: false }))).toBe(false);
    expect(
      contactFormVisible(kontakt({ showForm: true, items: [{ kind: "address", value: "Polna 12" }] })),
    ).toBe(false);
  });
});

describe("klikalność danych", () => {
  it("numer w `tel:` traci spacje, ale zachowuje plus i separatory", () => {
    expect(contactTelHref("+48 512 345 678")).toBe("tel:+48512345678");
    expect(contactTelHref("(12) 345-67-89")).toBe("tel:(12)345-67-89");
  });

  it("zapytanie mapy jest UCIEKANE — spacja i ukośnik nie rozbijają adresu", () => {
    const href = contactMapHref("Polna 12/3, Kraków");
    expect(href).toContain(encodeURIComponent("Polna 12/3, Kraków"));
    expect(href.startsWith("https://")).toBe(true);
  });
});

describe("walidacja wiadomości (ta sama po obu stronach)", () => {
  const poprawna = {
    name: "Anna Kowalska",
    email: "anna@przyklad.test",
    message: "Czy namiot 5x8 jest wolny w pierwszy weekend czerwca?",
  };

  it("poprawne wejście nie ma błędów", () => {
    expect(contactMessageErrors(poprawna, false)).toEqual({});
  });

  it("puste pola są WYMAGANE, a nie „niepoprawne”", () => {
    expect(contactMessageErrors({ name: "", email: "", message: "" }, false)).toEqual({
      name: "required",
      email: "required",
      message: "required",
    });
  });

  it("adres bez małpy jest NIEPOPRAWNY (inny komunikat niż brak)", () => {
    expect(contactMessageErrors({ ...poprawna, email: "anna-bez-malpy" }, false)).toEqual({
      email: "invalid",
    });
  });

  it("zbyt długa wiadomość ma własny rodzaj błędu", () => {
    expect(contactMessageErrors({ ...poprawna, message: "x".repeat(5_001) }, false)).toEqual({
      message: "too_long",
    });
  });

  it("jedno słowo nie jest wiadomością, na którą da się odpowiedzieć", () => {
    expect(contactMessageErrors({ ...poprawna, message: "hej" }, false)).toEqual({
      message: "required",
    });
  });

  it("telefon jest wymagany DOKŁADNIE wtedy, gdy sekcja o niego pyta", () => {
    expect(contactMessageErrors(poprawna, true)).toEqual({ phone: "required" });
    expect(contactMessageErrors({ ...poprawna, phone: "512 345 678" }, true)).toEqual({});
    // Wyłączone pytanie: telefon podany mimo braku pola nie wywraca wysyłki.
    expect(contactMessageErrors({ ...poprawna, phone: "512 345 678" }, false)).toEqual({});
  });

  it("nieznane pole odrzuca CAŁE wejście, choć żadne pole nie jest winne", () => {
    /*
     * `.strict()` broni przed przemyceniem adresata jako pola wiadomości.
     * Winnego POLA tu nie ma, więc mapa błędów jest pusta — i właśnie dlatego
     * serwer pyta o `ok`, a nie o rozmiar mapy. Czytanie „pusta mapa = wejście
     * w porządku" przepuściłoby to zgłoszenie dalej.
     */
    const parsed = parseContactMessage({ ...poprawna, to: "napastnik@obcy.test" }, false);
    expect(parsed.ok).toBe(false);
    expect(contactMessageErrors({ ...poprawna, to: "napastnik@obcy.test" }, false)).toEqual({});
  });

  it("poprawne wejście oddaje PRZYCIĘTE dane, a nie wejście w surowej postaci", () => {
    const parsed = parseContactMessage({ ...poprawna, name: "  Anna Kowalska  " }, false);
    expect(parsed.ok && parsed.data.name).toBe("Anna Kowalska");
  });
});

describe("publikacja przenosi treść kontaktu 1:1", () => {
  /**
   * Koperta publikacji (`app.get_published_site`) niesie treść jako `jsonb`,
   * a odczyt parsuje ją schematem z rejestru. Ten test jest szwem między
   * jednym a drugim: treść v3 kontaktu — z pełnym kompletem rodzajów wpisów,
   * przełącznikami i odnośnikiem do polityki — musi wrócić z parsera CO DO
   * BAJTA. Gdyby schemat gubił pole (albo dokładał domyślne), sekcja po
   * publikacji wyglądałaby inaczej niż w kreatorze.
   *
   * Pełny przebieg przez bazę (zapis → publikacja → odczyt) stoi w pakiecie
   * bramki publikacji; tutaj bronimy tej jego części, która jest NASZA.
   */
  const tresc = kontakt({
    layout: "split",
    background: "muted",
    heading: "Porozmawiajmy",
    askPhone: true,
    privacyHref: "/polityka-prywatnosci",
    items: [
      { kind: "email", value: "biuro@wypozyczalnia.test" },
      { kind: "phone", value: "+48 512 345 678" },
      { kind: "address", value: "ul. Polna 12\n30-001 Kraków" },
      { kind: "hours", value: "pon.–pt. 9–17" },
      { kind: "map", value: "Polna 12, Kraków" },
    ],
  });

  const canonical = (value: unknown) => JSON.stringify(value, Object.keys(tresc).sort());

  it("wraca z koperty identyczna, z liczbowym znacznikiem generacji", () => {
    const koperta = {
      template: "classic",
      published_at: "2026-08-05T10:00:00Z",
      sections: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          position: 0,
          type: "contact",
          content: JSON.parse(JSON.stringify(tresc)),
        },
      ],
    };

    const site = parsePublishedSite(koperta);
    expect(site?.sections).toHaveLength(1);
    const content = site!.sections[0]!.content;
    expect(content, "publikacja zmieniła kształt treści kontaktu").toEqual(tresc);
    expect(canonical(content), "treść wróciła inna, niż do koperty weszła").toBe(canonical(tresc));
    expect((content as { v?: unknown }).v).toBe(3);
  });

  it("KAŻDY rodzaj wpisu przeżywa podróż (rejestr, nie lista przypadków)", () => {
    const wszystkie = kontakt({
      items: CONTACT_ENTRY_KINDS.map((kind) => ({
        kind,
        value: kind === "email" ? "biuro@wypozyczalnia.test" : `wartość-${kind}`,
      })),
    });
    const site = parsePublishedSite({
      template: "classic",
      published_at: "2026-08-05T10:00:00Z",
      sections: [
        { id: "22222222-2222-4222-8222-222222222222", position: 0, type: "contact", content: wszystkie },
      ],
    });
    expect(site?.sections[0]?.content).toEqual(wszystkie);
  });
});

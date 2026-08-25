/**
 * formatRentalRange (F8) — zakresy w jednym/dwóch miesiącach/latach, PL+EN,
 * atomowość frazy (NBSP) i kontrakt błędów z dates.ts.
 *
 * Asercje porównują NAJPIERW treść po normalizacji NBSP→spacja (czytelność
 * oczekiwań), a atomowość osobno: jedyna ZWYKŁA spacja stoi przed „·" —
 * czyli fraza ma dokładnie jeden legalny punkt łamania, nigdy w środku daty
 * (audyt S-10: „2026-08-/28").
 */
import { afterEach, describe, expect, it } from "vitest";

import { formatRentalRange, formatRentalRangeParts } from "./format-range";

const NBSP = "\u00a0";
const readable = (value: string) => value.replaceAll(NBSP, " ");

describe("formatRentalRange — PL", () => {
  it("wspólny miesiąc i rok zwiera zakres do dni", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-28", "pl"))).toBe(
      "26–28 sie 2026 · 3 dni",
    );
  });

  it("różne miesiące rozpisują obie daty z odstępami wokół półpauzy", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-09-02", "pl"))).toBe(
      "26 sie – 2 wrz 2026 · 8 dni",
    );
  });

  it("różne lata niosą oba lata", () => {
    expect(readable(formatRentalRange("2026-12-28", "2027-01-03", "pl"))).toBe(
      "28 gru 2026 – 3 sty 2027 · 7 dni",
    );
  });

  it("ta sama doba to jedna data i „1 dzień” (odmiana)", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-26", "pl"))).toBe(
      "26 sie 2026 · 1 dzień",
    );
  });
});

describe("formatRentalRange — EN", () => {
  it("wspólny miesiąc i rok zwiera zakres do dni", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-28", "en"))).toBe(
      "Aug 26–28, 2026 · 3 days",
    );
  });

  it("różne miesiące rozpisują obie daty", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-09-02", "en"))).toBe(
      "Aug 26 – Sep 2, 2026 · 8 days",
    );
  });

  it("różne lata niosą oba lata", () => {
    expect(readable(formatRentalRange("2026-12-28", "2027-01-03", "en"))).toBe(
      "Dec 28, 2026 – Jan 3, 2027 · 7 days",
    );
  });

  it("ta sama doba to jedna data i „1 day” (liczba pojedyncza)", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-26", "en"))).toBe(
      "Aug 26, 2026 · 1 day",
    );
  });
});

describe("formatRentalRange — fraza atomowa (S-10)", () => {
  it.each([
    ["pl", "2026-08-26", "2026-08-28"],
    ["pl", "2026-08-26", "2026-09-02"],
    ["pl", "2026-12-28", "2027-01-03"],
    ["en", "2026-08-26", "2026-09-02"],
  ] as const)("jedyna zwykła spacja stoi przed „·” (%s %s–%s)", (locale, start, end) => {
    const phrase = formatRentalRange(start, end, locale);
    const plainSpaceParts = phrase.split(" ");
    // Dokładnie jeden punkt łamania: [zakres, „· N dni”].
    expect(plainSpaceParts).toHaveLength(2);
    expect(plainSpaceParts[1]!.startsWith("·")).toBe(true);
    // Wewnątrz tokenów wyłącznie NBSP — data nie złamie się w środku.
    expect(plainSpaceParts[0]).not.toContain(" ");
  });
});

describe("formatRentalRange — kontrakt błędów (dates.ts)", () => {
  it("zakres odwrócony rzuca RangeError", () => {
    expect(() => formatRentalRange("2026-08-28", "2026-08-26", "pl")).toThrow(RangeError);
  });

  it("data spoza kalendarza rzuca RangeError", () => {
    expect(() => formatRentalRange("2026-02-31", "2026-03-02", "pl")).toThrow(RangeError);
  });

  it("zły kształt daty rzuca RangeError", () => {
    expect(() => formatRentalRange("26.08.2026", "2026-08-28", "pl")).toThrow(RangeError);
  });
});

describe("formatRentalRange — wariant KRÓTKI (F7b, pigułka terminu)", () => {
  /*
    CO MUSIAŁOBY SIĘ ZEPSUĆ: rok znikający ZAWSZE. „2 sty · 3 dni" w pigułce
    klienta, który rezerwuje na styczeń przyszłego roku, jest po prostu inną
    datą — a wada byłaby niewidoczna przez jedenaście miesięcy w roku.
    Dlatego „dziś" jest wstrzykiwane: test nie może zależeć od kalendarza
    maszyny, która go uruchamia.
  */
  it("rok BIEŻĄCY znika (a fraza dalej niesie zakres i liczbę dób)", () => {
    const krotko = formatRentalRange("2026-08-26", "2026-08-28", "pl", {
      short: true,
      today: "2026-08-25",
    });
    expect(krotko).not.toContain("2026");
    expect(krotko).toContain("26");
    expect(krotko).toContain("28");
    expect(krotko).toContain("3");
  });

  it("rok PRZYSZŁY zostaje — bez niego byłaby to inna data", () => {
    expect(
      formatRentalRange("2027-01-02", "2027-01-04", "pl", { short: true, today: "2026-08-25" }),
    ).toContain("2027");
  });

  it("zakres PRZEZ SYLWESTRA zostaje z rokiem, choć zaczyna się w roku bieżącym", () => {
    const fraza = formatRentalRange("2026-12-30", "2027-01-02", "pl", {
      short: true,
      today: "2026-08-25",
    });
    expect(fraza).toContain("2026");
    expect(fraza).toContain("2027");
  });

  it("BEZ opcji nic się nie zmienia — wariant pełny zostaje domyślny", () => {
    const pelny = formatRentalRange("2026-08-26", "2026-08-28", "pl");
    expect(pelny).toContain("2026");
    expect(formatRentalRange("2026-08-26", "2026-08-28", "pl", { today: "2026-08-25" })).toBe(pelny);
  });

  it("wariant krótki trzyma frazę ATOMOWĄ (jedna zwykła spacja, przed separatorem)", () => {
    const czesci = formatRentalRange("2026-08-26", "2026-09-02", "pl", {
      short: true,
      today: "2026-08-25",
    }).split(" ");
    expect(czesci).toHaveLength(2);
    expect(czesci[1]!.startsWith("·")).toBe(true);
    expect(czesci[0]).not.toContain(" ");
  });

  it("„dziś” spoza kalendarza rzuca RangeError (kontrakt dates.ts, bez trzeciej odpowiedzi)", () => {
    expect(() =>
      formatRentalRange("2026-08-26", "2026-08-28", "pl", { short: true, today: "2026-13-01" }),
    ).toThrow(RangeError);
  });
});

/* ================================ F12 ================================ */

describe("formatRentalRange — MIESIĄC ZAWSZE SŁOWNY (F12)", () => {
  /*
    CO BYŁO ZEPSUTE: fraza szła przez `Intl.DateTimeFormat.prototype.formatRange`,
    który nie formatuje dwóch dat naszym żądaniem, tylko oddaje sterowanie
    wzorcowi interwału z danych silnika. V8 składał „23–25 wrz", a
    JavaScriptCore (Safari, iOS — czyli telefon właściciela) „23.09–25.09".
    Klient dostawał zapis numeryczny dokładnie tam, gdzie F8 go zdjęło, i nie
    było jak tego zobaczyć testując w Chromie.

    CO MUSIAŁOBY SIĘ ZEPSUĆ, żeby te testy zgasły: powrót `formatRange`
    w składzie zakresu (dowód behawioralny niżej łapie to WPROST, bez patrzenia
    w źródło) albo zmiana żądania na `month: "numeric"`.
  */
  it.each([
    ["pl", "2026-09-23", "2026-09-25", "23–25 wrz"],
    ["pl", "2026-09-28", "2026-10-02", "28 wrz – 2 paź"],
    ["en", "2026-09-23", "2026-09-25", "Sep 23–25"],
    ["en", "2026-09-28", "2026-10-02", "Sep 28 – Oct 2"],
  ] as const)("%s %s–%s → „%s” (wariant krótki)", (locale, start, end, oczekiwany) => {
    const { range } = formatRentalRangeParts(start, end, locale, {
      short: true,
      today: "2026-08-25",
    });
    expect(readable(range)).toBe(oczekiwany);
  });

  /*
    ZAPIS NUMERYCZNY NIE MA PRAWA POJAWIĆ SIĘ W ŻADNYM WARIANCIE — także
    w pełnym (na Safari „26–28 sie 2026" schodziło do „26–28.08.2026", więc ISO
    wracało też do koszyka, kasy i potwierdzenia). Wzorzec łapie każdą postać
    miesiąca zapisanego cyframi: „23.09", „09.2026", „09/23".
  */
  it.each([
    ["pl", "2026-09-23", "2026-09-25"],
    ["pl", "2026-09-28", "2026-10-02"],
    ["pl", "2026-12-30", "2027-01-02"],
    ["en", "2026-09-28", "2026-10-02"],
  ] as const)("%s %s–%s nie niesie miesiąca cyframi (pełny i krótki)", (locale, start, end) => {
    for (const options of [{}, { short: true, today: "2026-08-25" as const }]) {
      const fraza = formatRentalRange(start, end, locale, options);
      expect(fraza, `zapis numeryczny w „${fraza}”`).not.toMatch(/\d\s*[./]\s*\d/u);
    }
  });

  /*
    DOWÓD BEHAWIORALNY „NIE DELEGUJEMY DO SILNIKA". Podmieniamy `formatRange`
    na funkcję zwracającą oczywistą sieczkę: gdyby formatter dalej z niej
    korzystał, fraza byłaby sieczką. Test jest ODPORNY na przeniesienie literału
    w źródle (bramka regexowa po pliku by tego nie złapała) i mówi dokładnie to,
    co ma być prawdą na telefonie właściciela.
  */
  describe("zakres nie przechodzi przez Intl.formatRange", () => {
    const oryginal = Intl.DateTimeFormat.prototype.formatRange;

    afterEach(() => {
      Intl.DateTimeFormat.prototype.formatRange = oryginal;
    });

    it("podmieniony `formatRange` nie zmienia ANI JEDNEJ frazy", () => {
      const przed = [
        formatRentalRange("2026-09-23", "2026-09-25", "pl", { short: true, today: "2026-08-25" }),
        formatRentalRange("2026-09-28", "2026-10-02", "pl"),
        formatRentalRange("2026-12-28", "2027-01-03", "en"),
      ];
      Intl.DateTimeFormat.prototype.formatRange = () => "SILNIK-ZŁOŻYŁ-TO-SAM";
      // Kontrola przyrządu: podmiana naprawdę weszła w życie.
      expect(new Intl.DateTimeFormat("pl").formatRange(new Date(0), new Date(1))).toBe(
        "SILNIK-ZŁOŻYŁ-TO-SAM",
      );
      const po = [
        formatRentalRange("2026-09-23", "2026-09-25", "pl", { short: true, today: "2026-08-25" }),
        formatRentalRange("2026-09-28", "2026-10-02", "pl"),
        formatRentalRange("2026-12-28", "2027-01-03", "en"),
      ];
      expect(po).toEqual(przed);
    });
  });
});

describe("formatRentalRangeParts — człony osobno (F12, priorytet w pigułce)", () => {
  /*
    CO MUSIAŁOBY SIĘ ZEPSUĆ: rozjazd między członami a pełną frazą. Pigułka
    belki składa napis z `range` + `days`, a koszyk i kasa biorą gotowe
    `formatRentalRange` — gdyby separator albo odstęp różniły się o znak, ten
    sam termin czytałby się w belce inaczej niż dwa kliknięcia dalej.
  */
  it.each([
    ["pl", "2026-08-26", "2026-08-28", {}],
    ["pl", "2026-08-26", "2026-09-02", {}],
    ["en", "2026-12-28", "2027-01-03", {}],
    ["pl", "2026-09-23", "2026-09-25", { short: true, today: "2026-08-25" as const }],
  ] as const)("%s %s–%s: człony sklejają się w DOKŁADNIE pełną frazę", (locale, start, end, opcje) => {
    const { range, days } = formatRentalRangeParts(start, end, locale, opcje);
    expect(`${range} ·${NBSP}${days}`).toBe(formatRentalRange(start, end, locale, opcje));
  });

  it("człony są ATOMOWE osobno — ani w zakresie, ani w dobach nie ma zwykłej spacji", () => {
    const { range, days } = formatRentalRangeParts("2026-08-26", "2026-09-02", "pl");
    expect(range, "zakres złamie się w środku daty na wąskiej pigułce").not.toContain(" ");
    expect(days, "„8 dni” złamie się między liczbą a słowem").not.toContain(" ");
  });

  it("doby niosą SAMĄ długość, bez separatora „·” (ten dokłada wołający)", () => {
    expect(formatRentalRangeParts("2026-08-26", "2026-08-26", "pl").days).toBe(`1${NBSP}dzień`);
    expect(formatRentalRangeParts("2026-08-26", "2026-08-28", "en").days).toBe(`3${NBSP}days`);
  });

  it("kontrakt błędów jest ten sam, co pełnej frazy (jedna funkcja, jedno wejście)", () => {
    expect(() => formatRentalRangeParts("2026-08-28", "2026-08-26", "pl")).toThrow(RangeError);
    expect(() => formatRentalRangeParts("2026-02-31", "2026-03-02", "pl")).toThrow(RangeError);
  });
});

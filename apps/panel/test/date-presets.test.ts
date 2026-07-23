/**
 * Presety terminu i arytmetyka dat listy (uwaga przeglądu U1): zakresy „ten
 * miesiąc / przyszły miesiąc / najbliższe 14 dni" i przesunięcia dni bez
 * driftu na granicy miesiąca oraz roku.
 */
import { describe, expect, it } from "vitest";

import { datePresetRange } from "@/lib/orders/date-presets";
import { addIsoDays, warsawToday } from "@/lib/orders/order-dates";

describe("addIsoDays", () => {
  it("dodaje i odejmuje dni przez granicę miesiąca", () => {
    expect(addIsoDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addIsoDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("przechodzi przez granicę roku", () => {
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("warsawToday", () => {
  it("zwraca datę w Europe/Warsaw, nie w UTC (23:30 UTC = już jutro w PL latem)", () => {
    // 2026-07-23T23:30Z to 2026-07-24 01:30 w Warszawie (UTC+2 latem).
    expect(warsawToday(new Date("2026-07-23T23:30:00Z"))).toBe("2026-07-24");
  });
});

describe("datePresetRange", () => {
  const TODAY = "2026-07-23";

  it("bieżący miesiąc: od 1. do ostatniego dnia miesiąca (lipiec = 31 dni)", () => {
    expect(datePresetRange("biezacy-miesiac", TODAY)).toEqual({ od: "2026-07-01", do: "2026-07-31" });
  });

  it("przyszły miesiąc: cały następny (sierpień = 31 dni)", () => {
    expect(datePresetRange("przyszly-miesiac", TODAY)).toEqual({ od: "2026-08-01", do: "2026-08-31" });
  });

  it("najbliższe 14 dni: dziś .. dziś + 13 (14 dni włącznie)", () => {
    expect(datePresetRange("najblizsze-14-dni", TODAY)).toEqual({ od: "2026-07-23", do: "2026-08-05" });
  });

  it("bieżący miesiąc luty w roku przestępnym kończy się 29.", () => {
    expect(datePresetRange("biezacy-miesiac", "2028-02-10").do).toBe("2028-02-29");
  });

  it("przyszły miesiąc z grudnia przechodzi na styczeń następnego roku", () => {
    expect(datePresetRange("przyszly-miesiac", "2026-12-15")).toEqual({
      od: "2027-01-01",
      do: "2027-01-31",
    });
  });
});

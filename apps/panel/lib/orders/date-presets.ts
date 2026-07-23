/**
 * Presety terminu dla szybkich chipów listy („Ten miesiąc", „Przyszły
 * miesiąc", „Najbliższe 14 dni") — ADR-057.
 *
 * Preset to POJEDYNCZY parametr URL (`preset`), z którego serwer wylicza parę
 * `od`/`do`. Dzięki temu chip jest jednym `submit` w tym samym formularzu co
 * wyszukiwarka (nie gubi wpisanego tekstu), a stan wciśnięcia wynika wprost z
 * `preset` w adresie — bez porównywania dwóch dat z zakresem.
 *
 * Zakresy są INCLUSIVE po obu stronach — spójnie z konwencją nachodzenia
 * terminów z 0007 (start <= do AND end >= od), którą filtr listy zachowuje.
 */
import { addIsoDays } from "./order-dates";

export const DATE_PRESETS = ["biezacy-miesiac", "przyszly-miesiac", "najblizsze-14-dni"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface DateRange {
  od: string;
  do: string;
}

/** Pierwszy dzień miesiąca `m` (1–12) roku `y` jako `YYYY-MM-DD`. */
function firstOfMonth(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Miesiąc następny po (y, m) z przeniesieniem roku. */
function nextMonth(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/**
 * Zakres presetu względem `today` (`YYYY-MM-DD`, zwykle Europe/Warsaw).
 *
 * - `biezacy-miesiac`  → od 1. dnia miesiąca `today` do jego ostatniego dnia.
 * - `przyszly-miesiac` → cały miesiąc następny.
 * - `najblizsze-14-dni`→ `today` .. `today + 13` (14 dni licząc z dzisiejszym).
 *
 * Ostatni dzień miesiąca wyliczamy jako „pierwszy następnego minus 1", więc
 * luty i lata przestępne wychodzą bez tablicy długości miesięcy.
 */
export function datePresetRange(preset: DatePreset, today: string): DateRange {
  const [y, m] = today.split("-").map(Number) as [number, number];
  switch (preset) {
    case "biezacy-miesiac": {
      const next = nextMonth(y, m);
      return { od: firstOfMonth(y, m), do: addIsoDays(firstOfMonth(next.y, next.m), -1) };
    }
    case "przyszly-miesiac": {
      const start = nextMonth(y, m);
      const after = nextMonth(start.y, start.m);
      return { od: firstOfMonth(start.y, start.m), do: addIsoDays(firstOfMonth(after.y, after.m), -1) };
    }
    case "najblizsze-14-dni":
      return { od: today, do: addIsoDays(today, 13) };
  }
}

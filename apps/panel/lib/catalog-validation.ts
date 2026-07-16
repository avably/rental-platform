/**
 * Schematy Zod dla formularzy katalogu (Zadanie 3). Każda akcja serwerowa
 * waliduje FormData tym schematem PRZED wywołaniem Supabase — CHECK-i bazy
 * (0007) są bramką ostateczną, ale ich błędy PostgREST nie umie przełożyć
 * na nic czytelnego, więc komunikat dla operatora powstaje tu.
 *
 * Konwersja kwot: wyłącznie przez lib/money-input.ts (jedno miejsce).
 * Komunikaty po polsku — wzorzec repo (lib/validation.ts).
 */
import { z } from "zod";

import { parseMajorToGrosze, parseMultiplier } from "./money-input";

export const uuidSchema = z.string().uuid("Nieprawidłowy identyfikator.");

const MONEY_FORMAT_MESSAGE =
  "Podaj kwotę w jednostkach głównych, maksymalnie dwa miejsca po przecinku (np. 100,50).";

/** Kwota wymagana: "100,50" → 10050 groszy. */
const moneySchema = z.string().transform((raw, ctx) => {
  const grosze = parseMajorToGrosze(raw);
  if (grosze === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MONEY_FORMAT_MESSAGE });
    return z.NEVER;
  }
  return grosze;
});

/** Kwota opcjonalna: puste pole → 0 groszy (kaucja 0 jest legalna — 0007). */
const optionalMoneySchema = z.string().transform((raw, ctx) => {
  if (raw.trim() === "") return 0;
  const grosze = parseMajorToGrosze(raw);
  if (grosze === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MONEY_FORMAT_MESSAGE });
    return z.NEVER;
  }
  return grosze;
});

const multiplierSchema = z.string().transform((raw, ctx) => {
  const value = parseMultiplier(raw);
  if (value === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Podaj mnożnik większy od zera, maksymalnie dwa miejsca po przecinku (np. 6,5).",
    });
    return z.NEVER;
  }
  return value;
});

const nonNegativeIntSchema = (message: string) =>
  z.string().transform((raw, ctx) => {
    const normalized = raw.trim();
    if (!/^\d+$/.test(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return Number(normalized);
  });

/** Pole opcjonalne tekstowe: puste → null (baza rozróżnia NULL od ""). */
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksymalnie ${max} znaków.`)
    .transform((value) => (value === "" ? null : value));

/** Checkbox HTML: obecny w FormData = zaznaczony. */
const checkboxSchema = z.preprocess((value) => value != null, z.boolean());

// ---------------------------------------------------------------------
// Produkty
// ---------------------------------------------------------------------

export const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Podaj nazwę produktu.")
    .max(200, "Nazwa może mieć najwyżej 200 znaków."),
  description: optionalTextSchema(5000),
  basePriceDayGrosze: moneySchema.refine((grosze) => grosze > 0, {
    message: "Cena za dobę musi być większa od zera.",
  }),
  depositGrosze: optionalMoneySchema,
  autoIncrementMultiplier: multiplierSchema,
  bufferBeforeDays: nonNegativeIntSchema("Bufor przed najmem: podaj liczbę dni (0 lub więcej)."),
  bufferAfterDays: nonNegativeIntSchema("Bufor po najmie: podaj liczbę dni (0 lub więcej)."),
  active: checkboxSchema,
});

export type ProductInput = z.infer<typeof productSchema>;

// ---------------------------------------------------------------------
// Egzemplarze
// ---------------------------------------------------------------------

const ISO_DATE_MESSAGE = "Podaj datę w formacie RRRR-MM-DD.";

/** Data opcjonalna: puste → null, inaczej poprawny ISO yyyy-mm-dd. */
const optionalIsoDateSchema = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: ISO_DATE_MESSAGE });
    return z.NEVER;
  }
  return trimmed;
});

export const unitSchema = z
  .object({
    serialNumber: optionalTextSchema(100),
    unavailableFrom: optionalIsoDateSchema,
    unavailableTo: optionalIsoDateSchema,
    unavailableReason: optionalTextSchema(500),
  })
  // Lustro CHECK-a product_units_unavailable_range_complete (0007): okno
  // niedostępności jest albo pełne, albo nie ma go wcale.
  .refine((unit) => (unit.unavailableFrom === null) === (unit.unavailableTo === null), {
    message:
      "Okno serwisowe wymaga OBU dat (od i do) albo żadnej — samo „od” lub samo „do” nie określa okna.",
    path: ["unavailableTo"],
  })
  // Lustro product_units_unavailable_range_ordered: zakres inclusive,
  // od = do (serwis jednodniowy) jest poprawne.
  .refine(
    (unit) =>
      unit.unavailableFrom === null ||
      unit.unavailableTo === null ||
      unit.unavailableTo >= unit.unavailableFrom,
    {
      message: "Koniec okna serwisowego nie może być wcześniejszy niż początek.",
      path: ["unavailableTo"],
    },
  );

export type UnitInput = z.infer<typeof unitSchema>;

// ---------------------------------------------------------------------
// Progi cenowe
// ---------------------------------------------------------------------

const tierRowSchema = z.object({
  tierDays: nonNegativeIntSchema("Próg: podaj liczbę dni większą od zera.").refine(
    (days) => days > 0,
    { message: "Próg: podaj liczbę dni większą od zera." },
  ),
  multiplier: multiplierSchema,
  label: optionalTextSchema(200),
  sortOrder: nonNegativeIntSchema("Kolejność: podaj liczbę 0 lub większą."),
});

/**
 * Edytor progów wysyła wiersze jako JSON w jednym polu formularza (edycja
 * tabelaryczna z podglądem żyje w stanie klienta, nie w polach input[]).
 *
 * Duplikat tier_days łapiemy tu, przed bazą — unikalność pilnuje też
 * constraint pricing_tiers_days_key, ale jego 23505 nie mówi operatorowi,
 * KTÓRY wiersz jest zdublowany.
 *
 * Monotoniczności multiplier względem tier_days ŚWIADOMIE nie wymuszamy
 * (decyzja produktowa: kształt progów jest wyborem najemcy — patrz ADR-022);
 * skutki cenowe pokazuje podgląd wyceny, nie walidacja.
 */
export const tiersSchema = z
  .string()
  .transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nieprawidłowe dane progów." });
      return z.NEVER;
    }
    return parsed;
  })
  .pipe(z.array(tierRowSchema).max(100, "Zbyt wiele progów (maksymalnie 100)."))
  .refine(
    (rows) => new Set(rows.map((row) => row.tierDays)).size === rows.length,
    { message: "Dwa progi mają tę samą liczbę dni — wycena byłaby niejednoznaczna." },
  );

export type TiersInput = z.infer<typeof tiersSchema>;

// ---------------------------------------------------------------------
// Punkty odbioru
// ---------------------------------------------------------------------

export const pickupLocationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Podaj nazwę punktu odbioru.")
    .max(200, "Nazwa może mieć najwyżej 200 znaków."),
  addressStreet: optionalTextSchema(300),
  addressZip: optionalTextSchema(20),
  addressCity: optionalTextSchema(120),
  active: checkboxSchema,
});

export type PickupLocationInput = z.infer<typeof pickupLocationSchema>;

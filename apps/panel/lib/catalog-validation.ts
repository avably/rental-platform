/**
 * Schematy Zod dla formularzy katalogu (Zadanie 3). Każda akcja serwerowa
 * waliduje FormData tym schematem PRZED wywołaniem Supabase — CHECK-i bazy
 * (0007) są bramką ostateczną, ale ich błędy PostgREST nie umie przełożyć
 * na nic czytelnego, więc komunikat dla operatora powstaje tu.
 *
 * Konwersja kwot: wyłącznie przez lib/money-input.ts (jedno miejsce).
 * Komunikaty po polsku — wzorzec repo (lib/validation.ts).
 */
import {
  PRODUCT_SLUG_MAX_LENGTH,
  PRODUCT_SLUG_PATTERN,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_PATTERN,
  isReservedCategorySlug,
  suggestCategorySlug,
} from "@avably/core";
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

/**
 * ADRES SPRZĘTU (ADR-182) — pole, w którym PUSTE znaczy „wygeneruj", a nie
 * „błąd".
 *
 * To jest różnica względem kategorii, gdzie pusty adres jest odrzucany, jeśli
 * nie da się go wyprowadzić z nazwy. Adres sprzętu nadaje BAZA (trigger
 * `products_slug_guard`, 0083) — i musi to robić także wtedy, gdy zapis
 * przychodzi z panelu SPRZED tej zmiany albo z importu CSV. Wyprowadzanie
 * podpowiedzi tutaj byłoby drugą regułą obok tamtej, a dwie reguły nadawania
 * adresu rozjadą się przy pierwszej poprawce normalizacji.
 *
 * Sprawdzamy więc wyłącznie to, co ma sens sprawdzić PRZED bazą: kształt
 * wartości, którą operator wpisał sam. Reszta odmów (adres zajęty,
 * adres przekierowujący gdzie indziej) pada w bazie i wraca do pola —
 * patrz `katalog/actions.ts`.
 */
const productSlugSchema = z
  .string()
  .trim()
  .superRefine((slug, ctx) => {
    if (slug === "") return;
    if (slug.length > PRODUCT_SLUG_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Adres może mieć najwyżej ${PRODUCT_SLUG_MAX_LENGTH} znaków.`,
      });
      return;
    }
    if (!PRODUCT_SLUG_PATTERN.test(slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Adres może zawierać wyłącznie małe litery bez ogonków, cyfry i myślniki (np. rower-gorski).",
      });
    }
  });

export const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Podaj nazwę produktu.")
    .max(200, "Nazwa może mieć najwyżej 200 znaków."),
  slug: productSlugSchema,
  description: optionalTextSchema(5000),
  basePriceDayGrosze: moneySchema.refine((grosze) => grosze > 0, {
    message: "Cena za dobę musi być większa od zera.",
  }),
  depositGrosze: optionalMoneySchema,
  autoIncrementMultiplier: multiplierSchema,
  bufferBeforeDays: nonNegativeIntSchema("Bufor przed najmem: podaj liczbę dni (0 lub więcej)."),
  bufferAfterDays: nonNegativeIntSchema("Bufor po najmie: podaj liczbę dni (0 lub więcej)."),
  /**
   * Minimalny okres najmu (0089, ADR-202): >= 1, nie >= 0 — „minimum 0 dni"
   * nie znaczy nic innego niż „minimum 1 dzień" (najem trwa co najmniej dobę,
   * INCLUSIVE), a dwie reprezentacje jednego stanu to gotowy rozjazd. Lustro
   * CHECK products_min_rental_days_check; 1 = brak ograniczenia.
   */
  minRentalDays: nonNegativeIntSchema(
    "Minimalny okres najmu: podaj liczbę dni (1 lub więcej).",
  ).refine((days) => days >= 1, {
    message: "Minimalny okres najmu: podaj liczbę dni (1 lub więcej).",
  }),
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

const unitFieldsSchema = z.object({
  serialNumber: optionalTextSchema(100),
  unavailableFrom: optionalIsoDateSchema,
  unavailableTo: optionalIsoDateSchema,
  unavailableReason: optionalTextSchema(500),
});

/** Kształt, na którym pracują reguły okna serwisowego (wiersz i zbiorczy wiersz). */
type ServiceWindow = { unavailableFrom: string | null; unavailableTo: string | null };

const WINDOW_COMPLETE_MESSAGE =
  "Okno serwisowe wymaga OBU dat (od i do) albo żadnej — samo „od” lub samo „do” nie określa okna.";
const WINDOW_ORDERED_MESSAGE = "Koniec okna serwisowego nie może być wcześniejszy niż początek.";

// Lustro CHECK-a product_units_unavailable_range_complete (0007): okno
// niedostępności jest albo pełne, albo nie ma go wcale.
const windowComplete = (unit: ServiceWindow) =>
  (unit.unavailableFrom === null) === (unit.unavailableTo === null);

// Lustro product_units_unavailable_range_ordered: zakres inclusive,
// od = do (serwis jednodniowy) jest poprawne.
const windowOrdered = (unit: ServiceWindow) =>
  unit.unavailableFrom === null ||
  unit.unavailableTo === null ||
  unit.unavailableTo >= unit.unavailableFrom;

export const unitSchema = unitFieldsSchema
  .refine(windowComplete, { message: WINDOW_COMPLETE_MESSAGE, path: ["unavailableTo"] })
  .refine(windowOrdered, { message: WINDOW_ORDERED_MESSAGE, path: ["unavailableTo"] });

export type UnitInput = z.infer<typeof unitSchema>;

/**
 * Wiersz ZBIORCZEGO edytora egzemplarzy (U8b).
 *
 * `id` rozstrzyga los wiersza: UUID = egzemplarz istniejący (UPDATE), brak
 * albo `null` = wiersz dołożony w edytorze (INSERT). Klient nie wysyła
 * żadnej flagi „nowy/stary" — jedno źródło prawdy zamiast dwóch, które
 * mogłyby się rozjechać.
 */
const unitRowSchema = unitFieldsSchema
  .extend({ id: uuidSchema.nullish() })
  .refine(windowComplete, { message: WINDOW_COMPLETE_MESSAGE, path: ["unavailableTo"] })
  .refine(windowOrdered, { message: WINDOW_ORDERED_MESSAGE, path: ["unavailableTo"] });

/** Wspólny parser JSON-a z ukrytego pola formularza (wzorzec `tiersSchema`). */
const jsonFieldSchema = (message: string) =>
  z.string().transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * KOMPLET egzemplarzy produktu z edytora zbiorczego (U8b).
 *
 * Duplikat numeru seryjnego łapiemy TU, przed bazą: częściowy unikat
 * `product_units_serial_key` (0007) i tak by go odrzucił, ale jego 23505 nie
 * mówi operatorowi, KTÓRY z dwunastu wierszy jest zdublowany. Egzemplarze bez
 * numeru (sprzęt nieoznaczony) są normalne i musi ich być wiele — dlatego
 * unikalność liczy się WYŁĄCZNIE dla numerów wpisanych, dokładnie jak indeks
 * częściowy w bazie.
 */
export const unitsSchema = jsonFieldSchema("Nieprawidłowe dane egzemplarzy.")
  .pipe(z.array(unitRowSchema).max(500, "Zbyt wiele egzemplarzy (maksymalnie 500)."))
  .refine(
    (rows) => {
      const serials = rows
        .map((row) => row.serialNumber)
        .filter((serial): serial is string => serial !== null);
      return new Set(serials).size === serials.length;
    },
    {
      message:
        "Dwa egzemplarze mają ten sam numer seryjny — numer musi być unikalny w obrębie produktu.",
    },
  );

export type UnitsInput = z.infer<typeof unitsSchema>;

/** Identyfikatory egzemplarzy zdjętych w edytorze — do usunięcia przy zapisie. */
export const unitIdsSchema = jsonFieldSchema("Nieprawidłowe dane usuwanych egzemplarzy.").pipe(
  z.array(uuidSchema).max(500, "Zbyt wiele egzemplarzy do usunięcia (maksymalnie 500)."),
);

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

/** Kolejność miniatury: liczba całkowita 0..9999 (korekta lady). */
export const sortOrderSchema = nonNegativeIntSchema(
  "Kolejność: podaj liczbę całkowitą 0 lub większą.",
).refine((value) => value <= 9999, { message: "Kolejność: maksymalnie 9999." });

// ---------------------------------------------------------------------
// Kategorie katalogu (ADR-155)
// ---------------------------------------------------------------------

/**
 * Formularz kategorii. Bramką ostateczną jest baza (CHECK kształtu, unikaty,
 * trigger slugów zarezerwowanych z 0072) — tu powstaje ZDANIE, które operator
 * jest w stanie przeczytać, zanim tam trafi.
 *
 * SLUG PUSTY = WYPROWADZONY Z NAZWY, nie błąd. Operator zakładający „Namioty"
 * nie ma powodu myśleć o adresie; podpowiedź z rdzenia (`suggestCategorySlug`)
 * daje `namioty` i sprawa jest zamknięta. Pole zostaje edytowalne, bo adres,
 * który raz poszedł w świat, bywa ważniejszy niż nazwa.
 *
 * Kolejność sprawdzeń jest celowa: najpierw KSZTAŁT (bo „Namioty Duże" nie
 * jest slugiem i zdanie o rezerwacji byłoby tu bez sensu), potem REZERWACJA.
 */
const categoryFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Podaj nazwę kategorii.")
    .max(CATEGORY_NAME_MAX_LENGTH, `Nazwa może mieć najwyżej ${CATEGORY_NAME_MAX_LENGTH} znaków.`),
  slug: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase()),
  description: optionalTextSchema(CATEGORY_DESCRIPTION_MAX_LENGTH),
});

export const categorySchema = categoryFieldsSchema.transform((input, ctx) => {
  const slug = input.slug === "" ? suggestCategorySlug(input.name) : input.slug;

  const reject = (message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["slug"] });
    return z.NEVER;
  };

  if (slug === "") {
    // Nazwa złożona wyłącznie ze znaków, których adres nie uniesie (np. same
    // emoji). Wtedy podpowiedź nie ma z czego powstać i adres musi paść ręcznie.
    return reject("Podaj adres kategorii — z tej nazwy nie da się go wyprowadzić.");
  }
  if (slug.length > CATEGORY_SLUG_MAX_LENGTH) {
    return reject(`Adres może mieć najwyżej ${CATEGORY_SLUG_MAX_LENGTH} znaków.`);
  }
  if (!CATEGORY_SLUG_PATTERN.test(slug)) {
    return reject(
      "Adres może zawierać wyłącznie małe litery bez ogonków, cyfry i myślniki (np. namioty-rodzinne).",
    );
  }
  if (isReservedCategorySlug(slug)) {
    return reject(`Adres „${slug}” jest zarezerwowany przez sklep — wybierz inny.`);
  }

  return { ...input, slug };
});

export type CategoryInput = Exclude<z.infer<typeof categorySchema>, never>;

/**
 * Zaznaczone kategorie produktu — surowe wartości z `formData.getAll`.
 *
 * Limit 50: przy płaskiej taksonomii produkt w pięćdziesięciu kategoriach nie
 * jest już klasyfikacją, tylko przypadkiem hurtowego zaznaczenia „wszystko".
 * Wartość spoza UUID odrzucamy TU, bo `.eq` na kolumnie uuid oddałoby 22P02
 * („invalid input syntax"), czyli komunikat, który operatorowi nic nie mówi.
 */
export const productCategoryIdsSchema = z
  .array(uuidSchema)
  .max(50, "Zbyt wiele kategorii na jednym produkcie (maksymalnie 50).");

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

// ---------------------------------------------------------------------
// Lista katalogu — parametry z URL (U8a)
// ---------------------------------------------------------------------

/**
 * Kolumny sortowalne listy katalogu. Whitelist trzyma ekran w ryzach:
 * nieznany klucz sortu spada na `undefined` (sort domyślny), nie na błąd
 * strony. Odwzorowanie kluczy na porządek żyje w `lib/catalog/product-sort.ts`
 * — tu jest wyłącznie zbiór dozwolonych wartości.
 *
 * `teren` to kolumna „dziś w terenie" (U8a) — OSOBNA oś od `active`
 * („Status"): tamta mówi, czy produkt jest opublikowany, ta — czy sprzęt
 * fizycznie wyjechał.
 */
export const PRODUCT_SORT_KEYS = ["nazwa", "cena", "egzemplarze", "teren"] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

export const PRODUCT_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type ProductSortDirection = (typeof PRODUCT_SORT_DIRECTIONS)[number];

/**
 * Filtr publikacji. Brak parametru = wszystkie produkty (stan wyjściowy
 * listy) — dlatego nie ma wartości „wszystkie": pusty parametr znaczy to
 * samo, a jedna reprezentacja mniej to jeden rozjazd mniej w linkach chipów.
 */
export const PRODUCT_STATUS_FILTERS = ["aktywne", "nieaktywne"] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

/**
 * Filtry listy katalogu z `searchParams`. Błędna wartość jest IGNOROWANA
 * (`catch(undefined)`), nie jest błędem strony: `q` przycinamy do rozsądnej
 * długości, nieznany status/sort/dir pomijamy. `q` NIE trafia do zapytania
 * PostgREST — filtrowanie po frazie robi `lib/catalog/product-search.ts` nad
 * odczytaną stroną.
 */
export const productsFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .catch(undefined),
  status: z
    .enum(PRODUCT_STATUS_FILTERS as unknown as [ProductStatusFilter, ...ProductStatusFilter[]])
    .optional()
    .catch(undefined),
  sort: z
    .enum(PRODUCT_SORT_KEYS as unknown as [ProductSortKey, ...ProductSortKey[]])
    .optional()
    .catch(undefined),
  dir: z
    .enum(PRODUCT_SORT_DIRECTIONS as unknown as [ProductSortDirection, ...ProductSortDirection[]])
    .optional()
    .catch(undefined),
});

export type ProductsFilter = z.infer<typeof productsFilterSchema>;

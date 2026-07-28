/**
 * Schematy Zod dla ekranu klientów (R6a) — wzorzec order-validation.ts oraz
 * checkout `lib/checkout/validation.ts`.
 *
 * Dwie bramki:
 *  - `customersFilterSchema` — parametry listy (wyszukiwarka + sort). Błędna
 *    wartość jest IGNOROWANA (`catch(undefined)`), nie błędem strony: zepsuty
 *    link nie ma wywracać listy, a filtr i tak zawęża wyłącznie w obrębie RLS
 *    tenanta.
 *  - `customerEditSchema` — edycja danych klienta z karty. Waliduje KAŻDE pole
 *    (wejście Server Action pochodzi od klienta), lustrzanie do checkoutu:
 *    te same długości pól i ten sam luźny format adresu/NIP-u co przy składaniu
 *    zamówienia — pole opcjonalne puste staje się `null`. Ostateczną bramką
 *    integralności jest baza (RLS 0007 + CHECK na długość e-maila).
 */
import { z } from "zod";

/**
 * Pole opcjonalne tekstowe: puste → null (wzorzec order-validation.ts).
 * Przycięcie zdejmuje przypadkowe spacje z formularza, `""` znaczy „brak".
 */
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksymalnie ${max} znaków.`)
    .transform((value) => (value === "" ? null : value));

/**
 * Edycja klienta z karty (uwaga właściciela: „dane z możliwością edycji,
 * adres, dane do faktury").
 *
 * E-mail jest JEDYNYM polem wymaganym — to on identyfikuje klienta (unikat
 * per tenant, indeks customers_tenant_email_key). Długości pól są kopią
 * checkoutu; adres i NIP są tak samo luźne jak tam, bo to te same dane, które
 * klient wpisuje sam przy zamówieniu — panel nie ma prawa być surowszy niż
 * formularz, z którego dane pochodzą.
 */
export const customerEditSchema = z.object({
  // min 3: lustro CHECK-a length(email) between 3 and 320 z 0007 — czytelny
  // komunikat, zanim żądanie dotrze do bazy.
  email: z
    .string()
    .trim()
    .min(3, "Podaj adres e-mail.")
    .max(320, "Adres e-mail jest za długi.")
    .email("Podaj poprawny adres e-mail."),
  fullName: optionalTextSchema(200),
  phone: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(
      z
        .string()
        .min(4, "Numer telefonu jest za krótki.")
        .max(32, "Numer telefonu jest za długi.")
        .nullable(),
    ),
  companyName: optionalTextSchema(200),
  nip: optionalTextSchema(32),
  addressStreet: optionalTextSchema(200),
  addressZip: optionalTextSchema(20),
  addressCity: optionalTextSchema(120),
});

export type CustomerEditInput = z.infer<typeof customerEditSchema>;

/** FormData → wejście customerEditSchema (wzorzec statusChangeFromFormData). */
export function customerEditFromFormData(formData: FormData): unknown {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    email: text("email"),
    fullName: text("fullName"),
    phone: text("phone"),
    companyName: text("companyName"),
    nip: text("nip"),
    addressStreet: text("addressStreet"),
    addressZip: text("addressZip"),
    addressCity: text("addressCity"),
  };
}

/**
 * Kolumny sortowalne listy klientów. Whitelist trzyma ekran w ryzach: nieznany
 * klucz sortu spada na undefined (sort domyślny), nie na błąd strony. Wszystkie
 * trzy sortują się w pamięci (agregaty zamówień) — odwzorowanie żyje w
 * `customers/customer-sort.ts`, tu jest tylko zbiór dozwolonych wartości.
 */
export const CUSTOMER_SORT_KEYS = ["klient", "zamowienia", "ostatnie"] as const;
export type CustomerSortKey = (typeof CUSTOMER_SORT_KEYS)[number];

export const CUSTOMER_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type CustomerSortDirection = (typeof CUSTOMER_SORT_DIRECTIONS)[number];

/**
 * Filtry listy klientów z searchParams. Błędna wartość jest IGNOROWANA
 * (`catch(undefined)`): `q` (wyszukiwarka) przycinamy do rozsądnej długości,
 * nieznany sort/dir pomijamy.
 */
export const customersFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .catch(undefined),
  sort: z
    .enum(CUSTOMER_SORT_KEYS as unknown as [CustomerSortKey, ...CustomerSortKey[]])
    .optional()
    .catch(undefined),
  dir: z
    .enum(CUSTOMER_SORT_DIRECTIONS as unknown as [CustomerSortDirection, ...CustomerSortDirection[]])
    .optional()
    .catch(undefined),
});

export type CustomersFilter = z.infer<typeof customersFilterSchema>;

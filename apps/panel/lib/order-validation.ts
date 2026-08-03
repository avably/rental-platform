/**
 * Schematy Zod dla formularzy zamówień (Zadanie 4) — wzorzec
 * catalog-validation.ts: każda akcja serwerowa waliduje FormData PRZED
 * Supabase, lustra CHECK-ów z 0007/0010 dają czytelny komunikat zamiast
 * surowego PostgREST. Bramką ostateczną pozostaje baza (RLS + triggery 0010).
 *
 * Daty waliduje assertIsoDate z silnika — jedyne źródło arytmetyki i
 * poprawności dat (2026-02-31 ma poprawny kształt, a nie istnieje).
 */
import {
  DELIVERY_ADDRESS_SOURCES,
  DELIVERY_POINT_PROVIDERS,
  DELIVERY_PRICE_OVERRIDE_MAX_GROSZE,
  ORDER_PAYMENT_METHODS,
  ORDER_STATUSES,
  assertIsoDate,
  methodUsesDeliveryAddress,
  methodUsesDeliveryPoint,
  type DeliveryDestination,
  type IsoDate,
  type OrderPaymentMethod,
} from "@avably/core";
import { z } from "zod";

import { parseMajorToGrosze } from "./money-input";
import { DATE_PRESETS } from "./orders/date-presets";

export const uuidSchema = z.string().uuid("Nieprawidłowy identyfikator.");

/** Lustro CHECK-a orders.delivery_method (0007). */
export const DELIVERY_METHODS = ["pickup", "courier", "parcel_locker", "own_delivery"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

const ISO_DATE_MESSAGE = "Podaj datę w formacie RRRR-MM-DD.";

export const isoDateSchema = z.string().transform((raw, ctx): IsoDate => {
  try {
    return assertIsoDate(raw.trim());
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: ISO_DATE_MESSAGE });
    return z.NEVER;
  }
});

/** Pole opcjonalne tekstowe: puste → null (wzorzec catalog-validation.ts). */
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksymalnie ${max} znaków.`)
    .transform((value) => (value === "" ? null : value));

/**
 * Pozycje przychodzą jako JSON w jednym polu formularza (koszyk żyje w
 * stanie klienta — wzorzec edytora progów, tiersSchema). Pozycja niesie
 * WYŁĄCZNIE productId: egzemplarz przypisuje serwer (ADR-024), a kwoty
 * liczy silnik po autorytatywnym odczycie cennika — klient nie ma jak
 * podstawić własnej ceny.
 */
const itemsSchema = z
  .string()
  .transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nieprawidłowe dane pozycji." });
      return z.NEVER;
    }
    return parsed;
  })
  .pipe(
    z
      .array(z.object({ productId: uuidSchema }))
      .min(1, "Zamówienie wymaga co najmniej jednej pozycji.")
      .max(50, "Zbyt wiele pozycji (maksymalnie 50)."),
  );

/**
 * Pola „pustego wyboru" listy: `""` znaczy „nie wybrano" i JEST poprawne na
 * poziomie pola — sensowność braku rozstrzygają dopiero `.refine` niżej,
 * w kontekście metody dostawy. Dzięki temu komunikat mówi „paczkomat wymaga
 * numeru punktu", a nie „nieprawidłowa wartość".
 */
const optionalEnumSchema = <T extends readonly [string, ...string[]]>(
  values: T,
  message: string,
) => z.union([z.literal(""), z.enum(values, { error: () => message })]);

/**
 * Ręcznie ustalona cena dostawy (R3, pinezka o cennikach).
 *
 * Wejściem jest kwota w jednostkach głównych z pola formularza — TA SAMA
 * dyscyplina co przy kaucjach (`parseMajorToGrosze`): przecinek albo kropka,
 * najwyżej dwa miejsca, śmieci odrzucone zamiast zgadywane. Zero przechodzi
 * (dostawa gratis to decyzja operatora), górną granicę trzyma silnik
 * (`DELIVERY_PRICE_OVERRIDE_MAX_GROSZE`) — tu jest jej lustro, żeby operator
 * zobaczył powód przy polu, a nie dopiero jako błąd całego formularza.
 */
const deliveryPriceSchema = z.string().transform((raw, ctx) => {
  const grosze = parseMajorToGrosze(raw);
  if (grosze === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Podaj kwotę dostawy (np. 19 albo 19,90).",
    });
    return z.NEVER;
  }
  if (grosze > DELIVERY_PRICE_OVERRIDE_MAX_GROSZE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Cena dostawy nie może przekraczać ${DELIVERY_PRICE_OVERRIDE_MAX_GROSZE / 100} zł.`,
    });
    return z.NEVER;
  }
  return grosze;
});

export const orderFormSchema = z
  .object({
    customerId: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.union([z.literal(""), z.string().uuid("Nieprawidłowy identyfikator klienta.")])),
    newCustomerEmail: z
      .string()
      .trim()
      .pipe(
        z.union([
          z.literal(""),
          z.string().email("Podaj poprawny adres e-mail.").max(320, "Adres jest za długi."),
        ]),
      ),
    newCustomerName: optionalTextSchema(200),
    newCustomerPhone: optionalTextSchema(32),
    items: itemsSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    deliveryMethod: z.enum(DELIVERY_METHODS, {
      error: () => "Wybierz metodę dostawy.",
    }),
    pickupLocationId: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.union([z.literal(""), z.string().uuid("Nieprawidłowy identyfikator punktu.")])),
    notes: optionalTextSchema(2000),

    // --- R3: forma płatności (pinezka 82a0c41a) ---
    // Pusto = operator jeszcze nie ustalił; to POPRAWNY stan zamówienia
    // (kolumna orders.payment_method jest NULLABLE od 0029), a nie brak danych
    // do uzupełnienia na siłę.
    paymentMethod: optionalEnumSchema(
      ORDER_PAYMENT_METHODS as unknown as [OrderPaymentMethod, ...OrderPaymentMethod[]],
      "Wybierz formę płatności.",
    ),

    // --- R3: cena dostawy z cennika albo ustalona ręcznie (pinezka 3c944a2d) ---
    deliveryPriceSource: optionalEnumSchema(
      ["pricing", "manual"] as const,
      "Nieznane źródło ceny dostawy.",
    ),
    deliveryPrice: z.string(),

    // --- R3: punkt odbioru przewoźnika (pinezka ff2dfefc) ---
    deliveryPointProvider: optionalEnumSchema(
      DELIVERY_POINT_PROVIDERS as unknown as [string, ...string[]],
      "Nieznany dostawca punktu odbioru.",
    ),
    deliveryPointCode: optionalTextSchema(32),
    deliveryPointAddress: optionalTextSchema(300),

    // --- R3: adres dostarczenia (pinezka e2aef3f6) ---
    deliveryAddressSource: optionalEnumSchema(
      DELIVERY_ADDRESS_SOURCES as unknown as [string, ...string[]],
      "Wybierz adres dostarczenia.",
    ),
    deliveryAddressName: optionalTextSchema(200),
    deliveryAddressStreet: optionalTextSchema(200),
    deliveryAddressZip: optionalTextSchema(20),
    deliveryAddressCity: optionalTextSchema(100),
    deliveryAddressPhone: optionalTextSchema(32),
  })
  // Klient jest DOKŁADNIE jeden: istniejący (customerId) albo nowy (e-mail).
  .refine((form) => (form.customerId !== "") !== (form.newCustomerEmail !== ""), {
    message: "Wybierz istniejącego klienta ALBO podaj e-mail nowego.",
    path: ["customerId"],
  })
  // Lustro orders_dates_ordered: zakres INCLUSIVE, start = end jest poprawny.
  .refine((form) => form.endDate >= form.startDate, {
    message: "Koniec najmu nie może być wcześniejszy niż początek.",
    path: ["endDate"],
  })
  // Lustro orders_pickup_requires_location.
  .refine((form) => form.deliveryMethod !== "pickup" || form.pickupLocationId !== "", {
    message: "Odbiór osobisty wymaga wskazania punktu odbioru.",
    path: ["pickupLocationId"],
  })
  /*
    R3 — CEL DOSTARCZENIA (ADR-089). Reguły są STRICTE dwustronne: metoda,
    która jedzie do punktu, punktu WYMAGA; każda inna go ZABRANIA. Wariant
    „zignoruj nieadekwatne pole" odpada świadomie — cicho porzucony numer
    paczkomatu wygląda z ekranu identycznie jak zapisany, a to jest dokładnie
    ta klasa gubienia danych, którą zamknęła migracja 0041. Formularz wysyła
    pola warunkowo (puste ukryte pole przy nieadekwatnej metodzie), więc
    strictness nie generuje fałszywych odmów.
  */
  .refine(
    (form) => !methodUsesDeliveryPoint(form.deliveryMethod) || form.deliveryPointCode !== null,
    {
      message: "Dostawa do paczkomatu wymaga numeru punktu.",
      path: ["deliveryPointCode"],
    },
  )
  .refine(
    (form) => !methodUsesDeliveryPoint(form.deliveryMethod) || form.deliveryPointProvider !== "",
    {
      message: "Wskaż dostawcę punktu odbioru.",
      path: ["deliveryPointProvider"],
    },
  )
  .refine(
    (form) =>
      methodUsesDeliveryPoint(form.deliveryMethod) ||
      (form.deliveryPointProvider === "" &&
        form.deliveryPointCode === null &&
        form.deliveryPointAddress === null),
    {
      message: "Punkt odbioru dotyczy wyłącznie dostawy do paczkomatu.",
      path: ["deliveryPointCode"],
    },
  )
  .refine(
    (form) => !methodUsesDeliveryAddress(form.deliveryMethod) || form.deliveryAddressSource !== "",
    {
      message: "Wskaż adres dostarczenia — z danych klienta albo inny.",
      path: ["deliveryAddressSource"],
    },
  )
  .refine(
    (form) => methodUsesDeliveryAddress(form.deliveryMethod) || form.deliveryAddressSource === "",
    {
      message: "Adres dostarczenia dotyczy wyłącznie kuriera i dostawy własnej.",
      path: ["deliveryAddressSource"],
    },
  )
  // Lustro orders_delivery_address_shape: „inny adres" wymaga kompletu.
  .refine(
    (form) =>
      form.deliveryAddressSource !== "custom" ||
      (form.deliveryAddressStreet !== null &&
        form.deliveryAddressZip !== null &&
        form.deliveryAddressCity !== null),
    {
      message: "Inny adres wymaga ulicy, kodu pocztowego i miejscowości.",
      path: ["deliveryAddressStreet"],
    },
  )
  /*
    Druga strona tego samego CHECK-a: „adres z danych klienta" to WSKAŹNIK na
    kartotekę, więc pola adresu muszą zostać puste. Gdyby wolno je było
    wypełnić, powstałaby druga prawda o tym samym adresie i pytanie, która
    pojechała na etykietę.
  */
  .refine(
    (form) =>
      form.deliveryAddressSource === "custom" ||
      (form.deliveryAddressName === null &&
        form.deliveryAddressStreet === null &&
        form.deliveryAddressZip === null &&
        form.deliveryAddressCity === null &&
        form.deliveryAddressPhone === null),
    {
      message: "Adres z danych klienta czytamy z kartoteki — nie kopiujemy go do zamówienia.",
      path: ["deliveryAddressStreet"],
    },
  )
  // R3 — CENA DOSTAWY. Kwota jest wymagana dokładnie wtedy, gdy operator
  // zadeklarował, że ustala ją sam; przy cenniku pole musi zostać puste,
  // żeby wpisana i porzucona liczba nie udawała, że coś znaczy.
  .refine((form) => form.deliveryPriceSource !== "manual" || form.deliveryPrice.trim() !== "", {
    message: "Podaj kwotę dostawy albo wróć do ceny z cennika.",
    path: ["deliveryPrice"],
  })
  .refine((form) => form.deliveryPriceSource === "manual" || form.deliveryPrice.trim() === "", {
    message: "Cena dostawy jest liczona z cennika — wyczyść kwotę albo wybierz cenę własną.",
    path: ["deliveryPrice"],
  })
  // Lustro reguły silnika: pickup jest bezpłatny z definicji (ADR-030).
  .refine((form) => form.deliveryMethod !== "pickup" || form.deliveryPriceSource !== "manual", {
    message: "Odbiór osobisty jest bezpłatny — nie można ustalić dla niego ceny.",
    path: ["deliveryPrice"],
  })
  .superRefine((form, ctx) => {
    if (form.deliveryPriceSource !== "manual") return;
    const parsed = deliveryPriceSchema.safeParse(form.deliveryPrice);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.error.issues[0]?.message ?? "Nieprawidłowa kwota dostawy.",
        path: ["deliveryPrice"],
      });
    }
  })
  .transform((form) => ({
    customerId: form.customerId === "" ? null : form.customerId,
    newCustomer:
      form.newCustomerEmail === ""
        ? null
        : { email: form.newCustomerEmail, fullName: form.newCustomerName, phone: form.newCustomerPhone },
    items: form.items,
    startDate: form.startDate,
    endDate: form.endDate,
    deliveryMethod: form.deliveryMethod,
    pickupLocationId: form.pickupLocationId === "" ? null : form.pickupLocationId,
    notes: form.notes,
    paymentMethod: form.paymentMethod === "" ? null : (form.paymentMethod as OrderPaymentMethod),
    /**
     * `null` = licz z cennika. Kwota jest już zwalidowana przez superRefine
     * powyżej, więc `parseMajorToGrosze` nie może tu zwrócić null — a gdyby
     * kiedyś mogło, `?? null` spada na cennik zamiast wstawić NaN do pieniędzy.
     */
    deliveryPriceOverrideGrosze:
      form.deliveryPriceSource === "manual" ? (parseMajorToGrosze(form.deliveryPrice) ?? null) : null,
    destination: destinationFromForm(form),
  }));

/**
 * Cel dostarczenia jako JEDNA wartość wariantowa (`DeliveryDestination`
 * z silnika) — akcja serwerowa dostaje gotowy kształt, zamiast składać
 * dziewięć luźnych pól i mieć okazję pomylić wariant.
 *
 * Funkcja jest wołana PO wszystkich `.refine`, więc każdy `!` niżej jest
 * spełniony z konstrukcji: „custom" bez kompletu adresu i „parcel_locker"
 * bez punktu nie dochodzą do tego miejsca.
 */
function destinationFromForm(form: {
  deliveryMethod: DeliveryMethod;
  deliveryPointProvider: string;
  deliveryPointCode: string | null;
  deliveryPointAddress: string | null;
  deliveryAddressSource: string;
  deliveryAddressName: string | null;
  deliveryAddressStreet: string | null;
  deliveryAddressZip: string | null;
  deliveryAddressCity: string | null;
  deliveryAddressPhone: string | null;
}): DeliveryDestination {
  if (methodUsesDeliveryPoint(form.deliveryMethod)) {
    return {
      kind: "point",
      point: {
        provider: form.deliveryPointProvider as (typeof DELIVERY_POINT_PROVIDERS)[number],
        code: form.deliveryPointCode!,
        address: form.deliveryPointAddress,
      },
    };
  }
  if (form.deliveryAddressSource === "customer") return { kind: "customer" };
  if (form.deliveryAddressSource === "custom") {
    return {
      kind: "custom",
      address: {
        name: form.deliveryAddressName,
        street: form.deliveryAddressStreet!,
        zip: form.deliveryAddressZip!,
        city: form.deliveryAddressCity!,
        phone: form.deliveryAddressPhone,
      },
    };
  }
  return { kind: "none" };
}

export type OrderFormInput = z.infer<typeof orderFormSchema>;

const orderStatusSchema = z.enum(
  ORDER_STATUSES as unknown as [string, ...string[]],
  { error: () => "Nieznany status zamówienia." },
);

/**
 * Zmiana statusu niesie też stan OCZEKIWANY (optymistyczna współbieżność):
 * UPDATE trafia wyłącznie wiersz, który wciąż jest w expectedFrom — jeśli
 * ktoś zdążył zmienić status, akcja dosięga zero wierszy i mówi to wprost,
 * zamiast wykonać przejście z innego stanu, niż widział operator.
 */
export const statusChangeSchema = z.object({
  orderId: uuidSchema,
  to: orderStatusSchema,
  expectedFrom: orderStatusSchema,
  // Checkbox HTML nie wysyła NIC, gdy odznaczony (a "on", gdy zaznaczony) —
  // stąd optional, a nie boolean. Brak pola = operator nie chce wysyłki.
  sendEmail: z.literal("on").optional(),
});

export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

/**
 * FormData → wejście statusChangeSchema.
 *
 * Wydzielone z akcji, bo to sklejka, w której łatwo o cichy błąd: pole
 * dodane do schematu, ale nieodczytane z formularza, nie wywala się —
 * po prostu zawsze jest undefined, a funkcja, która od niego zależy,
 * nigdy się nie wykonuje (tak przepadła pierwsza wersja wysyłki e-maili).
 * Jako funkcja czysta jest testowalna bez Next.js.
 */
export function statusChangeFromFormData(formData: FormData): unknown {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    orderId: text("orderId"),
    to: text("to"),
    expectedFrom: text("expectedFrom"),
    // Odznaczony checkbox NIE WYSTĘPUJE w FormData — undefined, nie "",
    // bo "" nie przeszłoby literału i wywróciłoby całą tranzycję.
    sendEmail: formData.get("sendEmail") ?? undefined,
  };
}

/**
 * Masowa zmiana statusu z listy (uwaga przeglądu U4).
 *
 * Zaznaczenie działa na WCZYTANEJ STRONIE, a odczyt listy ma limit 100 — stąd
 * ten sam limit tutaj: żądanie z tysiącem identyfikatorów nie pochodzi z
 * naszego ekranu i nie ma powodu go obsługiwać. Identyfikatory są ODRÓŻNIANE
 * (Set), bo ten sam wiersz dwa razy to druga, myląca odmowa „zmieniono
 * w międzyczasie" w raporcie.
 *
 * `expectedFrom` NIE przychodzi z formularza — stany bieżące akcja czyta z
 * bazy jednym zapytaniem, bo raport ma pokazywać stan FAKTYCZNY, a nie ten,
 * który przeglądarka pamięta z chwili renderu.
 */
export const BULK_STATUS_MAX = 100;

export const bulkStatusChangeSchema = z.object({
  orderIds: z
    .array(uuidSchema)
    .min(1, "Zaznacz co najmniej jedno zamówienie.")
    .max(BULK_STATUS_MAX, `Masowa zmiana obejmuje najwyżej ${BULK_STATUS_MAX} zamówień.`)
    .transform((ids) => [...new Set(ids)]),
  to: orderStatusSchema,
});

export type BulkStatusChangeInput = z.infer<typeof bulkStatusChangeSchema>;

/** FormData → wejście bulkStatusChangeSchema (wzorzec statusChangeFromFormData). */
export function bulkStatusChangeFromFormData(formData: FormData): unknown {
  return {
    orderIds: formData.getAll("orderId").filter((value) => typeof value === "string"),
    to: typeof formData.get("to") === "string" ? formData.get("to") : "",
  };
}

/**
 * Kolumny sortowalne listy (uwaga przeglądu U2). Whitelist trzyma ekran w
 * ryzach: nieznany klucz sortu spada na undefined (sort domyślny), nie na
 * błąd strony ani na `order by` po dowolnym polu z URL. Odwzorowanie klucz →
 * kolumna bazy żyje w `orders/order-sort.ts` — TU jest tylko zbiór dozwolonych
 * wartości, wspólny dla schematu i mapy sortu.
 */
export const ORDER_SORT_KEYS = ["numer", "klient", "termin", "kwota", "status", "platnosc"] as const;
export type OrderSortKey = (typeof ORDER_SORT_KEYS)[number];

export const ORDER_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type OrderSortDirection = (typeof ORDER_SORT_DIRECTIONS)[number];

/**
 * Filtry listy zamówień z searchParams. Błędna wartość jest IGNOROWANA
 * (`catch(undefined)`), nie błędem — zepsuty link nie ma wywracać listy,
 * a filtry i tak zawężają wyłącznie odczyt w obrębie RLS tenanta.
 *
 * `q` (wyszukiwarka), `sort`/`dir` (sortowanie po nagłówkach) i `preset`
 * (szybki zakres terminu) to nowe parametry przeglądu — każdy tak samo
 * odporny na śmieci: nadmiarowo długie `q` przycinamy, nieznany sort/preset
 * ignorujemy.
 */
export const ordersFilterSchema = z.object({
  status: orderStatusSchema.optional().catch(undefined),
  od: isoDateSchema.optional().catch(undefined),
  do: isoDateSchema.optional().catch(undefined),
  klient: z.string().uuid().optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .catch(undefined),
  sort: z
    .enum(ORDER_SORT_KEYS as unknown as [OrderSortKey, ...OrderSortKey[]])
    .optional()
    .catch(undefined),
  dir: z
    .enum(ORDER_SORT_DIRECTIONS as unknown as [OrderSortDirection, ...OrderSortDirection[]])
    .optional()
    .catch(undefined),
  preset: z
    .enum(DATE_PRESETS as unknown as [(typeof DATE_PRESETS)[number], ...(typeof DATE_PRESETS)[number][]])
    .optional()
    .catch(undefined),
});

export type OrdersFilter = z.infer<typeof ordersFilterSchema>;

/**
 * Rozliczenia kaucji (Zadanie 5). Lustro CHECK-a
 * deposit_events_structured_reason z 0011 — bramką jest baza (trigger
 * deposit_events_gate + CHECK, ADR-026), schematy dają czytelny komunikat
 * zanim żądanie do niej dotrze.
 */
export const DEDUCTION_REASON_CODES = [
  "damage",
  "late_return",
  "missing_part",
  "cleaning",
  "other",
] as const;
export type DeductionReasonCode = (typeof DEDUCTION_REASON_CODES)[number];

/** Kwota z pola formularza → grosze; zero i śmieci odrzucone, nie zgadywane. */
const depositAmountSchema = z.string().transform((raw, ctx) => {
  const grosze = parseMajorToGrosze(raw);
  if (grosze === null || grosze <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Podaj dodatnią kwotę (np. 100 lub 100,50)." });
    return z.NEVER;
  }
  return grosze;
});

export const depositCollectSchema = z
  .object({ orderId: uuidSchema, amount: depositAmountSchema })
  .transform((form) => ({ orderId: form.orderId, amountGrosze: form.amount }));

export const depositRefundSchema = depositCollectSchema;

export const depositDeductSchema = z
  .object({
    orderId: uuidSchema,
    amount: depositAmountSchema,
    reasonCode: z.enum(DEDUCTION_REASON_CODES, {
      error: () => "Wybierz powód potrącenia.",
    }),
    reason: optionalTextSchema(500),
  })
  // Lustro zależności warunkowej z 0011: kod 'other' bez doprecyzowania
  // jest pusty informacyjnie — dokładnie anty-wzorzec notatki tekstowej.
  .refine((form) => form.reasonCode !== "other" || form.reason !== null, {
    message: "Powód „inny” wymaga doprecyzowania.",
    path: ["reason"],
  })
  .transform((form) => ({
    orderId: form.orderId,
    amountGrosze: form.amount,
    reasonCode: form.reasonCode,
    reason: form.reason,
  }));

export type DepositDeductInput = z.infer<typeof depositDeductSchema>;

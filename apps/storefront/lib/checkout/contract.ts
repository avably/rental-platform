/**
 * KONTRAKT publicznego checkoutu — jedyne źródło prawdy dla sesji frontowej
 * budującej katalog/koszyk/formularz (Zadanie 2.4b).
 *
 * `submitCheckout` NIGDY nie zwraca danych wrażliwych najemcy (adres powiadomień,
 * konfiguracja nadawcy e-maili) ani szczegółów błędu bazy — wyłącznie status i
 * PODSUMOWANIE zamówienia klienta (to jego własne dane). Kontekst wysyłki
 * e-maili z RPC (notify_email, email_sender) jest konsumowany po stronie serwera
 * i nie przekracza tej granicy — jak w dawnym kontrakcie waitlisty, to bramka,
 * nie konwencja nazewnicza.
 */

/** Metody dostawy — lustro CHECK orders.delivery_method (0007) i DeliveryMethod z @avably/core. */
export const CHECKOUT_DELIVERY_METHODS = ["pickup", "courier", "parcel_locker", "own_delivery"] as const;
export type CheckoutDeliveryMethod = (typeof CHECKOUT_DELIVERY_METHODS)[number];

/**
 * Metody płatności — lustro CHECK orders.payment_method (0029).
 *
 * TOR OFFLINE JEST TRWAŁY, NIE AWARYJNY (ADR-066): `transfer` i `cod` są
 * w tym zbiorze na równych prawach z `online` i nie znikają z niego nigdy —
 * ani gdy najemca ma pełne KYC, ani gdy dostawca ma awarię. Jedyną metodą,
 * która bywa niedostępna, jest `online`.
 */
export const CHECKOUT_PAYMENT_METHODS = ["online", "transfer", "cod"] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

/** Metody, które są dostępne ZAWSZE — niezależnie od stanu integracji. */
export const CHECKOUT_OFFLINE_PAYMENT_METHODS = ["transfer", "cod"] as const;

/** Pozycja koszyka. Egzemplarz przypisuje SERWER — klient podaje model + ilość. */
export interface CheckoutItemInput {
  productId: string;
  quantity: number;
}

/**
 * Wejście akcji. Obiekt zwykły (nie FormData) — serializowalny, bo przechodzi
 * granicę klient→serwer Server Action. `tenantId` NIE jest polem: serwer bierze
 * go z nagłówka `x-tenant-id` (anty-spoofing middleware, ADR-039), nie z klienta.
 *
 * Kwoty NIE występują w wejściu — cenę liczy serwer (app.public_checkout).
 * `honeypot` musi być puste (pole-pułapka na boty). `captchaToken` weryfikowany
 * serwerowo po walidacji (Turnstile, ADR-032).
 */
export interface CheckoutInput {
  email: string;
  fullName: string;
  startDate: string; // ISO YYYY-MM-DD, zakres INCLUSIVE
  endDate: string;
  deliveryMethod: CheckoutDeliveryMethod;
  /**
   * Wybór klienta: płacę teraz online czy rozliczam się z wypożyczalnią.
   * To DANE ZAMÓWIENIA (kolumna `orders.payment_method`), nie stan sesji —
   * operator musi znać tę deklarację także za tydzień, bez przeglądarki.
   */
  paymentMethod: CheckoutPaymentMethod;
  /** Wymagane WYŁĄCZNIE gdy deliveryMethod = 'pickup'. */
  pickupLocationId?: string | undefined;
  items: CheckoutItemInput[];
  /** Musi być `true`; każda inna wartość to validation_error (pole "terms"). */
  termsAccepted: boolean;
  /** Wersja zaakceptowanego regulaminu (utrwalana na zamówieniu, ADR-042). */
  termsVersion: string;
  phone?: string | undefined;
  companyName?: string | undefined;
  nip?: string | undefined;
  addressStreet?: string | undefined;
  addressZip?: string | undefined;
  addressCity?: string | undefined;
  locale?: "pl" | "en" | undefined;
  notes?: string | undefined;
  /**
   * Pola własne najemcy (C6-A3, ADR-121) — JEDNA PŁASKA MAPA `id definicji →
   * wartość`, dokładnie taka, jaką wystawia `custom_fields` w katalogu.
   *
   * Płaska, choć w bazie kolumny są dwie (`orders` i `customers`): encję
   * wybiera DEFINICJA, nie wołający. Gdyby przysyłał ją klient, wystarczyłoby
   * podać cudzą encję, żeby ominąć filtr encji w triggerze 0057 — a konsument
   * API i tak nie ma powodu wiedzieć, w której tabeli wartość wyląduje.
   *
   * Wartości wolno przysłać TYPOWANE (liczba jako liczba, checkbox jako bool
   * — tak robi konsument JSON-owy) albo STRINGIEM (tak robi formularz
   * i wtyczka WordPress, gdzie wszystko przychodzi z `$_POST`). Obie drogi
   * kończą się tą samą walidacją.
   */
  customFields?: Record<string, string | number | boolean> | undefined;
  captchaToken?: string | undefined;
  /** Pole-pułapka: wypełnione = bot. Musi zostać puste. */
  honeypot?: string | undefined;
}

/**
 * Klucz błędu pola własnego. Ten sam prefiks co nazwy pól formularza w panelu
 * (`cf_<id>`) — konsument nie musi znać dwóch konwencji, a prefiks gwarantuje
 * brak kolizji z zamkniętą listą pól kontraktu.
 */
export type CheckoutCustomFieldKey = `cf_${string}`;

/** Pola formularza — klucze mapy błędów walidacji. */
export type CheckoutField =
  | CheckoutCustomFieldKey
  /**
   * Odmowa dotycząca CAŁEJ mapy pól własnych (przekroczony rozmiar kolumny)
   * — nie ma pojedynczego pola, pod które mogłaby trafić.
   */
  | "customFields"
  | "email"
  | "fullName"
  | "startDate"
  | "endDate"
  | "deliveryMethod"
  | "pickupLocationId"
  | "paymentMethod"
  | "items"
  | "terms"
  | "phone"
  | "companyName"
  | "nip"
  | "addressStreet"
  | "addressZip"
  | "addressCity"
  | "locale";

/**
 * Typ błędu per pole (LP mapuje na własny komunikat w swoim języku):
 *   required    — puste/brakujące, a wymagane (także brak akceptacji regulaminu),
 *   invalid     — wartość spoza zbioru / zły format / zakres dat odwrócony,
 *   too_long    — przekroczona długość,
 *   not_allowed — pole tam, gdzie nie ma prawa wystąpić.
 */
export type CheckoutFieldError = "required" | "invalid" | "too_long" | "not_allowed";
export type CheckoutFieldErrors = Partial<Record<CheckoutField, CheckoutFieldError>>;

/** Waluta zamówienia — lustro plans/tenant_settings.currency. */
export type CheckoutCurrency = "PLN" | "EUR" | "USD";

/** Podsumowanie pozycji (kwoty per sztuka; ilość × sztuka = linia). */
export interface CheckoutSummaryItem {
  productId: string;
  quantity: number;
  unitRentalGrosze: number;
  unitDepositGrosze: number;
}

/** Podsumowanie zamówienia zwracane klientowi (jego własne dane). */
export interface CheckoutOrderSummary {
  orderNumber: string;
  orderStatus: "pending";
  /**
   * ZAWSZE `unpaid` — i to nie jest uproszczenie kontraktu, tylko granica
   * zaufania (ADR-049). Zamówienie wychodzi z tej akcji nieopłacone także
   * wtedy, gdy klient za sekundę zapłaci kartą: o pobraniu środków wolno
   * twierdzić dopiero po ODCZYCIE u dostawcy, a ten odczyt robi webhook (Z4).
   * `paid` nie jest tu reprezentowalne, więc nie da się go przypadkiem
   * przekazać do widoku.
   */
  paymentStatus: "unpaid";
  /** Wybór klienta, utrwalony na zamówieniu (0029). */
  paymentMethod: CheckoutPaymentMethod;
  startDate: string;
  endDate: string;
  deliveryMethod: CheckoutDeliveryMethod;
  totalRentalGrosze: number;
  totalDepositGrosze: number;
  deliveryGrosze: number;
  currency: CheckoutCurrency;
  items: CheckoutSummaryItem[];
}

/**
 * Wynik akcji. Zamknięty zbiór — LP obsługuje każdy wariant jawnie:
 *
 *   success          → zamówienie złożone; `order` = podsumowanie do ekranu
 *                      potwierdzenia. `nextStep` mówi, DOKĄD idzie klient:
 *                      `confirmation` (obieg offline — koniec ścieżki) albo
 *                      `payment` (krok płatności online). To pole niesie
 *                      wyłącznie NAWIGACJĘ, nigdy stanu płatności.
 *                      `emailIssues` (opcjonalne) = powody
 *                      niewysłania e-maili — zamówienie ISTNIEJE mimo to
 *                      (wysyłka nigdy nie blokuje utworzenia). Stringi NIE
 *                      zawierają adresów odbiorców (budowane po naszej stronie).
 *   validation_error → komunikaty per pole z mapy `fields`
 *   unavailable      → egzemplarz zajęty (wyścig / nieaktualny koszyk, 23P01);
 *                      LP odświeża dostępność i prosi o ponowny wybór
 *   rejected         → serwer odrzucił dane jako niespójne (22023) albo bramka
 *                      anty-bot (honeypot); LP pokazuje ogólny błąd
 *   rate_limited     → za dużo prób z tego IP
 *   captcha_failed   → weryfikacja Turnstile odmówiła (ADR-032); LP resetuje widget
 *   payment_unavailable → klient wybrał płatność online, a serwer ODCZYTAŁ
 *                      u dostawcy, że konto najemcy nie przyjmuje płatności.
 *                      Zamówienie NIE POWSTAŁO. To nie jest awaria: klient
 *                      wraca do formularza z torem offline (ADR-066), który
 *                      jest pełnoprawną drogą do tej samej rezerwacji.
 *   server_error     → błąd nieoczekiwany / brak kontekstu tenanta
 */
export type CheckoutResult =
  | {
      status: "success";
      order: CheckoutOrderSummary;
      nextStep: "confirmation" | "payment";
      emailIssues?: string[];
    }
  | { status: "validation_error"; fields: CheckoutFieldErrors }
  | { status: "unavailable" }
  | { status: "rejected" }
  | { status: "rate_limited" }
  | { status: "captcha_failed" }
  | { status: "payment_unavailable" }
  | { status: "server_error" };

export type CheckoutStatus = CheckoutResult["status"];

// ---------------------------------------------------------------------
// Katalog i dostępność (odczyt publiczny — app.get_public_catalog /
// app.get_public_availability). Kształt lustrzany do jsonb tych funkcji.
// ---------------------------------------------------------------------

export interface PublicPricingTier {
  tier_days: number;
  multiplier: number;
  label: string | null;
}

export interface PublicProductImage {
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
}

/**
 * Definicja pola własnego w kształcie PUBLICZNYM (C6-A3, ADR-121) — ściśle
 * węższym od wiersza `custom_field_definitions`.
 *
 * Czego tu NIE MA i dlaczego: flag widoczności (funkcja `get_public_custom_fields`
 * zwraca wyłącznie pola oznaczone „zamawianie", więc flaga byłaby stałą),
 * `archived_at` (zarchiwizowane nie wychodzą w ogóle) i `created_at` (moment
 * konfiguracji sklepu nie jest sprawą kupującego). KOLEJNOŚĆ niesie sama
 * tablica — baza sortuje ją tak samo jak panel i umowa PDF.
 */
export interface PublicCustomField {
  id: string;
  /** `customer` / `order` do wypełnienia, `product` do opisania wartości w katalogu. */
  entity: string;
  field_type: string;
  label: string;
  help_text: string | null;
  required: boolean;
  options: unknown;
}

/** Mapa `id definicji → wartość` — kształt kolumny `custom_fields`. */
export type PublicCustomFieldValues = Record<string, string | number | boolean>;

/**
 * Kategoria katalogu w kształcie PUBLICZNYM (ADR-155) — węższym od wiersza
 * `catalog_categories`: bez znaczników czasu, bo moment porządkowania oferty
 * nie jest sprawą kupującego.
 *
 * `position` wychodzi mimo posortowanej tablicy ŚWIADOMIE: konsument API
 * (wtyczka, integrator) scala kategorie z własnym menu i potrzebuje wagi, a
 * nie tylko kolejności w tej jednej odpowiedzi.
 */
export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
}

export interface PublicCatalogProduct {
  id: string;
  name: string;
  description: string | null;
  base_price_day_grosze: number;
  deposit_grosze: number;
  auto_increment_multiplier: number;
  buffer_before_days: number;
  buffer_after_days: number;
  /** Wartości pól własnych PRODUKTU oznaczonych „zamawianie" (odczyt). */
  custom_fields: PublicCustomFieldValues;
  /**
   * Identyfikatory kategorii produktu (ADR-155) w kolejności KATEGORII, nie
   * przypisania — pierwsza pozycja jest tą najwyżej postawioną przez najemcę.
   * Same identyfikatory, bo pełne obiekty stoją raz, w `PublicCatalog.categories`.
   */
  category_ids: string[];
  pricing_tiers: PublicPricingTier[];
  images: PublicProductImage[];
}

export interface PublicPickupLocation {
  id: string;
  name: string;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
}

export interface PublicDeliveryMethod {
  method: CheckoutDeliveryMethod;
  price_grosze: number;
  free_above_grosze?: number | null;
}

export interface PublicCatalog {
  tenant: { name: string; locale: "pl" | "en"; currency: CheckoutCurrency };
  /** Pola własne widoczne w zamawianiu — wszystkie trzy encje (patrz `entity`). */
  custom_fields: PublicCustomField[];
  /**
   * Kategorie katalogu najemcy w JEGO kolejności (ADR-155). Kategoria bez
   * produktów też tu jest — operator ją założył, a strona kategorii ma
   * pokazać „pusto", nie 404.
   */
  categories: PublicCategory[];
  products: PublicCatalogProduct[];
  pickup_locations: PublicPickupLocation[];
  delivery_methods: PublicDeliveryMethod[];
}

/**
 * KOPERTA WĄSKIEGO ODCZYTU JEDNEJ POZYCJI (0084, ADR-185) — kształt lustrzany
 * do `app.get_public_product`.
 *
 * Niesie ROZSTRZYGNIĘCIE ADRESU razem z pozycją, bo trasa sprzętu musi umieć
 * trzy odpowiedzi naraz (ADR-182): adres bieżący → render, adres stary → 308,
 * adres nieznany → 404. Rozdzielenie tego na dwa odczyty przywróciłoby drugą
 * podróż do bazy, czyli dokładnie ten koszt, który ADR-185 znosi.
 *
 * `product` jest niepuste WYŁĄCZNIE przy `match === "current"` — i to jest
 * jedyny stan, w którym wolno cokolwiek wyrenderować.
 */
export type PublicProductMatch = "current" | "redirect" | "none";

export interface PublicProductEnvelope {
  match: PublicProductMatch;
  /** Adres BIEŻĄCY pozycji: kanon przy `current`, cel 308 przy `redirect`. */
  slug: string | null;
  tenant: { name: string; locale: "pl" | "en"; currency: CheckoutCurrency };
  /** Definicje pól własnych — te same, co w kopercie katalogu. */
  custom_fields: PublicCustomField[];
  product: PublicCatalogProduct | null;
}

/** Kształt dostępności: WYŁĄCZNIE liczby — bez numerów seryjnych / cudzych zamówień. */
export interface PublicAvailability {
  available_units: number;
  total_units: number;
}

/**
 * Dostępność JEDNEJ pozycji katalogu w zadanym terminie (0081, ADR-179).
 * `product_id` jest ETYKIETĄ liczby — identyfikatory pozycji są publiczne od
 * 0020 (`get_public_catalog`), a bez nich liczba nie trafiłaby na właściwy kafel.
 */
export interface PublicCatalogAvailabilityEntry extends PublicAvailability {
  product_id: string;
}

/** Dostępność CAŁEGO katalogu w jednym odczycie (0081, ADR-179). */
export interface PublicCatalogAvailability {
  products: PublicCatalogAvailabilityEntry[];
}

/**
 * Dostępność DZIENNA jednego sprzętu (0081, ADR-179): mapa `YYYY-MM-DD` →
 * liczba wolnych sztuk. `total_units` stoi na zewnątrz mapy, bo liczba sztuk
 * sprzętu nie zależy od dnia.
 */
export interface PublicAvailabilityDays {
  total_units: number;
  days: Record<string, number>;
}

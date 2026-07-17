/**
 * KONTRAKT waitlisty — jedyne źródło prawdy dla sesji frontowej budującej LP.
 *
 * `joinWaitlist` NIGDY nie zwraca danych osobowych (email/phone/
 * other_equipment) ani szczegółów błędu bazy — wyłącznie status z tego pliku.
 * Powód: wartość zwracana akcji trafia do komponentu klienckiego, a stamtąd
 * bywa przekazywana do analityki. Czego akcja nie zwróci, tego analityka nie
 * wyśle — to jest bramka, nie konwencja nazewnicza.
 */

/** Pola formularza — klucze mapy błędów walidacji. */
export type WaitlistField =
  | "email"
  | "rentalType"
  | "otherEquipment"
  | "inventoryRange"
  | "currentProcess"
  | "pilotInterest"
  | "phone"
  | "consent"
  | "locale";

/**
 * Typ błędu per pole. LP mapuje go na własny komunikat w swoim języku —
 * backend nie dostarcza treści komunikatów, bo nie zna kontekstu ani
 * tłumaczeń LP.
 *
 *   required   — pole puste/brakujące, a jest wymagane (także: brak zgody,
 *                brak doprecyzowania przy rental_type = 'other'),
 *   invalid    — wartość spoza dozwolonego zbioru albo zły format e-maila,
 *   too_long   — przekroczona długość,
 *   not_allowed— pole podane tam, gdzie nie ma prawa wystąpić (telefon bez
 *                zgłoszenia do pilotażu; doprecyzowanie sprzętu przy typie
 *                innym niż 'other').
 */
export type WaitlistFieldError = "required" | "invalid" | "too_long" | "not_allowed";

export type WaitlistFieldErrors = Partial<Record<WaitlistField, WaitlistFieldError>>;

/**
 * Wynik akcji. Zamknięty zbiór — LP obsługuje każdy wariant jawnie:
 *
 *   success         → „Masz miejsce na liście"
 *   duplicate       → „Ten adres jest już na waitliście" (świadoma decyzja
 *                     produktowa: komunikat jest jawny, drobna enumeracja
 *                     zaakceptowana — patrz dokumentacja modułu)
 *   validation_error→ komunikaty per pole z mapy `fields`
 *   rate_limited    → LP traktuje jak błąd serwera
 *   disabled        → formularz wyłączony serwerowo (kill-switch)
 *   captcha_failed  → weryfikacja Turnstile odmówiła (ADR-032); LP pokazuje
 *                     komunikat i resetuje widget (token jest jednorazowy)
 *   server_error    → „Nie udało się przyjąć zapisu…"
 */
export type WaitlistResult =
  | { status: "success" }
  | { status: "duplicate" }
  | { status: "validation_error"; fields: WaitlistFieldErrors }
  | { status: "rate_limited" }
  | { status: "disabled" }
  | { status: "captcha_failed" }
  | { status: "server_error" };

export type WaitlistStatus = WaitlistResult["status"];

export const RENTAL_TYPES = [
  "tools_construction",
  "event",
  "sports_outdoor",
  "machinery",
  "other",
] as const;

export const INVENTORY_RANGES = ["r1_20", "r21_100", "r101_500", "r500_plus", "launching"] as const;

export const CURRENT_PROCESSES = [
  "calendar_spreadsheet",
  "messages_phone",
  "internal_tool",
  "none",
] as const;

export type RentalType = (typeof RENTAL_TYPES)[number];
export type InventoryRange = (typeof INVENTORY_RANGES)[number];
export type CurrentProcess = (typeof CURRENT_PROCESSES)[number];

/**
 * Wejście akcji. Obiekt zwykły (nie FormData) — musi być serializowalny,
 * bo przechodzi granicę klient→serwer Server Action.
 *
 * `consent` MUSI być `true`; każda inna wartość to validation_error i zapis
 * nie następuje. `source`/`campaign` to UTM — treść nie jest walidowana
 * (dane marketingowe, nie sterujące), tylko przycinana co do długości.
 */
export interface WaitlistInput {
  email: string;
  rentalType: RentalType;
  inventoryRange: InventoryRange;
  currentProcess: CurrentProcess;
  consent: boolean;
  otherEquipment?: string | undefined;
  pilotInterest?: boolean | undefined;
  phone?: string | undefined;
  locale?: "pl" | "en" | undefined;
  source?: string | undefined;
  campaign?: string | undefined;
  /**
   * Token Cloudflare Turnstile (ADR-032). Weryfikowany serwerowo po
   * walidacji, przed zapisem. Z ustawionym TURNSTILE_SECRET_KEY brak/zły
   * token = `captcha_failed` (fail-closed); bez sekretu weryfikacja jest
   * JAWNIE wyłączona (dev bez kluczy) — patrz @avably/security/turnstile.
   */
  captchaToken?: string | undefined;
}

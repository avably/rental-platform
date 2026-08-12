/**
 * Wspólny kształt stanu akcji formularzy katalogu (useActionState).
 *
 * `fieldErrors` jest kluczowane nazwą pola formularza — komponent wiąże
 * komunikat z polem przez aria-describedby/aria-invalid, zamiast pokazywać
 * jedną zbiorczą linię, z którą czytnik ekranu nie wiąże żadnego pola.
 */
import type { z } from "zod";

export interface FormState {
  formError?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
  /**
   * Komunikat NEUTRALNY — ani sukces, ani porażka.
   *
   * Istnieje dla operacji, których wynik jest u kogoś innego i jeszcze nie
   * przyszedł: zwrot kaucji przyjęty przez dostawcę, ale niepotwierdzony
   * odczytem (Z5, ADR-069). Bez tego pola taki stan musiałby udać jedno
   * z dwóch — „sukces" kłamałby o pieniądzach klienta, a „błąd" kazałby
   * operatorowi zlecić DRUGI zwrot tej samej kaucji.
   */
  notice?: string;
  /**
   * ECHO wpisanych wartości — to, co operator miał w polach w chwili
   * nieudanego zapisu (U9, audyt UX 6.1).
   *
   * Pole jest OPCJONALNE i addytywne świadomie: ten sam `FormState` konsumują
   * wszystkie formularze panelu, a zmiana sygnatury wywróciłaby je wszystkie
   * naraz. Formularz, który echa nie czyta, zachowuje się jak przedtem.
   *
   * Istnieje, bo pola panelu są NIEKONTROLOWANE (`defaultValue` z bazy). Dopóki
   * strona jest zhydratowana, React zostawia wpisany tekst w DOM-ie i problemu
   * nie widać — ale pełny obieg dokumentu (brak hydracji, odświeżenie, powrót)
   * renderuje formularz od nowa ZE STANU BAZY i kasuje pracę operatora. Stan
   * akcji jest jedynym miejscem, które ten obieg przeżywa, więc wartości muszą
   * wracać właśnie tędy.
   *
   * NIGDY nie niesie pól tylko do zapisu (hasła, sekrety) — patrz `formEcho`.
   */
  values?: Record<string, string>;
}

/**
 * Pola, których echo NIE ODTWARZA NIGDY, niezależnie od formularza.
 *
 * Sekrety są w tym repo write-only (ADR-052): aplikacja nie czyta hasła
 * kuriera nawet z bazy, więc tym bardziej nie ma prawa odbić go z powrotem
 * do HTML-a po nieudanym zapisie. Lista jest wspólna, a nie przekazywana przez
 * wołającego, właśnie dlatego, że pojedynczy formularz może o niej zapomnieć —
 * a zapomnienie kończy się hasłem w źródle strony.
 *
 * Nowe pole tylko do zapisu w dowolnym formularzu panelu dopisujemy TUTAJ.
 */
export const WRITE_ONLY_FIELD_NAMES = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordConfirm",
  "secret",
  "token",
  "apiKey",
] as const;

/**
 * Wejście formularza → echo do `FormState.values`, z odsianiem pól tylko do
 * zapisu. Puste stringi zostają: „skasowałem tę wartość" to też praca
 * operatora i odtworzenie jej z bazy byłoby cofnięciem jego decyzji.
 */
export function formEcho(input: Record<string, string>): Record<string, string> {
  const denied = WRITE_ONLY_FIELD_NAMES as readonly string[];
  const echo: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (denied.includes(name)) continue;
    echo[name] = value;
  }
  return echo;
}

/**
 * Stan akcji wzbogacony o echo. Sukces echa NIE dostaje: po udanym zapisie
 * ekran czyta prawdę z bazy, a odbite wejście tylko by z nią konkurowało.
 */
export function withFormEcho(state: FormState, input: Record<string, string>): FormState {
  if (state.success) return state;
  return { ...state, values: formEcho(input) };
}

/** Błędy Zod → stan formularza: pierwszy komunikat per pole + reszta zbiorczo. */
export function zodErrorToState(error: z.ZodError): FormState {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in fieldErrors)) {
      fieldErrors[field] = issue.message;
    } else if (typeof field !== "string") {
      formErrors.push(issue.message);
    }
  }

  return {
    fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
    formError: formErrors[0],
  };
}

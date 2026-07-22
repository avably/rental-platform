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

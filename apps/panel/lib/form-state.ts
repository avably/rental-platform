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

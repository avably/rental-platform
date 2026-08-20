/**
 * Walidacja samoobsługi danych organizacji (U12, ADR-225) — LUSTRO kontraktu
 * `app.update_organization` (0093): nazwa przycięta i niepusta do 200 znaków,
 * język z zamkniętego zbioru LOCALES (@avably/core = CHECK `locale in (en,pl)`
 * z 0005). Walidacja tu daje czytelny komunikat PRZY polu; autorytatywna
 * pozostaje funkcja bazy (42501 na roli, 22023 na danych).
 */
import { LOCALES } from "@avably/core";
import { z } from "zod";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * Sklejka FormData → wejście schematu. Funkcja CZYSTA, świadomie POZA plikiem
 * akcji ("use server" wolno eksportować tylko async) i wzorem
 * emailSenderInputFromFormData. Dowód mutacyjny (usunięcie odczytu któregoś
 * pola) czerwieni test, gdy pole nie jest realnie odczytane z FormData.
 */
export function organizationInputFromFormData(formData: FormData): {
  name: string;
  locale: string;
} {
  return { name: str(formData.get("name")), locale: str(formData.get("locale")) };
}

export const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Podaj nazwę organizacji.")
    .max(200, "Nazwa organizacji jest za długa (maks. 200 znaków)."),
  // Zbiór z jednego źródła (@avably/core), nie osobna lista pl/en: nowy język
  // wchodzi wtedy w jednym miejscu i nie rozjeżdża się z CHECK-iem bazy.
  locale: z
    .string()
    .refine((value) => (LOCALES as readonly string[]).includes(value), "Wybierz język z listy."),
});

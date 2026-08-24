/**
 * Walidacja nadawcy e-maili — lustro CHECK-a tenant_settings_email_sender_valid
 * (migracja 0014, ADR-033). Schemat PRODUKUJE jsonb w kształcie bazy
 * (snake_case): { name, reply_to }, gotowy do upsert-u. Walidacja U ŹRÓDŁA,
 * autorytatywna w bazie (CHECK, kod 23514).
 *
 * reply_to sprawdzamy DŁUGOŚCIĄ (3..320), nie formatem — dokładnie jak CHECK
 * 0014 i parser emailSenderFromSettings; czy skrzynka istnieje, weryfikuje
 * dostawca przy wysyłce.
 *
 * BLOKER reply_to (ADR-241, uwaga właściciela). W BAZIE reply_to zostaje
 * OPCJONALNE — CHECK 0014 i ścieżki wysyłki (ADR-036 D2, ADR-042) świadomie
 * tolerują jego brak, a wiersze zapisane wcześniej bez adresu wciąż czytają się
 * i wysyłają. Ale PANEL od teraz WYMAGA adresu odpowiedzi przy każdym zapisie
 * nadawcy: bez niego odpowiedzi klientów wracają na ogólny adres platformy i
 * mogą do operatora nie dotrzeć („nie chcemy, żeby maile ginęły"). To reguła
 * produktowa NA PANELU (surowsza niż baza), nie zmiana kontraktu bazy ani
 * mechaniki wysyłki. Formularz podpowiada adres z konta operatora (prefill),
 * więc spełnienie bramki to jedno kliknięcie.
 */
import { z } from "zod";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * Sklejka FormData → wejście schematu. Funkcja CZYSTA, świadomie POZA plikiem
 * akcji ("use server" wolno eksportować tylko async) i wzorem
 * statusChangeFromFormData z 8b. Dowód mutacyjny (usunięcie odczytu replyTo)
 * czerwieni test, gdy pole nie jest realnie odczytane.
 */
export function emailSenderInputFromFormData(formData: FormData): {
  name: string;
  replyTo: string;
} {
  return { name: str(formData.get("name")), replyTo: str(formData.get("replyTo")) };
}

export const emailSenderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Podaj nazwę nadawcy.")
      .max(120, "Nazwa nadawcy jest za długa (maks. 120 znaków)."),
    replyTo: z
      .string()
      .trim()
      .min(1, "Podaj adres odpowiedzi — na niego trafią wiadomości od klientów.")
      .min(3, "Adres odpowiedzi jest za krótki (min. 3 znaki).")
      .max(320, "Adres odpowiedzi jest za długi (maks. 320 znaków)."),
  })
  .transform((sender) => ({
    name: sender.name,
    reply_to: sender.replyTo,
  }));

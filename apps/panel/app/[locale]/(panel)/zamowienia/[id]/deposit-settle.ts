/**
 * Rozliczenie kaucji JEDNYM ruchem: potrącenie i zwrot w tym samym modalu
 * (uwagi właściciela D7 i N5).
 *
 * ================== DLACZEGO JEDEN FORMULARZ, A NIE DWA ==================
 *
 * Poprzedni ekran miał trzy równorzędne kafle (pobranie, zwrot, potrącenie)
 * i wymuszał na operatorze arytmetykę: żeby oddać kaucję pomniejszoną
 * o szkodę, trzeba było zarejestrować potrącenie, spojrzeć na nowe saldo
 * i dopiero potem zlecić zwrot. Dwa osobne żądania na jedną decyzję to dwa
 * miejsca, w których można się zatrzymać w połowie — a połowa tej decyzji
 * (potrącenie bez zwrotu) wygląda w rejestrze jak zabrana kaucja.
 *
 * Tu decyzja jest JEDNA: „ile zatrzymujemy i dlaczego", a kwota zwrotu jest
 * jej KONSEKWENCJĄ, nie osobnym wejściem. Stąd `refundAfterDeduction`
 * — czysta funkcja liczona wyłącznie w GROSZACH (int), bez ani jednego
 * przejścia przez złotówki: kwota zwrotu wyprowadzona z odejmowania na
 * liczbach zmiennoprzecinkowych potrafi rozminąć się z saldem o grosz,
 * a wtedy „zwróć resztę" zostawia w rejestrze resztę nie do rozliczenia.
 *
 * ZERO NOWYCH KOLUMN. Potrącenie to nadal wiersz `deducted` w rejestrze
 * (0007/0011: kod powodu + doprecyzowanie), zwrot to nadal wiersz
 * `refunded`. Zmienia się WYŁĄCZNIE liczba formularzy, którymi operator
 * je wywołuje.
 */
import { z } from "zod";

import { parseMajorToGrosze } from "@/lib/money-input";
import { DEDUCTION_REASON_CODES, uuidSchema } from "@/lib/order-validation";

/**
 * Ile realnie wraca do klienta po zatrzymaniu potrącenia — W GROSZACH.
 *
 * Ujemny wynik jest ścinany do zera, a nie zgłaszany: nadmiarowe potrącenie
 * odrzuca autorytatywnie bramka 0011 (`deposit_events_gate`) przy zapisie,
 * i to ona ma o tym mówić. Ta funkcja liczy PODGLĄD dla operatora oraz
 * domyślną kwotę pola — jej zadaniem jest nie kłamać, nie orzekać.
 */
export function refundAfterDeduction(balanceGrosze: number, deductionGrosze: number): number {
  return Math.max(balanceGrosze - deductionGrosze, 0);
}

/**
 * Kwota nieobowiązkowa: puste pole to ZERO, a nie błąd.
 *
 * Zero jest tu legalną wartością obu pól z osobna („zwrot bez potrącenia"
 * i „potrącenie całości bez zwrotu"), ale nie obu naraz — tego pilnuje
 * `superRefine` niżej. Śmieci nadal są odrzucane, nie zgadywane (wzorzec
 * `depositAmountSchema` z order-validation.ts).
 */
const optionalAmountSchema = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const grosze = parseMajorToGrosze(trimmed);
  if (grosze === null || grosze < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Podaj kwotę w formacie 100 albo 100,50.",
    });
    return z.NEVER;
  }
  return grosze;
});

/**
 * Saldo, które ekran POKAZAŁ operatorowi w chwili decyzji — w GROSZACH.
 *
 * To nie jest kwota do wpisania, tylko PRZESŁANKA decyzji: pole ukryte,
 * przekazywane bramce `deposit_events_gate` (0034, ADR-072). Rozliczenie
 * wchodzi do rejestru wyłącznie wtedy, gdy rejestr NADAL pokazuje tę liczbę,
 * więc drugie żądanie dwukliku — deklarujące saldo sprzed pierwszego — odpada.
 * Bez tego dwa równoległe potrącenia po 300 zł z kaucji 1000 zł księgowały się
 * OBA: obie kwoty mieszczą się w pobraniu, więc niezmiennik 0011 nie miał
 * czego odrzucić.
 *
 * BRAK POLA JEST BŁĘDEM, NIE POMINIĘCIEM. Żądanie bez deklaracji przeszłoby
 * bramkę bez sprawdzenia — cichy obieg wokół zabezpieczenia pieniędzy to
 * dokładnie ten kierunek pomyłki, który 0031 wybrał raz przy `provider`.
 *
 * Grosze jako liczba całkowita, bez przecinka i bez przejścia przez złotówki:
 * ta liczba ma być RÓWNA saldu w rejestrze co do grosza, a nie „mniej więcej".
 */
const declaredBalanceSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Ekran nie podał salda kaucji — odśwież stronę i spróbuj ponownie.")
  .transform((raw) => Number.parseInt(raw, 10))
  .refine(Number.isSafeInteger, "Saldo kaucji poza zakresem — odśwież stronę.");

/** Puste → null (lustro optionalTextSchema z order-validation.ts). */
const optionalReasonSchema = z
  .string()
  .trim()
  .max(500, "Maksymalnie 500 znaków.")
  .transform((value) => (value === "" ? null : value));

/**
 * Wejście modalu rozliczenia. Powód potrącenia jest wymagany dopiero wtedy,
 * gdy potrącenie ma kwotę — lustro CHECK-a `deposit_events_structured_reason`
 * z 0011, który tego samego wymaga po stronie bazy. Kod bez kwoty jest
 * IGNOROWANY (nie powstaje żaden wiersz `deducted`), bo operator mógł
 * rozwinąć sekcję potrącenia i się rozmyślić.
 */
export const depositSettleSchema = z
  .object({
    orderId: uuidSchema,
    /** Przesłanka decyzji — saldo z ekranu, sprawdzane przez bramkę 0034. */
    balanceGrosze: declaredBalanceSchema,
    refundAmount: optionalAmountSchema,
    deductAmount: optionalAmountSchema,
    deductReasonCode: z.string(),
    deductReason: optionalReasonSchema,
    /** Opis zwrotu od operatora → `deposit_events.reason` wiersza zwrotu. */
    refundNote: optionalReasonSchema,
  })
  .superRefine((form, ctx) => {
    if (form.refundAmount === 0 && form.deductAmount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refundAmount"],
        message: "Podaj kwotę zwrotu albo potrącenia — inaczej nie ma czego rozliczać.",
      });
      return;
    }
    if (form.deductAmount === 0) return;

    if (!(DEDUCTION_REASON_CODES as readonly string[]).includes(form.deductReasonCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deductReasonCode"],
        message: "Wybierz powód potrącenia.",
      });
      return;
    }
    if (form.deductReasonCode === "other" && form.deductReason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deductReason"],
        message: "Powód „inny” wymaga doprecyzowania.",
      });
    }
  })
  .transform((form) => ({
    orderId: form.orderId,
    balanceGrosze: form.balanceGrosze,
    refundGrosze: form.refundAmount,
    // Potrącenie jest obecne albo go NIE MA — `null` zamiast zera z kodem
    // powodu, żeby wołający nie musiał pamiętać, że zero znaczy „pomiń".
    deduction:
      form.deductAmount > 0
        ? {
            amountGrosze: form.deductAmount,
            reasonCode: form.deductReasonCode as (typeof DEDUCTION_REASON_CODES)[number],
            reason: form.deductReason,
          }
        : null,
    refundNote: form.refundNote,
  }));

export type DepositSettleInput = z.infer<typeof depositSettleSchema>;

// Notatki zamówienia przeniosły się z pojedynczego pola do LISTY WPISÓW
// (ADR-079) — schematy i rdzeń mieszkają teraz w notes-core.ts, akcje w
// notes-actions.ts. Kolumna orders.notes została zastąpiona tabelą
// order_notes (migracja 0039).

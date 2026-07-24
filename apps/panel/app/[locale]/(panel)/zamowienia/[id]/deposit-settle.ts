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

/**
 * Notatka zamówienia (uwaga właściciela N6). Kolumna `orders.notes` istnieje
 * od 0007 i była do tej pory WYŁĄCZNIE wyświetlana — bez migracji, bo nie ma
 * czego migrować.
 *
 * Puste pole to `null`, a nie pusty napis: „brak notatki" ma w bazie jedną
 * reprezentację, inaczej ekran musiałby rozróżniać dwa kształty tej samej
 * nieobecności.
 */
export const orderNotesSchema = z
  .object({
    orderId: uuidSchema,
    notes: z
      .string()
      .trim()
      .max(2000, "Notatka może mieć maksymalnie 2000 znaków.")
      .transform((value) => (value === "" ? null : value)),
  })
  .transform((form) => ({ orderId: form.orderId, notes: form.notes }));

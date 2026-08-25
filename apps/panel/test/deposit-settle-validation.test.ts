/**
 * Kontrakt rozliczenia kaucji z JEDNEGO modalu (uwagi właściciela D7/N5)
 * i notatki zamówienia (N6).
 *
 * Bramką pieniędzy jest baza (trigger `deposit_events_gate` z 0011, unikaty
 * z 0031/0032) i to ją sprawdza suita na żywym Supabase. Tu bronimy warstwy,
 * która ma zdążyć PRZED bazą: kształtu wejścia i arytmetyki w GROSZACH —
 * kwoty liczone na złotówkach potrafią rozminąć się z saldem o grosz, a
 * wtedy „zwróć resztę" zostawia resztę nie do rozliczenia.
 */
import { describe, expect, it } from "vitest";

import {
  depositSettleSchema,
  refundAfterDeduction,
} from "@/app/[locale]/(panel)/zamowienia/[id]/deposit-settle";

/** Poprawny UUID (wersja 4, wariant RFC) — `uuidSchema` sprawdza też te bity. */
const ORDER_ID = "11111111-2222-4333-8444-555555555555";

/** Saldo z ekranu — pole ukryte modalu, przesłanka decyzji (0034, ADR-072). */
const BALANCE_GROSZE = "50000";

const settle = (overrides: Partial<Record<string, string>> = {}) =>
  depositSettleSchema.safeParse({
    orderId: ORDER_ID,
    balanceGrosze: BALANCE_GROSZE,
    refundAmount: "",
    deductAmount: "",
    deductReasonCode: "",
    deductReason: "",
    refundNote: "",
    ...overrides,
  });

describe("refundAfterDeduction — arytmetyka podpowiedzi", () => {
  it("odejmuje w groszach, bez ani jednego przejścia przez złotówki", () => {
    // 100,00 − 33,33 = 66,67 — na floatach 100 − 33.33 daje 66.67000000000002.
    expect(refundAfterDeduction(10_000, 3_333)).toBe(6_667);
    expect(Number.isInteger(refundAfterDeduction(10_000, 3_333))).toBe(true);
  });

  it("potrącenie całości zostawia zero, nadmiar nie schodzi poniżej zera", () => {
    expect(refundAfterDeduction(50_000, 50_000)).toBe(0);
    // Podgląd nie orzeka o nadmiarze — od tego jest bramka 0011 przy zapisie.
    expect(refundAfterDeduction(50_000, 90_000)).toBe(0);
  });
});

describe("depositSettleSchema — jedna decyzja, dwa wiersze rejestru", () => {
  it("sam zwrot: potrącenia nie ma, nie jest zerem z kodem powodu", () => {
    const parsed = settle({ refundAmount: "350,00" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      orderId: ORDER_ID,
      refundGrosze: 35_000,
      deduction: null,
    });
  });

  it("zwrot z potrąceniem niesie kwotę, kod i doprecyzowanie", () => {
    // Suma zwrotu i potrącenia mieści się w saldzie (349,50 + 150,50 = 500,00
    // przy saldzie 500,00) — inaczej odbija ją clamp salda (ADR-269) niżej.
    const parsed = settle({
      refundAmount: "349,50",
      deductAmount: "150,50",
      deductReasonCode: "damage",
      deductReason: "rysa na obudowie",
      refundNote: "sprzęt kompletny",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      orderId: ORDER_ID,
      balanceGrosze: 50_000,
      refundGrosze: 34_950,
      deduction: { amountGrosze: 15_050, reasonCode: "damage", reason: "rysa na obudowie" },
      refundNote: "sprzęt kompletny",
    });
  });

  it("samo potrącenie (operator zatrzymuje całą kaucję) jest legalne", () => {
    const parsed = settle({ deductAmount: "500", deductReasonCode: "missing_part" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.refundGrosze).toBe(0);
    expect(parsed.success && parsed.data.deduction?.amountGrosze).toBe(50_000);
  });

  it("pusty modal nie jest rozliczeniem", () => {
    const parsed = settle();
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["refundAmount"]);
  });

  it("potrącenie bez powodu odbija się o kontrakt, zanim dotknie bazy", () => {
    const parsed = settle({ refundAmount: "100", deductAmount: "50" });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["deductReasonCode"]);
  });

  it("kod spoza listy 0011 jest odrzucany, nie zamieniany na „inny”", () => {
    const parsed = settle({
      refundAmount: "100",
      deductAmount: "50",
      deductReasonCode: "wymyslony",
    });
    expect(parsed.success).toBe(false);
  });

  it("powód „inny” wymaga doprecyzowania (biały znak to brak)", () => {
    const parsed = settle({
      refundAmount: "100",
      deductAmount: "50",
      deductReasonCode: "other",
      deductReason: "   ",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["deductReason"]);
  });

  it("kod powodu bez kwoty potrącenia jest ignorowany, a nie wymuszany", () => {
    // Operator rozwinął sekcję potrącenia i się rozmyślił — to nie jest błąd.
    const parsed = settle({ refundAmount: "100", deductReasonCode: "damage" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.deduction).toBeNull();
  });

  it("saldo z ekranu jedzie dalej jako PRZESŁANKA decyzji (0034)", () => {
    // Bez tej liczby bramka 0034 nie ma czego porównać, a rozliczenie samym
    // potrąceniem wraca do stanu sprzed migracji: dwuklik księguje dwa razy.
    const parsed = settle({ deductAmount: "500", deductReasonCode: "damage" });
    expect(parsed.success && parsed.data.balanceGrosze).toBe(50_000);
  });

  it("brak salda z ekranu to ODMOWA, nie ciche pominięcie bramki", () => {
    // Kierunek pomyłki wybiera się raz: żądanie bez deklaracji przeszłoby
    // przez bramkę bez sprawdzenia. Zero jest przy tym legalną deklaracją
    // (kaucja już rozliczona) — odrzucany jest BRAK, nie wartość zerowa.
    expect(settle({ balanceGrosze: "", refundAmount: "100" }).success).toBe(false);
    expect(settle({ balanceGrosze: "50 000", refundAmount: "100" }).success).toBe(false);
    expect(settle({ balanceGrosze: "500,00", refundAmount: "100" }).success).toBe(false);
    expect(settle({ balanceGrosze: "-1", refundAmount: "100" }).success).toBe(false);
    // Zero jest legalną DEKLARACJĄ salda (kaucja już rozliczona) — odrzucany jest
    // BRAK, nie wartość zerowa. Przy saldzie 0 zwrot ponad zero odbija clamp
    // salda (ADR-269), więc „0 jest legalne” dowodzimy rozliczeniem, które w to
    // saldo się mieści: samo potrącenie (nadmiar zostaje domeną bramki 0011).
    expect(
      settle({ balanceGrosze: "0", deductAmount: "100", deductReasonCode: "damage" }).success,
    ).toBe(true);
  });

  it("odmowa salda jest wiązana z POLEM salda, nie ze zbiorczą linią", () => {
    // Po tym kluczu modal poznaje, że ma pokazać zdanie o odświeżeniu ekranu,
    // a nie o kwocie — i robi to w języku operatora (messages EN+PL).
    const parsed = settle({ balanceGrosze: "", refundAmount: "100" });
    expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["balanceGrosze"]);
  });

  it("kwota ujemna i śmieci nie przechodzą", () => {
    expect(settle({ refundAmount: "-10" }).success).toBe(false);
    expect(settle({ refundAmount: "sto" }).success).toBe(false);
    // Trzecie miejsce po przecinku to ODRZUCENIE, nie zaokrąglenie.
    expect(settle({ refundAmount: "10,505" }).success).toBe(false);
  });

  // -------------------------------------------------------------------
  // Clamp salda — pierwsza linia (HIGH, Finding 1, ADR-269)
  // -------------------------------------------------------------------
  //
  // Pole zwrotu jest EDYTOWALNE. Bez tego refinementu operator nadpisujący je
  // ponad saldo wysyłał do dostawcy zwrot większy niż kaucja (część najmu!),
  // a bramka salda 0011 odrzucała go dopiero PRZY KSIĘGOWANIU — po wyjściu
  // pieniędzy. Ten refinement to najwcześniejsza z trzech warstw clampu (dalej:
  // serwerowy odczyt żywego salda w requestDepositRefund i bramka 0111 na bazie).

  describe("clamp salda: zwrot + potrącenie nie może przekroczyć salda z ekranu", () => {
    it("sam zwrot ponad saldo jest odrzucany przy POLU kwoty zwrotu", () => {
      // Saldo 500,00, zwrot 500,01 — jeden grosz ponad. Dowód nie ma się
      // opierać na wielkości nadmiaru.
      const parsed = settle({ refundAmount: "500,01" });
      expect(parsed.success).toBe(false);
      expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["refundAmount"]);
    });

    it("zwrot RÓWNY saldu przechodzi — granica jest legalna", () => {
      const parsed = settle({ refundAmount: "500,00" });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.refundGrosze).toBe(50_000);
    });

    it("zwrot plus potrącenie ponad saldo jest odrzucany, choć każde z osobna się mieści", () => {
      // DOWÓD MUTACYJNY CLAMPU: 400,00 zwrotu + 150,00 potrącenia = 550,00 przy
      // saldzie 500,00. Zwrot SAM (400) mieści się, potrącenie SAMO (150) też —
      // odbija je dopiero suma. Usunięcie refinementu → parsed.success === true.
      const parsed = settle({
        refundAmount: "400,00",
        deductAmount: "150,00",
        deductReasonCode: "damage",
      });
      expect(parsed.success).toBe(false);
      expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["refundAmount"]);
    });

    it("zwrot plus potrącenie DOKŁADNIE równe saldu przechodzi", () => {
      const parsed = settle({
        refundAmount: "350,00",
        deductAmount: "150,00",
        deductReasonCode: "damage",
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.refundGrosze).toBe(35_000);
      expect(parsed.success && parsed.data.deduction?.amountGrosze).toBe(15_000);
    });

    it("samo NADMIAROWE potrącenie (bez zwrotu) nie jest tu blokowane — to domena bramki 0011", () => {
      // refundAfterDeduction ścina podgląd do zera, a autorytatywną odmowę
      // nadmiarowego potrącenia niesie bramka 0011 przy zapisie. Ten refinement
      // dotyczy BEZPIECZEŃSTWA ZWROTU, więc przy zwrocie zerowym milczy.
      const parsed = settle({ deductAmount: "900", deductReasonCode: "damage" });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.refundGrosze).toBe(0);
      expect(parsed.success && parsed.data.deduction?.amountGrosze).toBe(90_000);
    });
  });
});

// Schematy notatek zamówienia przeniosły się do notes-core.ts (lista wpisów,
// ADR-079) — testowane w notes-validation.test.ts.

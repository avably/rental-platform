/**
 * Salda rejestru kaucji — WYGODA UI (chronologia z saldami, podpowiedzi
 * kwot, stan przycisków), nie bramka: niezmiennik sumy egzekwuje trigger
 * deposit_events_gate z 0011 dla każdej roli (ADR-026). Suma trzech
 * rodzajów zdarzeń nie jest arytmetyką najmu, więc nie należy do silnika
 * (@avably/core zostaje bez zmian — brief Zadania 5).
 *
 * Kwota jest zawsze DODATNIA, kierunek niesie `kind` (0007) — stąd jedno
 * miejsce, które tłumaczy kind na znak; nikt poza tym modułem nie sumuje
 * zdarzeń kaucji ręcznie.
 */

export interface DepositEventRow {
  id: string;
  kind: "collected" | "refunded" | "deducted";
  amount_grosze: number;
  reason_code: string | null;
  reason: string | null;
  /**
   * Obieg, w którym pieniądze się poruszyły (0031, ADR-069). W chronologii
   * rejestru to nie ozdoba: w sporze z klientem różnica między „oddaliśmy
   * gotówką" a „oddaliśmy przelewem, oto identyfikator u dostawcy" jest
   * całą różnicą między słowem a dowodem.
   */
  provider: "manual" | "stripe";
  provider_reference: string | null;
  created_at: string;
}

type DepositEventAmount = Pick<DepositEventRow, "kind" | "amount_grosze">;

export interface DepositTotals {
  /** Suma pobrań. */
  collectedGrosze: number;
  /** Suma zwrotów i potrąceń. */
  settledGrosze: number;
  /** Saldo do rozliczenia: pobrania minus zwroty i potrącenia. */
  balanceGrosze: number;
}

export function depositTotals(events: readonly DepositEventAmount[]): DepositTotals {
  let collectedGrosze = 0;
  let settledGrosze = 0;
  for (const event of events) {
    if (event.kind === "collected") collectedGrosze += event.amount_grosze;
    else settledGrosze += event.amount_grosze;
  }
  return { collectedGrosze, settledGrosze, balanceGrosze: collectedGrosze - settledGrosze };
}

/** Saldo PO każdym zdarzeniu — kolumna „Saldo" w chronologii rejestru. */
export function runningBalances(events: readonly DepositEventAmount[]): number[] {
  let balance = 0;
  return events.map((event) => {
    balance += event.kind === "collected" ? event.amount_grosze : -event.amount_grosze;
    return balance;
  });
}

/**
 * Kaucja rozliczona = było co rozliczać (pobrania > 0) i saldo wróciło
 * do zera. Pusty rejestr NIE jest rozliczeniem — nic nie pobrano.
 * Definicja z ADR-027: na tym warunku akcja panelu ustawia
 * payment_status='deposit_refunded', niezależnie od proporcji
 * zwrotów i potrąceń.
 */
export function isDepositSettled(totals: DepositTotals): boolean {
  return totals.collectedGrosze > 0 && totals.balanceGrosze === 0;
}

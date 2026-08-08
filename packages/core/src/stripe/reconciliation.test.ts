/**
 * Decyzja rekoncyliacyjna (L11, ADR-104) — czysta warstwa.
 *
 * Ta suita pilnuje TRZECH rzeczy, na których stoi poprawność pętli:
 *   1. wiek intentu liczy się Z ODCZYTU u dostawcy, nigdy z wieku rekordu,
 *   2. płatność czekająca na akcję klienta NIE jest oznaczana jako nieudana
 *      przed progiem wygaszenia — dopóki intent żyje, klient może zapłacić,
 *   3. karencja odsuwa pętlę od świeżych płatności, żeby nie wyprzedzała
 *      webhooka.
 */
import { describe, expect, it } from "vitest";

import {
  ABANDONED_INTENT_SECONDS,
  RECONCILIATION_GRACE_SECONDS,
  isCustomerActionPending,
  reconciliationCutoff,
  reconciliationDecision,
} from "./reconciliation";
import type { IntentRead } from "./types";

const EXPECTED_GROSZE = 12_345;
const EXPECTED_CURRENCY = "PLN";
const NOW = new Date("2026-08-08T12:00:00.000Z");

/** Odczyt u dostawcy; `ageSeconds` to wiek INTENTU wg dostawcy. */
function read(overrides: Partial<IntentRead> & { ageSeconds?: number } = {}): IntentRead {
  const { ageSeconds = 60, ...rest } = overrides;
  return {
    intentId: "pi_test",
    status: "succeeded",
    amountReceivedGrosze: EXPECTED_GROSZE,
    amountGrosze: EXPECTED_GROSZE,
    // Małe litery jak w odpowiedzi dostawcy — konwersję wielkości robi werdykt.
    currency: "pln",
    createdAtSeconds: Math.floor(NOW.getTime() / 1000) - ageSeconds,
    ...rest,
  };
}

describe("stałe", () => {
  it("karencja to 15 minut, próg wygaszenia to 24 godziny", () => {
    expect(RECONCILIATION_GRACE_SECONDS).toBe(15 * 60);
    expect(ABANDONED_INTENT_SECONDS).toBe(24 * 60 * 60);
  });

  it("granica wyboru zamówień cofa się o karencję od TERAZ", () => {
    // M1: karencja ustawiona na 0 sprawia, że granicą jest `now` — a wtedy
    // pętla łapie płatność sprzed sekundy i ściga się z webhookiem.
    expect(reconciliationCutoff(NOW).toISOString()).toBe("2026-08-08T11:45:00.000Z");
    expect(NOW.getTime() - reconciliationCutoff(NOW).getTime()).toBe(
      RECONCILIATION_GRACE_SECONDS * 1000,
    );
  });
});

describe("werdykt z odczytu", () => {
  it("succeeded z pokryciem kwoty → zapłacone", () => {
    expect(reconciliationDecision(read(), EXPECTED_GROSZE, EXPECTED_CURRENCY, NOW)).toMatchObject({
      action: "settle",
      status: "paid",
    });
  });

  it("succeeded w CUDZEJ walucie → brak zmiany stanu i powód (K3/ADR-103)", () => {
    // 12 345 centów EUR to nie 12 345 groszy PLN — sama liczba się zgadza,
    // waluta nie. Dokładnie mina, którą K3 zamknął w webhooku; pętla nie
    // może jej otworzyć z powrotem.
    const decision = reconciliationDecision(
      read({ currency: "eur" }),
      EXPECTED_GROSZE,
      EXPECTED_CURRENCY,
      NOW,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("walucie");
  });

  it("succeeded z NIEDOPŁATĄ → brak zmiany stanu i powód", () => {
    const decision = reconciliationDecision(
      read({ amountReceivedGrosze: EXPECTED_GROSZE - 1 }),
      EXPECTED_GROSZE,
      EXPECTED_CURRENCY,
      NOW,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("succeeded");
  });

  it("canceled u dostawcy → nieudana płatność (bez anulowania, już jest terminalny)", () => {
    expect(reconciliationDecision(read({ status: "canceled" }), EXPECTED_GROSZE, EXPECTED_CURRENCY, NOW)).toMatchObject(
      { action: "settle", status: "payment_failed" },
    );
  });

  it("processing → nie ruszamy stanu", () => {
    const decision = reconciliationDecision(read({ status: "processing" }), EXPECTED_GROSZE, EXPECTED_CURRENCY, NOW);
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("processing");
  });

  it("requires_action (3-D Secure w toku) → nie ruszamy stanu i NIE wygaszamy", () => {
    const decision = reconciliationDecision(
      read({ status: "requires_action", ageSeconds: 10 * ABANDONED_INTENT_SECONDS }),
      EXPECTED_GROSZE,
      EXPECTED_CURRENCY,
      NOW,
    );
    expect(decision.action).toBe("skip");
  });
});

describe("płatność czekająca na akcję klienta", () => {
  it.each(["requires_payment_method", "requires_confirmation"])(
    "%s rozpoznane jako czekające na klienta",
    (status) => {
      expect(isCustomerActionPending(status)).toBe(true);
    },
  );

  it.each(["succeeded", "processing", "canceled", "requires_action", "requires_capture"])(
    "%s NIE jest czekaniem na klienta",
    (status) => {
      expect(isCustomerActionPending(status)).toBe(false);
    },
  );

  it.each(["requires_payment_method", "requires_confirmation"])(
    "%s PRZED progiem 24h → zostawiamy w spokoju, klient wciąż może zapłacić",
    (status) => {
      const decision = reconciliationDecision(
        read({ status, ageSeconds: ABANDONED_INTENT_SECONDS - 1 }),
        EXPECTED_GROSZE,
        EXPECTED_CURRENCY,
        NOW,
      );
      expect(decision.action).toBe("skip");
    },
  );

  it.each(["requires_payment_method", "requires_confirmation"])(
    "%s PO progu 24h → wygaszenie (anulowanie u dostawcy przed zapisem)",
    (status) => {
      const decision = reconciliationDecision(
        read({ status, ageSeconds: ABANDONED_INTENT_SECONDS }),
        EXPECTED_GROSZE,
        EXPECTED_CURRENCY,
        NOW,
      );
      expect(decision.action).toBe("expire");
    },
  );
});

describe("granica zaufania: wiek Z ODCZYTU, nie z rekordu", () => {
  it("intent założony przed chwilą NIE wygasa, choćby zamówienie było sprzed tygodnia", () => {
    // Ten test pada, gdy decyzja zacznie patrzeć na wiek rekordu zamówienia:
    // rekord jest stary (pętla go w ogóle wybrała), ale u dostawcy płatność
    // powstała minutę temu — klient WŁAŚNIE zaczął płacić.
    const decision = reconciliationDecision(
      read({ status: "requires_payment_method", ageSeconds: 60 }),
      EXPECTED_GROSZE,
      EXPECTED_CURRENCY,
      NOW,
    );
    expect(decision.action).toBe("skip");
  });

  it("intent bez znanego czasu powstania NIE wygasa — brak dowodu to nie dowód", () => {
    const decision = reconciliationDecision(
      read({ status: "requires_payment_method", createdAtSeconds: 0 }),
      EXPECTED_GROSZE,
      EXPECTED_CURRENCY,
      NOW,
    );
    expect(decision.action).toBe("skip");
  });
});

/**
 * Maszyna stanów payment_status — DWA reżimy jednej osi (ADR-035 + ADR-064).
 * Czyste funkcje; lustro map egzekwowanych w bazie przez
 * app.payment_transition_allowed (0015 → 0027). Zgodność TS↔SQL wszystkich par
 * w OBU reżimach przypina packages/db/test/order-gates.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  canPaymentTransition,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  PAYMENT_TRANSITIONS_STRIPE,
  type PaymentStatus,
} from "./order-status";

const OPEN = ["unpaid", "pending", "paid", "manual", "completed"] as const;

describe("reżim manual — swoboda operatorska (ADR-035, niezmieniona przez 0027)", () => {
  it("każdy stan otwarty przechodzi w każdy otwarty + rozliczeniowy", () => {
    for (const from of OPEN) {
      for (const to of [...OPEN, "deposit_refunded", "refunded", "cancelled"] as const) {
        if (from === to) continue;
        expect(canPaymentTransition(from, to, "manual"), `${from}->${to}`).toBe(true);
      }
    }
  });

  it("deposit_refunded wychodzi WYŁĄCZNIE w refunded/cancelled (zero regresu do otwartych)", () => {
    expect(canPaymentTransition("deposit_refunded", "refunded", "manual")).toBe(true);
    expect(canPaymentTransition("deposit_refunded", "cancelled", "manual")).toBe(true);
    for (const to of OPEN) {
      expect(canPaymentTransition("deposit_refunded", to, "manual"), `deposit_refunded->${to}`).toBe(
        false,
      );
    }
  });

  it("refunded i cancelled są terminalne", () => {
    for (const to of PAYMENT_STATUSES) {
      expect(canPaymentTransition("refunded", to, "manual"), `refunded->${to}`).toBe(false);
      expect(canPaymentTransition("cancelled", to, "manual"), `cancelled->${to}`).toBe(false);
    }
  });

  it("payment_failed jest offline NIEOSIĄGALNY w obie strony", () => {
    // Obieg ręczny nie ma odrzuconej próby do zapisania (ADR-064). Gdyby
    // kiedyś miał — to jest zmiana reżimu manual, czyli osobna decyzja.
    for (const from of PAYMENT_STATUSES) {
      expect(canPaymentTransition(from, "payment_failed", "manual"), `${from}->payment_failed`).toBe(
        false,
      );
      expect(canPaymentTransition("payment_failed", from, "manual"), `payment_failed->${from}`).toBe(
        false,
      );
    }
  });
});

describe("reżim stripe — ścisła kolejność cyklu online (ADR-064)", () => {
  // Mapa wypisana W CAŁOŚCI, para po parze — pin niezależny od implementacji.
  // Zmiana dowolnego przejścia MUSI zapalić dokładnie ten test.
  const EXPECTED: Record<PaymentStatus, readonly PaymentStatus[]> = {
    unpaid: ["pending", "cancelled"],
    pending: ["paid", "payment_failed", "cancelled"],
    payment_failed: ["pending", "cancelled"],
    paid: ["deposit_refunded", "refunded"],
    manual: [],
    completed: [],
    deposit_refunded: ["refunded"],
    refunded: [],
    cancelled: [],
  };

  it.each(PAYMENT_STATUSES.map((from) => ({ from })))(
    "z $from wychodzą dokładnie stany z pinu — i nic poza nimi",
    ({ from }) => {
      for (const to of PAYMENT_STATUSES) {
        expect(canPaymentTransition(from, to, "stripe"), `${from}->${to}`).toBe(
          EXPECTED[from].includes(to),
        );
      }
    },
  );

  it("ZERO REGRESU Z paid: żaden stan otwarty nie jest osiągalny z paid", () => {
    // Pointa całego zadania: spóźniony albo powtórzony webhook nie cofa
    // opłaconego zamówienia.
    for (const to of OPEN) {
      expect(canPaymentTransition("paid", to, "stripe"), `paid->${to}`).toBe(false);
    }
    expect(canPaymentTransition("paid", "payment_failed", "stripe")).toBe(false);
    expect(canPaymentTransition("paid", "cancelled", "stripe")).toBe(false);
  });

  it("nieudana próba nie kończy zamówienia — payment_failed wraca w pending", () => {
    expect(canPaymentTransition("pending", "payment_failed", "stripe")).toBe(true);
    expect(canPaymentTransition("payment_failed", "pending", "stripe")).toBe(true);
  });

  it("manual i completed są poza obiegiem online", () => {
    for (const from of PAYMENT_STATUSES) {
      expect(canPaymentTransition(from, "manual", "stripe"), `${from}->manual`).toBe(false);
      expect(canPaymentTransition(from, "completed", "stripe"), `${from}->completed`).toBe(false);
    }
  });
});

describe("wspólne własności obu reżimów", () => {
  it("przejście tożsamościowe nie jest przejściem", () => {
    for (const provider of PAYMENT_PROVIDERS) {
      for (const s of PAYMENT_STATUSES) {
        expect(canPaymentTransition(s, s, provider), `${provider}: ${s}->${s}`).toBe(false);
      }
    }
  });

  it("obie mapy pokrywają każdy status kluczem", () => {
    for (const s of PAYMENT_STATUSES) {
      expect(PAYMENT_TRANSITIONS[s], `manual: brak klucza ${s}`).toBeDefined();
      expect(PAYMENT_TRANSITIONS_STRIPE[s], `stripe: brak klucza ${s}`).toBeDefined();
    }
  });

  it("reżim stripe jest OSTRZEJSZY, nie inny: każde jego przejście jest legalne też w manual", () => {
    // Kontrola kierunku zaostrzenia — poza jedynym wyjątkiem, którym jest
    // payment_failed (stan istniejący WYŁĄCZNIE w obiegu online).
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        if (from === "payment_failed" || to === "payment_failed") continue;
        if (!canPaymentTransition(from, to, "stripe")) continue;
        expect(canPaymentTransition(from, to, "manual"), `stripe pozwala ${from}->${to}, manual nie`).toBe(
          true,
        );
      }
    }
  });

  it("reżimy NIE są identyczne — granica jest obustronna", () => {
    // Kontrola po pustym zbiorze dla testu wyżej: gdyby ktoś zrównał mapy,
    // „stripe ⊆ manual" byłoby nadal zielone.
    const rozjazd = PAYMENT_STATUSES.flatMap((from) =>
      PAYMENT_STATUSES.filter(
        (to) => canPaymentTransition(from, to, "manual") !== canPaymentTransition(from, to, "stripe"),
      ).map((to) => `${from}->${to}`),
    );
    expect(rozjazd.length, "mapy reżimów są identyczne").toBeGreaterThan(0);
    expect(rozjazd, "brak kluczowej różnicy paid->pending").toContain("paid->pending");
  });
});

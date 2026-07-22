/**
 * Kontrakt zwrotu kaucji (Z5, ADR-069) — na nagranych odpowiedziach, bez
 * sieci i bez konta dostawcy.
 *
 * Trzy testy niosą tu cały ciężar dowodowy:
 *
 *   1. „zwrot w toku nie jest zwrotem" — `createDepositRefund` NIE MA JAK
 *      zwrócić statusu, więc odpowiedź `pending` nie daje się zamienić
 *      w twierdzenie o zwrocie. Test pilnuje kształtu wyniku, bo to on jest
 *      barierą (mutacja z tabeli dowodów: zapis `refunded` z odpowiedzi
 *      na POST),
 *   2. kwota tabelaryczna — liczba w `amount=` musi być IDENTYCZNA z tą,
 *      którą podał wołający. Każdy `/100` po drodze oddaje klientowi kaucję
 *      stukrotnie mniejszą, a wszystkie pozostałe testy przy takiej mutacji
 *      nadal przechodzą: refund powstaje, status jest poprawny, panel działa,
 *   3. obecność `amount` w ciele — refund BEZ kwoty jest u dostawcy refundem
 *      PEŁNYM, czyli oddaje klientowi także najem i dostawę.
 */
import { describe, expect, it } from "vitest";

import { PaymentAmountError } from "./payment-intent";
import {
  OBSERVED_REFUND_EVENTS,
  createDepositRefund,
  isObservedRefundEvent,
  readDepositRefund,
  refundVerdict,
} from "./refund";
import type { RefundRead } from "./types";

const SECRET = "sk_test_klucz_platformy";
const PUBLISHABLE = "pk_test_klucz_publiczny";
const ACCOUNT = "acct_najemcy";
const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const REQUEST_ID = "99999999-8888-7777-6666-555555555555";
const INTENT_ID = "pi_test_najmu";
const DEPOSIT_GROSZE = 50_000;

interface Recorded {
  url: string;
  init: RequestInit;
}

function transport(responses: { status: number; body: unknown }[]) {
  const calls: Recorded[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("Brak nagranej odpowiedzi na kolejne żądanie");
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function deps(fetchFn: typeof fetch) {
  return { config: { secretKey: SECRET, publishableKey: PUBLISHABLE }, fetchFn };
}

function header(call: Recorded, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

/** Ciało żądania rozłożone na pary — porównujemy WARTOŚCI, nie fragmenty stringa. */
function form(call: Recorded): URLSearchParams {
  return new URLSearchParams(String(call.init.body ?? ""));
}

function params(overrides: Partial<Parameters<typeof createDepositRefund>[0]> = {}) {
  return {
    intentId: INTENT_ID,
    amountGrosze: DEPOSIT_GROSZE,
    connectedAccountId: ACCOUNT,
    idempotencyKey: REQUEST_ID,
    orderId: ORDER_ID,
    refundRequestId: REQUEST_ID,
    ...overrides,
  };
}

function read(overrides: Partial<RefundRead> = {}): RefundRead {
  return {
    refundId: "re_test_1",
    status: "succeeded",
    amountGrosze: DEPOSIT_GROSZE,
    intentId: INTENT_ID,
    failureReason: null,
    ...overrides,
  };
}

describe("createDepositRefund — zlecenie zwrotu", () => {
  it("oddaje SAM identyfikator, także gdy dostawca zgłasza succeeded", async () => {
    // Nawet najbardziej optymistyczna odpowiedź nie daje wołającemu nic
    // poza identyfikatorem. To jest bariera z kształtu typu: nie da się
    // napisać „zwrócone" na podstawie tego wyniku, bo wynik nie niesie
    // statusu ani kwoty.
    const { fetchFn } = transport([
      { status: 200, body: { id: "re_test_1", status: "succeeded", amount: DEPOSIT_GROSZE } },
    ]);
    const result = await createDepositRefund(params(), deps(fetchFn));

    expect(result).toBe("re_test_1");
    expect(typeof result).toBe("string");
  });

  it("odpowiedź `pending` daje ten sam kształt wyniku co `succeeded`", async () => {
    // MUTACJA Z TABELI DOWODÓW: „zapisz refunded z odpowiedzi POST".
    // Ten test przypina, że obie odpowiedzi są dla wołającego
    // NIEROZRÓŻNIALNE — więc nie ma z czego zbudować rozróżnienia.
    const { fetchFn } = transport([
      { status: 200, body: { id: "re_test_2", status: "pending", amount: DEPOSIT_GROSZE } },
    ]);
    expect(await createDepositRefund(params(), deps(fetchFn))).toBe("re_test_2");
  });

  it("wysyła kwotę kaucji CO DO GROSZA, bez żadnej konwersji", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "re_test_3" } }]);
    await createDepositRefund(params({ amountGrosze: 12_345 }), deps(fetchFn));

    expect(form(calls[0]!).get("amount")).toBe("12345");
  });

  it.each([
    [1, "1"],
    [99, "99"],
    [50_000, "50000"],
    [123_456_789, "123456789"],
  ])("kwota %i groszy jedzie jako %s", async (grosze, expected) => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "re_x" } }]);
    await createDepositRefund(params({ amountGrosze: grosze }), deps(fetchFn));
    expect(form(calls[0]!).get("amount")).toBe(expected);
  });

  it("ciało ZAWSZE niesie amount — refund bez kwoty jest refundem pełnym", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "re_test_4" } }]);
    await createDepositRefund(params(), deps(fetchFn));

    const body = form(calls[0]!);
    expect(body.has("amount")).toBe(true);
    expect(body.get("payment_intent")).toBe(INTENT_ID);
  });

  it("żądanie idzie na KONTO NAJEMCY i niesie klucz idempotencji", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "re_test_5" } }]);
    await createDepositRefund(params(), deps(fetchFn));

    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/refunds");
    expect(header(calls[0]!, "Stripe-Account")).toBe(ACCOUNT);
    expect(header(calls[0]!, "Idempotency-Key")).toBe(REQUEST_ID);
  });

  it.each([0, -1, 12.5, Number.NaN])(
    "kwota %s jest odrzucana PRZED wyjściem żądania",
    async (amount) => {
      const { calls, fetchFn } = transport([]);
      await expect(
        createDepositRefund(params({ amountGrosze: amount }), deps(fetchFn)),
      ).rejects.toBeInstanceOf(PaymentAmountError);
      expect(calls).toHaveLength(0);
    },
  );

  it("brak klucza idempotencji nie wypuszcza żądania", async () => {
    const { calls, fetchFn } = transport([]);
    await expect(
      createDepositRefund(params({ idempotencyKey: "" }), deps(fetchFn)),
    ).rejects.toBeInstanceOf(PaymentAmountError);
    expect(calls).toHaveLength(0);
  });

  it("brak konta najemcy nie wypuszcza żądania", async () => {
    const { calls, fetchFn } = transport([]);
    await expect(
      createDepositRefund(params({ connectedAccountId: "" }), deps(fetchFn)),
    ).rejects.toThrow(/konta najemcy/);
    expect(calls).toHaveLength(0);
  });

  it("odpowiedź bez identyfikatora jest błędem — nie mamy o co zapytać", async () => {
    const { fetchFn } = transport([{ status: 200, body: { status: "pending" } }]);
    await expect(createDepositRefund(params(), deps(fetchFn))).rejects.toThrow(
      /identyfikatora zwrotu/,
    );
  });

  it("odmowa dostawcy niesie komunikat, nigdy klucz sekretny", async () => {
    const { fetchFn } = transport([
      {
        status: 400,
        body: {
          error: {
            type: "invalid_request_error",
            code: "charge_already_refunded",
            message: `Nie można zwrócić więcej niż pobrano (klucz ${SECRET}).`,
          },
        },
      },
    ]);
    await expect(createDepositRefund(params(), deps(fetchFn))).rejects.toThrow(/\[usunięto\]/);
  });
});

describe("readDepositRefund — jedyne źródło prawdy o zwrocie", () => {
  it("czyta refund na koncie najemcy i przepisuje pola dostawcy", async () => {
    const { calls, fetchFn } = transport([
      {
        status: 200,
        body: {
          id: "re_test_1",
          status: "succeeded",
          amount: DEPOSIT_GROSZE,
          payment_intent: INTENT_ID,
        },
      },
    ]);
    const result = await readDepositRefund("re_test_1", {
      ...deps(fetchFn),
      connectedAccountId: ACCOUNT,
    });

    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/refunds/re_test_1");
    expect(header(calls[0]!, "Stripe-Account")).toBe(ACCOUNT);
    expect(result).toEqual({
      refundId: "re_test_1",
      status: "succeeded",
      amountGrosze: DEPOSIT_GROSZE,
      intentId: INTENT_ID,
      failureReason: null,
    });
  });

  it("brak kwoty w odpowiedzi to ZERO, nie kwota, o którą prosiliśmy", async () => {
    const { fetchFn } = transport([{ status: 200, body: { id: "re_test_1", status: "succeeded" } }]);
    const result = await readDepositRefund("re_test_1", {
      ...deps(fetchFn),
      connectedAccountId: ACCOUNT,
    });
    expect(result.amountGrosze).toBe(0);
  });
});

describe("refundVerdict — trzy wyniki, nie dwa", () => {
  it("succeeded z kwotą = zwrot, z kwotą Z ODCZYTU", () => {
    // Kwota bierze się z odczytu, nie z żądania: gdyby dostawca oddał mniej,
    // do rejestru ma wejść to, co oddał.
    expect(refundVerdict(read({ amountGrosze: 33_300 }))).toEqual({
      outcome: "settled",
      amountGrosze: 33_300,
      reason: "",
    });
  });

  it.each(["pending", "requires_action"])("%s to stan pośredni, nie porażka", (status) => {
    const verdict = refundVerdict(read({ status }));
    expect(verdict.outcome).toBe("pending");
    expect(verdict.reason).not.toBe("");
  });

  it("nieznany status dostawcy też jest stanem pośrednim", () => {
    // Dopisanie przez dostawcę nowej wartości nie ma prawa zamienić zwrotu
    // w drodze w „odrzucony" i wywołać drugiego zwrotu tej samej kaucji.
    expect(refundVerdict(read({ status: "settling_somehow" })).outcome).toBe("pending");
  });

  it.each(["failed", "canceled"])("%s to odmowa z powodem", (status) => {
    const verdict = refundVerdict(read({ status, failureReason: "expired_or_canceled_card" }));
    expect(verdict.outcome).toBe("failed");
    expect(verdict.reason).toContain("expired_or_canceled_card");
  });

  it("succeeded BEZ kwoty nie jest zwrotem — brak treści wiersza rejestru", () => {
    expect(refundVerdict(read({ amountGrosze: 0 })).outcome).toBe("pending");
  });
});

describe("obserwowane zdarzenia zwrotu", () => {
  it("obie rodziny nazw dostawcy są nasłuchiwane", () => {
    expect(isObservedRefundEvent("charge.refund.updated")).toBe(true);
    expect(isObservedRefundEvent("refund.updated")).toBe(true);
    expect(isObservedRefundEvent("refund.failed")).toBe(true);
  });

  it("zdarzenia płatności nie są zdarzeniami zwrotu", () => {
    expect(isObservedRefundEvent("payment_intent.succeeded")).toBe(false);
    expect(OBSERVED_REFUND_EVENTS).not.toContain("payment_intent.succeeded");
  });
});

/**
 * Kontrakt płatności online (Z3, ADR-066) — na nagranych odpowiedziach,
 * bez sieci i bez konta dostawcy.
 *
 * Najważniejsze są tu dwa testy, oba pilnujące BAJTÓW ciała żądania:
 *
 *   1. kwota tabelaryczna — liczba w `amount=` musi być IDENTYCZNA z tą,
 *      którą podał serwer. Każdy `/100` po drodze (mutacja z tabeli dowodów
 *      Z3) daje pobranie stukrotnie za małe, a wszystkie inne testy przy
 *      takiej mutacji nadal przechodzą: intent powstaje, status jest poprawny,
 *      strona działa. Wyłapuje to WYŁĄCZNIE porównanie liczby;
 *   2. nagłówek idempotencji — bez niego dwuklik obciąża klienta dwa razy,
 *      a błąd jest niewidoczny do momentu, w którym ktoś zobaczy dwa
 *      obciążenia na wyciągu.
 */
import { describe, expect, it } from "vitest";

import {
  PaymentAmountError,
  cancelPaymentIntent,
  createPaymentIntent,
  isIntentSettled,
  readPaymentIntent,
} from "./payment-intent";

const SECRET = "sk_test_klucz_platformy";
const PUBLISHABLE = "pk_test_klucz_publiczny";
const ACCOUNT = "acct_najemcy";
const ORDER_ID = "11111111-2222-3333-4444-555555555555";

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

const INTENT_OK = {
  id: "pi_test_1",
  client_secret: "pi_test_1_secret_abc",
  status: "requires_payment_method",
  amount: 123_45,
};

function params(overrides: Partial<Parameters<typeof createPaymentIntent>[0]> = {}) {
  return {
    amountGrosze: 123_45,
    currency: "PLN",
    connectedAccountId: ACCOUNT,
    applicationFeeGrosze: 0,
    orderId: ORDER_ID,
    idempotencyKey: ORDER_ID,
    ...overrides,
  };
}

describe("kwota w drodze do dostawcy", () => {
  // Tabela: kwoty z różnych rzędów wielkości. Mutacja `/100` przechodzi
  // niezauważona przy 100 gr (1 gr to nadal liczba całkowita), więc w tabeli
  // MUSZĄ być kwoty, przy których dzielenie zostawia ślad, i takie, przy
  // których nie zostawia — inaczej dowód jest przypadkowy.
  const cases = [
    { grosze: 1, opis: "jeden grosz" },
    { grosze: 999, opis: "kwota niepodzielna przez 100" },
    { grosze: 12_300, opis: "równe 123 zł" },
    { grosze: 4_999_99, opis: "kwota z groszami" },
    { grosze: 100_000_00, opis: "sto tysięcy złotych" },
  ];

  it.each(cases)("$opis: amount= to ta sama liczba, którą podał serwer", async ({ grosze }) => {
    const { calls, fetchFn } = transport([{ status: 200, body: { ...INTENT_OK, amount: grosze } }]);

    await createPaymentIntent(params({ amountGrosze: grosze }), deps(fetchFn));

    // Porównanie do STRINGA liczby groszy: `/100` daje inną liczbę,
    // a `* 100` inną — obie mutacje padają na tej samej asercji.
    expect(form(calls[0]!).get("amount")).toBe(String(grosze));
  });

  it("kwota ułamkowa (skutek dzielenia) nie ma jak dojść do dostawcy", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await expect(createPaymentIntent(params({ amountGrosze: 123.45 }), deps(fetchFn))).rejects.toThrow(
      PaymentAmountError,
    );
    // Dowód, że odmowa nastąpiła PRZED siecią: dostawca nie zobaczył żądania.
    expect(calls).toHaveLength(0);
  });

  it("kwota zerowa jest odmową, nie płatnością za darmo", async () => {
    const { fetchFn } = transport([]);
    await expect(createPaymentIntent(params({ amountGrosze: 0 }), deps(fetchFn))).rejects.toThrow(
      PaymentAmountError,
    );
  });
});

describe("idempotencja", () => {
  it("wysyła nagłówek Idempotency-Key z identyfikatorem zamówienia", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params(), deps(fetchFn));

    expect(header(calls[0]!, "Idempotency-Key")).toBe(ORDER_ID);
  });

  it("dwa wywołania dla tego samego zamówienia niosą TEN SAM klucz", async () => {
    // Test nie udaje dostawcy (to on odtwarza pierwotną odpowiedź) — dowodzi
    // tego, co jest po NASZEJ stronie: powtórzone wywołanie nie generuje
    // nowego klucza, więc dostawca ma po czym rozpoznać powtórkę.
    const { calls, fetchFn } = transport([
      { status: 200, body: INTENT_OK },
      { status: 200, body: INTENT_OK },
    ]);

    await createPaymentIntent(params(), deps(fetchFn));
    await createPaymentIntent(params(), deps(fetchFn));

    // `toBeDefined` PRZED porównaniem: bez tego usunięcie nagłówka dawałoby
    // undefined === undefined i test przechodziłby na złym powodzie.
    expect(header(calls[0]!, "Idempotency-Key")).toBeDefined();
    expect(header(calls[0]!, "Idempotency-Key")).toBe(header(calls[1]!, "Idempotency-Key"));
  });

  it("pusty klucz idempotencji jest odmową, nie brakiem nagłówka", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await expect(createPaymentIntent(params({ idempotencyKey: "" }), deps(fetchFn))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("konto najemcy", () => {
  it("płatność powstaje NA KONCIE NAJEMCY (nagłówek Stripe-Account)", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params(), deps(fetchFn));

    expect(header(calls[0]!, "Stripe-Account")).toBe(ACCOUNT);
  });

  it("bez konta najemcy odmawia — środki nie mogą wpaść na konto platformy", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await expect(
      createPaymentIntent(params({ connectedAccountId: "" }), deps(fetchFn)),
    ).rejects.toThrow(/konta najemcy/);
    expect(calls).toHaveLength(0);
  });
});

describe("prowizja platformy", () => {
  it("jedzie do dostawcy od pierwszego dnia, mimo wartości 0", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params(), deps(fetchFn));

    expect(form(calls[0]!).get("application_fee_amount")).toBe("0");
  });

  it("prowizja ujemna nie ma jak dojść do dostawcy", async () => {
    const { fetchFn } = transport([]);
    await expect(
      createPaymentIntent(params({ applicationFeeGrosze: -1 }), deps(fetchFn)),
    ).rejects.toThrow(PaymentAmountError);
  });
});

describe("metody płatności na intencie (F1/ADR-137)", () => {
  it("żądanie włącza metody automatyczne dostawcy", async () => {
    // To jest cały mechanizm, dzięki któremu BLIK i P24 pojawiają się
    // w checkoucie: dostawca dobiera metody ze zdolności i konfiguracji
    // KONTA NAJEMCY. Zdjęcie tego pola gasi wszystkie metody poza domyślną
    // kartą — po cichu, bo intent nadal powstaje, a strona nadal działa.
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params(), deps(fetchFn));

    expect(form(calls[0]!).get("automatic_payment_methods[enabled]")).toBe("true");
  });

  it("lista metod NIE jest zaszyta w żądaniu (payment_method_types nie występuje)", async () => {
    // Kontrola negatywna kontraktu: wpisanie `payment_method_types` u nas
    // zamieniłoby decyzję konta najemcy na nasze wdrożenie — usunięcie
    // BLIK-a z takiej listy zdejmowałoby metodę wszystkim najemcom naraz
    // i żaden inny test by tego nie zobaczył.
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params(), deps(fetchFn));

    const body = String(calls[0]!.init.body ?? "");
    expect(body).not.toContain("payment_method_types");
  });
});

describe("waluta i metadane", () => {
  it("waluta idzie z zamówienia (małymi literami), nie zaszyta", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params({ currency: "EUR" }), deps(fetchFn));

    expect(form(calls[0]!).get("currency")).toBe("eur");
  });

  it("identyfikator zamówienia jedzie w metadanych (Z4 ma po czym trafić)", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: INTENT_OK }]);

    await createPaymentIntent(params(), deps(fetchFn));

    expect(form(calls[0]!).get("metadata[order_id]")).toBe(ORDER_ID);
  });
});

describe("odpowiedź dostawcy", () => {
  it("status jedzie surowy, bez tłumaczenia na naszą oś", async () => {
    const { fetchFn } = transport([
      { status: 200, body: { ...INTENT_OK, status: "requires_action" } },
    ]);

    const handle = await createPaymentIntent(params(), deps(fetchFn));

    // Ani „pending", ani „paid" — port nie zna naszej osi statusów.
    expect(handle.status).toBe("requires_action");
  });

  it("odpowiedź bez client_secret to błąd, nie połowiczny uchwyt", async () => {
    const { fetchFn } = transport([{ status: 200, body: { id: "pi_1", status: "succeeded" } }]);

    await expect(createPaymentIntent(params(), deps(fetchFn))).rejects.toThrow(/nie zwróciło/);
  });

  it("komunikat błędu dostawcy nie niesie klucza sekretnego", async () => {
    const { fetchFn } = transport([
      {
        status: 400,
        body: { error: { message: `Nieprawidłowe żądanie z kluczem ${SECRET}`, code: "x" } },
      },
    ]);

    await expect(createPaymentIntent(params(), deps(fetchFn))).rejects.toThrow(/\[usunięto\]/);
  });
});

describe("odczyt płatności (ADR-049)", () => {
  it("czyta z konta najemcy i oddaje kwotę FAKTYCZNIE pobraną wraz z walutą", async () => {
    const { calls, fetchFn } = transport([
      {
        status: 200,
        body: {
          id: "pi_1",
          status: "succeeded",
          amount: 12_300,
          amount_received: 12_300,
          currency: "pln",
        },
      },
    ]);

    const read = await readPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: ACCOUNT });

    expect(calls[0]!.url).toContain("/v1/payment_intents/pi_1");
    expect(header(calls[0]!, "Stripe-Account")).toBe(ACCOUNT);
    expect(read.amountReceivedGrosze).toBe(12_300);
    expect(read.currency).toBe("pln");
  });

  it("brak amount_received w odpowiedzi znaczy ZERO, nie „pewnie tyle, ile prosiliśmy”", async () => {
    // Dryf kształtu odpowiedzi nie ma prawa oznaczać „opłacone". Ten sam
    // kierunek domyślności co przy `charges_enabled` w Z2.
    const { fetchFn } = transport([
      { status: 200, body: { id: "pi_1", status: "succeeded", amount: 12_300 } },
    ]);

    const read = await readPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: ACCOUNT });

    expect(read.amountReceivedGrosze).toBe(0);
    expect(isIntentSettled(read, 12_300, "PLN")).toBe(false);
  });

  it("brak waluty w odpowiedzi znaczy „nieznana”, nie „pewnie ta, o którą prosiliśmy”", async () => {
    // Ten sam kierunek domyślności: rozstrzyga porównanie w werdykcie,
    // a nieznana waluta nie ma prawa przejść jako zgodna.
    const { fetchFn } = transport([
      { status: 200, body: { id: "pi_1", status: "succeeded", amount: 12_300, amount_received: 12_300 } },
    ]);

    const read = await readPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: ACCOUNT });

    expect(read.currency).toBe("");
    expect(isIntentSettled(read, 12_300, "PLN")).toBe(false);
  });

  it("czas powstania płatności jedzie Z ODCZYTU (podstawa progu porzucenia)", async () => {
    const { fetchFn } = transport([
      {
        status: 200,
        body: {
          id: "pi_1",
          status: "requires_payment_method",
          amount: 12_300,
          created: 1_800_000_000,
        },
      },
    ]);

    const read = await readPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: ACCOUNT });

    expect(read.createdAtSeconds).toBe(1_800_000_000);
  });

  it("brak pola `created` znaczy ZERO — jawny brak dowodu, nie rok 1970", async () => {
    // Wołający (L11) ma z tego wyprowadzić „nie wiem, więc nie wygaszam".
    const { fetchFn } = transport([
      { status: 200, body: { id: "pi_1", status: "requires_payment_method", amount: 12_300 } },
    ]);

    const read = await readPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: ACCOUNT });

    expect(read.createdAtSeconds).toBe(0);
  });
});

describe("wygaszenie płatności u dostawcy (L11)", () => {
  it("anuluje NA KONCIE NAJEMCY i nie zwraca żadnego stanu", async () => {
    const { calls, fetchFn } = transport([
      { status: 200, body: { id: "pi_1", status: "canceled", amount: 12_300 } },
    ]);

    const result = await cancelPaymentIntent("pi_1", {
      ...deps(fetchFn),
      connectedAccountId: ACCOUNT,
    });

    expect(calls[0]!.url).toContain("/v1/payment_intents/pi_1/cancel");
    expect(calls[0]!.init.method).toBe("POST");
    expect(header(calls[0]!, "Stripe-Account")).toBe(ACCOUNT);
    // Status `canceled` BYŁ w odpowiedzi — i nie wyszedł z funkcji.
    expect(result).toBeUndefined();
  });

  it("odmowa dostawcy („płatność już rozliczona”) rzuca, zamiast udawać sukces", async () => {
    const { fetchFn } = transport([
      {
        status: 400,
        body: {
          error: {
            message: "You cannot cancel this PaymentIntent because it has a status of succeeded.",
            code: "payment_intent_unexpected_state",
          },
        },
      },
    ]);

    await expect(
      cancelPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: ACCOUNT }),
    ).rejects.toThrow(/succeeded/);
  });

  it("bez konta najemcy NIE wysyła żądania — anulowanie na koncie platformy nie istnieje", async () => {
    const { calls, fetchFn } = transport([]);

    await expect(
      cancelPaymentIntent("pi_1", { ...deps(fetchFn), connectedAccountId: "" }),
    ).rejects.toThrow(/konta najemcy/);
    expect(calls).toHaveLength(0);
  });
});

describe("isIntentSettled", () => {
  const read = (status: string, received: number, currency = "pln") => ({
    intentId: "pi_1",
    status,
    amountReceivedGrosze: received,
    amountGrosze: 12_300,
    currency,
    createdAtSeconds: 1_800_000_000,
  });

  it("succeeded z pełną kwotą = opłacone", () => {
    expect(isIntentSettled(read("succeeded", 12_300), 12_300, "PLN")).toBe(true);
  });

  it("succeeded z NIEPEŁNĄ kwotą to NIE jest opłacone", () => {
    // Sam status wygląda jak dowód i nim nie jest — to jest cały powód,
    // dla którego ta funkcja porównuje dwie liczby zamiast czytać jedno pole.
    expect(isIntentSettled(read("succeeded", 12_299), 12_300, "PLN")).toBe(false);
  });

  it("processing z pełną kwotą to jeszcze nie jest opłacone", () => {
    expect(isIntentSettled(read("processing", 12_300), 12_300, "PLN")).toBe(false);
  });

  it("pełna liczba w INNEJ walucie to NIE jest opłacone (K3, ADR-103)", () => {
    // 12 300 jednostek podrzędnych EUR ≠ 12 300 groszy PLN. Waluta
    // oczekiwana pochodzi z orders.currency (0049) — tej samej pary,
    // z której intent POWSTAŁ.
    expect(isIntentSettled(read("succeeded", 12_300, "eur"), 12_300, "PLN")).toBe(false);
  });

  it("porównanie waluty jest niewrażliwe na wielkość liter", () => {
    expect(isIntentSettled(read("succeeded", 12_300, "pln"), 12_300, "PLN")).toBe(true);
  });
});

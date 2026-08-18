/**
 * Checkout z płatnością online (Z3, ADR-066) — reguły, które kosztują
 * pieniądze, przypięte tam, gdzie mieszkają: w czystych funkcjach.
 *
 * Cztery osie, każda z własnym powodem istnienia:
 *   1. TOR OFFLINE ZAWSZE — żadne wejście nie usuwa przelewu z listy;
 *   2. BRAMKA KONTA — bez świeżego odczytu „konto przyjmuje płatności"
 *      płatność nie powstaje; awaria odczytu też zamyka tor online;
 *   3. „SPRAWDZAMY", NIE „OPŁACONE" — strona powrotu mówi `paid` wyłącznie
 *      wtedy, gdy `paid` stoi w NASZEJ bazie;
 *   4. UCHWYT CHECKOUTU — token nie jedzie przez adres URL i nie przechodzi
 *      walidacji, gdy jest podrobiony.
 */
import { describe, expect, it, vi } from "vitest";

import { submitCheckoutCore, type CheckoutDeps, type CheckoutRpcResult } from "@/lib/checkout/core";
import {
  preparePayment,
  type OnlinePaymentDeps,
  type PayableOrder,
} from "@/lib/checkout/online-payment";
import { paymentStatusView } from "@/lib/checkout/payment-status-view";
import {
  availablePaymentMethods,
  defaultPaymentMethod,
  isPaymentMethodAllowed,
  onlinePaymentUnavailableReason,
} from "@/lib/checkout/payment-options";
import { decodeCheckoutHandle, encodeCheckoutHandle } from "@/lib/checkout/session-cookie";

// ---------------------------------------------------------------------
// 1. Tor offline jest ZAWSZE
// ---------------------------------------------------------------------

describe("tor offline nie znika nigdy (ograniczenie globalne 9)", () => {
  // Tabela pokrywa WSZYSTKIE cztery kombinacje flag — łącznie z tą, w której
  // wszystko działa. To jest ten przypadek, który psuje mutacja „usuń tor
  // offline, gdy Stripe jest skonfigurowany": wygląda jak uproszczenie
  // („po co przelew, skoro karta działa"), a odcina sprzedaż każdemu, kto
  // woli przelew albo nie ma karty.
  const cases = [
    { stripeConfigured: false, chargesEnabled: false, opis: "brak konfiguracji platformy" },
    { stripeConfigured: false, chargesEnabled: true, opis: "konto gotowe, platforma bez kluczy" },
    { stripeConfigured: true, chargesEnabled: false, opis: "najemca bez KYC" },
    { stripeConfigured: true, chargesEnabled: true, opis: "wszystko działa" },
  ];

  it.each(cases)("$opis: przelew i pobranie są na liście", (availability) => {
    const methods = availablePaymentMethods(availability);
    expect(methods).toContain("transfer");
    expect(methods).toContain("cod");
  });

  it("płatność online wchodzi WYŁĄCZNIE przy komplecie warunków", () => {
    expect(availablePaymentMethods({ stripeConfigured: true, chargesEnabled: true })).toContain(
      "online",
    );
    expect(
      availablePaymentMethods({ stripeConfigured: true, chargesEnabled: false }),
    ).not.toContain("online");
    expect(
      availablePaymentMethods({ stripeConfigured: false, chargesEnabled: true }),
    ).not.toContain("online");
  });

  it("powód niedostępności rozróżnia NASZ brak konfiguracji od braku KYC najemcy", () => {
    // Rozróżnienie nie jest kosmetyczne: pierwsze to nasza awaria do
    // naprawienia, drugie to normalny stan młodego sklepu (sedno ADR-066).
    expect(
      onlinePaymentUnavailableReason({ stripeConfigured: false, chargesEnabled: true }),
    ).toBe("not_configured");
    expect(
      onlinePaymentUnavailableReason({ stripeConfigured: true, chargesEnabled: false }),
    ).toBe("account_not_ready");
    expect(
      onlinePaymentUnavailableReason({ stripeConfigured: true, chargesEnabled: true }),
    ).toBeNull();
  });

  it("najemca bez KYC ma domyślnie zaznaczony przelew, nie pustkę", () => {
    expect(defaultPaymentMethod({ stripeConfigured: true, chargesEnabled: false })).toBe(
      "transfer",
    );
    expect(defaultPaymentMethod({ stripeConfigured: true, chargesEnabled: true })).toBe("online");
  });

  it("wybór online w sklepie bez konta jest NIEDOZWOLONY (bramka serwerowa)", () => {
    const availability = { stripeConfigured: true, chargesEnabled: false };
    expect(isPaymentMethodAllowed("online", availability)).toBe(false);
    expect(isPaymentMethodAllowed("transfer", availability)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// 2. Rdzeń checkoutu: bramka przed zapisem
// ---------------------------------------------------------------------

const VALID_INPUT = {
  email: "klient@example.com",
  fullName: "Jan Kowalski",
  startDate: "2026-10-01",
  endDate: "2026-10-07",
  deliveryMethod: "pickup",
  pickupLocationId: "11111111-1111-4111-8111-111111111111",
  items: [{ productId: "22222222-2222-4222-8222-222222222222", quantity: 1 }],
  termsAccepted: true,
  termsVersion: "v1",
  paymentMethod: "online",
} as const;

function rpcResult(overrides: Partial<CheckoutRpcResult> = {}): CheckoutRpcResult {
  return {
    order_id: "44444444-4444-4444-8444-444444444444",
    order_number: "AV-2026-001",
    order_status: "pending",
    payment_status: "unpaid",
    payment_method: "online",
    payment_provider: "stripe",
    start_date: "2026-10-01",
    end_date: "2026-10-07",
    delivery_method: "pickup",
    total_rental_grosze: 65_000,
    total_deposit_grosze: 5_000,
    delivery_grosze: 0,
    currency: "PLN",
    items: [],
    customer: { email: "klient@example.com", full_name: "Jan Kowalski", locale: "pl" },
    tenant: { name: "Wypożyczalnia", locale: "pl" },
    email_sender: null,
    notify_email: null,
    log_token: "9e1d4c7a-0000-4000-8000-abcdefabcdef",
    ...overrides,
  };
}

function deps(overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    tenantId: "33333333-3333-3333-3333-333333333333",
    ip: "203.0.113.7",
    checkRateLimit: vi.fn(async () => ({ success: true })),
    verifyCaptcha: vi.fn(async () => ({ ok: true })),
    // Bilet zaufanej granicy (0059) — atrapa; ta suita bada oś płatności.
    issueTicket: vi.fn(() => ({ exp: 2_000_000_000, nonce: "nonce-testowy", sig: "sig-testowy" })),
    callRpc: vi.fn(async () => rpcResult()),
    sendEmails: vi.fn(async () => []),
    // Komplet dokumentów + tryb integracji (deklaracja "1.0" z INPUT):
    // bramka ADR-191 ma tu przepuszczać — suita bada oś płatności.
    readLegalDocuments: vi.fn(async () => [
      { kind: "terms" as const, version_label: "v1" },
      { kind: "privacy" as const, version_label: "v1" },
    ]),
    termsFromRegistry: false,
    readOnlineAvailability: vi.fn(async () => ({ stripeConfigured: true, chargesEnabled: true })),
    rememberCheckout: vi.fn(async () => {}),
    readCustomFields: vi.fn(async () => []),
    ...overrides,
  };
}

describe("wybór online przy najemcy bez KYC", () => {
  it("odmawia PRZED zapisem — zamówienie w reżimie ścisłym nie powstaje", async () => {
    const d = deps({
      readOnlineAvailability: vi.fn(async () => ({
        stripeConfigured: true,
        chargesEnabled: false,
      })),
    });

    const result = await submitCheckoutCore(VALID_INPUT, d);

    expect(result.status).toBe("payment_unavailable");
    // Najważniejsza asercja tego testu: baza NIE została ruszona. Zamówienie
    // założone w reżimie stripe bez możliwości zapłaty utknęłoby w `unpaid`
    // na zawsze — bramka 0027 nie zna z niego wyjścia poza anulowaniem.
    expect(d.callRpc).not.toHaveBeenCalled();
  });

  it("ale przelew w tym samym sklepie przechodzi", async () => {
    const d = deps({
      readOnlineAvailability: vi.fn(async () => ({
        stripeConfigured: true,
        chargesEnabled: false,
      })),
      callRpc: vi.fn(async () => rpcResult({ payment_method: "transfer", payment_provider: "manual" })),
    });

    const result = await submitCheckoutCore({ ...VALID_INPUT, paymentMethod: "transfer" }, d);

    expect(result.status).toBe("success");
    expect(d.callRpc).toHaveBeenCalled();
  });

  it("checkout PRZELEWOWY w ogóle nie pyta dostawcy o dostępność", async () => {
    // Tor offline jest dostępny ZAWSZE (ADR-066), więc jego odpowiedź jest
    // znana bez pytania kogokolwiek. Zapytanie w tym miejscu uzależniłoby
    // sprzedaż najemcy od cudzej dostępności tam, gdzie nikt nic nie płaci.
    const d = deps({
      callRpc: vi.fn(async () => rpcResult({ payment_method: "transfer", payment_provider: "manual" })),
    });

    const result = await submitCheckoutCore({ ...VALID_INPUT, paymentMethod: "transfer" }, d);

    expect(result.status).toBe("success");
    expect(d.readOnlineAvailability).not.toHaveBeenCalled();
  });

  it("awaria odczytu dostępności NIE wywraca checkoutu przelewowego", async () => {
    // Nasza awaria integracji nie ma prawa zabrać najemcy sprzedaży za
    // przelewem — klient wybierający przelew o istnieniu integracji nie wie.
    const d = deps({
      readOnlineAvailability: vi.fn(async () => {
        throw new Error("dostawca nie odpowiada");
      }),
      callRpc: vi.fn(async () => rpcResult({ payment_method: "transfer", payment_provider: "manual" })),
    });

    const result = await submitCheckoutCore({ ...VALID_INPUT, paymentMethod: "transfer" }, d);

    expect(result.status).toBe("success");
  });
});

describe("zamówienie po checkoucie online", () => {
  it("jest `unpaid` i prowadzi na KROK PŁATNOŚCI, nie na „opłacone”", async () => {
    const result = await submitCheckoutCore(VALID_INPUT, deps());

    expect(result).toMatchObject({
      status: "success",
      nextStep: "payment",
      order: { paymentStatus: "unpaid" },
    });
    // `paid` nie jest w tym kontrakcie reprezentowalne i nie ma go w wyniku.
    // Cudzysłowy w szukanej frazie są konieczne: `"unpaid"` zawiera `paid`
    // jako podciąg, więc asercja bez nich przechodziłaby na złym powodzie.
    expect(JSON.stringify(result)).not.toContain('"paid"');
  });

  it("kierunek następnego kroku bierze się z reżimu ZAPISANEGO przez serwer", async () => {
    // Klient przysłał `online`, ale serwer utrwalił obieg `manual` (np. bo
    // RPC odmówiło płatności online). Krok płatności NIE należy się temu
    // zamówieniu — decyduje wiersz w bazie, nie wejście z przeglądarki.
    const d = deps({
      callRpc: vi.fn(async () => rpcResult({ payment_method: "transfer", payment_provider: "manual" })),
    });

    const result = await submitCheckoutCore(VALID_INPUT, d);

    expect(result).toMatchObject({ nextStep: "confirmation" });
  });

  it("zapamiętuje uchwyt checkoutu (bez tokenu w wyniku dla przeglądarki)", async () => {
    const d = deps();
    const result = await submitCheckoutCore(VALID_INPUT, d);

    expect(d.rememberCheckout).toHaveBeenCalledWith({
      orderId: "44444444-4444-4444-8444-444444444444",
      token: "9e1d4c7a-0000-4000-8000-abcdefabcdef",
    });
    expect(JSON.stringify(result)).not.toContain("9e1d4c7a");
  });
});

// ---------------------------------------------------------------------
// 3. Bramka przed utworzeniem płatności
// ---------------------------------------------------------------------

const ORDER: PayableOrder = {
  orderId: "44444444-4444-4444-8444-444444444444",
  orderNumber: "AV-2026-001",
  amountGrosze: 70_000,
  currency: "PLN",
  paymentStatus: "unpaid",
  paymentProvider: "stripe",
  providerPaymentIntentId: null,
};

function paymentDeps(overrides: Partial<OnlinePaymentDeps> = {}) {
  const base = {
    readAccountId: vi.fn<OnlinePaymentDeps["readAccountId"]>(async () => "acct_najemcy"),
    readAccountState: vi.fn<OnlinePaymentDeps["readAccountState"]>(async () => ({
      chargesEnabled: true,
    })),
    createIntent: vi.fn<OnlinePaymentDeps["createIntent"]>(async () => ({
      intentId: "pi_1",
      clientSecret: "pi_1_secret",
      status: "requires_payment_method",
    })),
    attachIntent: vi.fn<OnlinePaymentDeps["attachIntent"]>(async () => ({
      paymentStatus: "pending",
    })),
    publishableKey: "pk_test_klucz",
  };
  return { ...base, ...overrides } as typeof base & OnlinePaymentDeps;
}

describe("bramka charges_enabled przed utworzeniem płatności", () => {
  it("konto, które NIE przyjmuje płatności → płatność nie powstaje", async () => {
    const d = paymentDeps({ readAccountState: vi.fn(async () => ({ chargesEnabled: false })) });

    const result = await preparePayment(ORDER, d);

    expect(result).toEqual({ status: "unavailable", reason: "account_not_ready" });
    // Sedno mutacji „usuń bramkę charges_enabled": bez niej intent powstaje
    // na koncie, które nie może przyjąć środków — klient płaci w próżnię.
    expect(d.createIntent).not.toHaveBeenCalled();
  });

  it("awaria ODCZYTU stanu konta też zamyka tor online", async () => {
    // „Nie wiem, czy konto przyjmuje płatności" znaczy „nie pobieram
    // pieniędzy". Przepuszczenie przy nieznanym stanie byłoby domyślną
    // gotowością — tym samym błędem, co domyślne `charges_enabled: true`.
    const d = paymentDeps({
      readAccountState: vi.fn(async () => {
        throw new Error("dostawca nie odpowiada");
      }),
    });

    const result = await preparePayment(ORDER, d);

    expect(result).toEqual({ status: "unavailable", reason: "account_not_ready" });
    expect(d.createIntent).not.toHaveBeenCalled();
  });

  it("najemca bez konta → płatność nie powstaje", async () => {
    const d = paymentDeps({ readAccountId: vi.fn(async () => null) });

    const result = await preparePayment(ORDER, d);

    expect(result).toEqual({ status: "unavailable", reason: "account_not_ready" });
    expect(d.createIntent).not.toHaveBeenCalled();
  });

  it("stan konta czytany jest ZA KAŻDYM RAZEM, nie raz na sklep", async () => {
    const d = paymentDeps();
    await preparePayment(ORDER, d);
    await preparePayment(ORDER, d);
    expect(d.readAccountState).toHaveBeenCalledTimes(2);
  });
});

describe("utworzenie płatności", () => {
  it("kwota i klucz idempotencji pochodzą z ZAMÓWIENIA", async () => {
    const d = paymentDeps();

    await preparePayment(ORDER, d);

    expect(d.createIntent).toHaveBeenCalledWith({
      amountGrosze: 70_000,
      currency: "PLN",
      connectedAccountId: "acct_najemcy",
      applicationFeeGrosze: 0,
      orderId: ORDER.orderId,
      // Klucz = identyfikator zamówienia: dwuklik i odświeżenie strony
      // odtwarzają tę samą płatność zamiast obciążać klienta dwa razy.
      idempotencyKey: ORDER.orderId,
    });
  });

  it("dwa wejścia na krok płatności niosą TEN SAM klucz idempotencji", async () => {
    const d = paymentDeps();

    await preparePayment(ORDER, d);
    await preparePayment(ORDER, d);

    const [first, second] = d.createIntent.mock.calls;
    expect(first![0].idempotencyKey).toBe(second![0].idempotencyKey);
  });

  it("prowizja platformy jedzie w wywołaniu od pierwszego dnia (0)", async () => {
    const d = paymentDeps();
    await preparePayment(ORDER, d);
    expect(d.createIntent.mock.calls[0]![0]).toMatchObject({ applicationFeeGrosze: 0 });
  });

  it("stan zamówienia pochodzi z ODCZYTU po zapisie, nie ze statusu dostawcy", async () => {
    // Dostawca zwrócił `requires_payment_method`; baza po zapisie mówi
    // `pending`. Do widoku idzie WERSJA BAZY — statusy dostawcy nie mają
    // wstępu na naszą oś (tłumaczy je dopiero Z4, po odczycie).
    const d = paymentDeps();
    const result = await preparePayment(ORDER, d);
    expect(result).toMatchObject({ status: "ready", paymentStatus: "pending" });
  });

  it("nieudane związanie płatności z zamówieniem NIE pokazuje formularza", async () => {
    // Inaczej klient zapłaciłby za zamówienie, z którym tej płatności nic nie
    // łączy — a webhook z Z4 nie miałby czego domknąć.
    const d = paymentDeps({
      attachIntent: vi.fn(async () => {
        throw new Error("baza odmówiła");
      }),
    });

    expect(await preparePayment(ORDER, d)).toEqual({ status: "error" });
  });

  it("zamówienie w obiegu offline nie ma jak wejść na tor płatności", async () => {
    const d = paymentDeps();
    const result = await preparePayment({ ...ORDER, paymentProvider: "manual" }, d);
    expect(result).toEqual({ status: "error" });
    expect(d.readAccountId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// 4. Strona powrotu: „sprawdzamy", nie „opłacone"
// ---------------------------------------------------------------------

describe("co strona powrotu ma prawo powiedzieć (ADR-049)", () => {
  it("zamówienie PO POWROCIE z płatności jest „sprawdzamy”, nie „opłacone”", () => {
    // To jest test z tabeli dowodów Z3. W całym Z3 nie ma ścieżki ustawiającej
    // `paid`, więc zaraz po powrocie baza mówi `pending` — i tak ma zostać.
    // Mutacja „ustaw paid na podstawie wyniku z przeglądarki" zapala go
    // natychmiast: widok przeskoczyłby na `paid`.
    expect(paymentStatusView({ paymentStatus: "pending", paymentProvider: "stripe" })).toEqual({
      kind: "checking",
      providerSettled: false,
    });
  });

  it("nawet gdy DOSTAWCA potwierdza wpłatę, werdykt zostaje „sprawdzamy”", () => {
    // Odczyt u dostawcy wolno pokazać, ale nie wolno nim zastąpić stanu
    // z naszej bazy: `paid` pisze wyłącznie webhook (Z4).
    const view = paymentStatusView({
      paymentStatus: "pending",
      paymentProvider: "stripe",
      providerSettled: true,
    });
    expect(view).toEqual({ kind: "checking", providerSettled: true });
  });

  it("„opłacone” pada WYŁĄCZNIE przy `paid` w naszej bazie", () => {
    expect(paymentStatusView({ paymentStatus: "paid", paymentProvider: "stripe" })).toEqual({
      kind: "paid",
    });
  });

  it("nieudana próba to osobny stan, nie „nikt nie płacił”", () => {
    expect(
      paymentStatusView({ paymentStatus: "payment_failed", paymentProvider: "stripe" }),
    ).toEqual({ kind: "failed" });
  });

  it("obieg offline nie jest „w toku” — nic tam nie sprawdzamy", () => {
    expect(paymentStatusView({ paymentStatus: "unpaid", paymentProvider: "manual" })).toEqual({
      kind: "offline",
    });
  });
});

// ---------------------------------------------------------------------
// 5. Uchwyt checkoutu
// ---------------------------------------------------------------------

describe("uchwyt checkoutu w ciasteczku", () => {
  const handle = {
    orderId: "44444444-4444-4444-8444-444444444444",
    token: "9e1d4c7a-0000-4000-8000-abcdefabcdef",
  };

  it("koduje i odczytuje w obie strony", () => {
    expect(decodeCheckoutHandle(encodeCheckoutHandle(handle))).toEqual(handle);
  });

  it.each([
    ["pusta wartość", ""],
    ["brak drugiej części", "44444444-4444-4444-8444-444444444444"],
    ["śmieć", "kot.pies"],
    ["wstrzyknięcie", "'; drop table orders; --.9e1d4c7a-0000-4000-8000-abcdefabcdef"],
    ["za dużo części", "a.b.c"],
  ])("odrzuca podrobioną wartość: %s", (_opis, value) => {
    // Wartość ciasteczka przychodzi od klienta i bywa czymkolwiek. Odczyt
    // jest tu WALIDACJĄ, nie parsowaniem — przepuszczamy wyłącznie parę UUID.
    expect(decodeCheckoutHandle(value)).toBeNull();
  });
});

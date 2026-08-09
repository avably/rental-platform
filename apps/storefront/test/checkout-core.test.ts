/**
 * Testy KONTRAKTU akcji checkoutu (apps/storefront/lib/checkout/contract.ts).
 *
 * Rdzeń dostaje zależności przez parametr, więc te testy nie potrzebują ani
 * `next/headers`, ani bazy — sprawdzają, który wariant statusu wraca i kiedy,
 * oraz że wejście NIE niesie kwot, a odpowiedź NIE niesie danych wrażliwych
 * najemcy. Ścieżka „naprawdę zapisuje" jest w packages/db/test/public-checkout.
 */
import { describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_RATE_LIMIT,
  submitCheckoutCore,
  type CheckoutDeps,
  type CheckoutRpcArgs,
  type CheckoutRpcError,
  type CheckoutRpcResult,
} from "@/lib/checkout/core";
import { checkoutSchema, toCheckoutFieldErrors } from "@/lib/checkout/validation";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

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
  paymentMethod: "transfer",
} as const;

const RPC_RESULT: CheckoutRpcResult = {
  order_id: "44444444-4444-4444-8444-444444444444",
  order_number: "AV-2026-001",
  order_status: "pending",
  payment_status: "unpaid",
  payment_method: "transfer",
  payment_provider: "manual",
  start_date: "2026-10-01",
  end_date: "2026-10-07",
  delivery_method: "pickup",
  total_rental_grosze: 65_000,
  total_deposit_grosze: 5_000,
  delivery_grosze: 0,
  currency: "PLN",
  items: [
    {
      product_id: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
      unit_rental_grosze: 65_000,
      unit_deposit_grosze: 5_000,
    },
  ],
  customer: { email: "klient@example.com", full_name: "Jan Kowalski", locale: "pl" },
  tenant: { name: "Wypożyczalnia", locale: "pl" },
  email_sender: { name: "Wypożyczalnia", reply_to: "biuro@najemca.example" },
  notify_email: "biuro@najemca.example",
  log_token: "9e1d4c7a-0000-4000-8000-abcdefabcdef",
};

function deps(overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    tenantId: "33333333-3333-3333-3333-333333333333",
    ip: "203.0.113.7",
    checkRateLimit: vi.fn(async () => ({ success: true })),
    verifyCaptcha: vi.fn(async () => ({ ok: true })),
    callRpc: vi.fn(async () => RPC_RESULT),
    sendEmails: vi.fn(async () => []),
    // Domyślnie sklep BEZ płatności online — tor offline i tak działa
    // (ADR-066), więc istniejące przypadki tej suity nic nie tracą.
    readOnlineAvailability: vi.fn(async () => ({ stripeConfigured: false, chargesEnabled: false })),
    rememberCheckout: vi.fn(async () => {}),
    // Domyślnie najemca BEZ pól własnych — istniejące przypadki tej suity
    // opisują checkout sprzed C6-A3 i mają się zachowywać identycznie.
    readCustomFields: vi.fn(async () => []),
    ...overrides,
  };
}

describe("bramka anty-bot (honeypot)", () => {
  it("wypełniony honeypot → rejected i baza NIE jest ruszana", async () => {
    const d = deps();
    const result = await submitCheckoutCore({ ...VALID_INPUT, honeypot: "spam" }, d);

    expect(result).toEqual({ status: "rejected" });
    expect(d.callRpc, "bot dotarł do bazy").not.toHaveBeenCalled();
    // Honeypot stoi PRZED rate-limitem — nie zużywa nawet budżetu limitu.
    expect(d.checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("rate-limit", () => {
  it("przekroczony limit → rate_limited i baza NIE jest ruszana", async () => {
    const d = deps({ checkRateLimit: vi.fn(async () => ({ success: false })) });
    const result = await submitCheckoutCore(VALID_INPUT, d);

    expect(result).toEqual({ status: "rate_limited" });
    expect(d.callRpc).not.toHaveBeenCalled();
  });

  it("limit liczony per IP, w przestrzeni checkoutu", async () => {
    const checkRateLimit = vi.fn(async () => ({ success: true }));
    await submitCheckoutCore(VALID_INPUT, deps({ ip: "198.51.100.9", checkRateLimit }));

    expect(checkRateLimit).toHaveBeenCalledWith("checkout:ip:198.51.100.9", CHECKOUT_RATE_LIMIT);
  });
});

describe("walidacja — mapa pole→błąd", () => {
  async function fieldsFor(input: unknown): Promise<Record<string, string>> {
    const result = await submitCheckoutCore(input, deps());
    expect(result.status, `oczekiwano validation_error, dostano ${result.status}`).toBe(
      "validation_error",
    );
    return (result as { fields: Record<string, string> }).fields;
  }

  it("brak akceptacji regulaminu → terms required, baza nietknięta", async () => {
    const d = deps();
    const result = await submitCheckoutCore({ ...VALID_INPUT, termsAccepted: false }, d);
    expect(result).toEqual({ status: "validation_error", fields: { terms: "required" } });
    expect(d.callRpc, "zamówienie bez zgody dotarło do bazy").not.toHaveBeenCalled();
  });

  it("issue invalid_value z Zod 4 za regulamin i własny issue punktu dają dokładnie nasze komunikaty PL/EN", async () => {
    const terms = toCheckoutFieldErrors({
      issues: [
        {
          code: "invalid_value",
          input: false,
          path: ["termsAccepted"],
          message: "Invalid input: expected true",
        },
      ],
    } as never);
    const pickup = checkoutSchema.safeParse({
      ...VALID_INPUT,
      pickupLocationId: undefined,
    });
    const hostileTerms = await submitCheckoutCore(
      { ...VALID_INPUT, termsAccepted: false },
      deps(),
    );

    expect(terms).toEqual({ terms: "required" });
    expect(hostileTerms).toEqual({ status: "validation_error", fields: { terms: "required" } });
    expect(JSON.stringify(hostileTerms)).not.toContain("Invalid input");
    if (pickup.success) throw new Error("Brak odmowy za brak punktu odbioru.");
    expect(toCheckoutFieldErrors(pickup.error)).toEqual({
      pickupLocationId: "required",
    });
    expect(pl.storefront.checkout.errors.terms).toBe("Zaakceptuj regulamin, aby kontynuować.");
    expect(en.storefront.checkout.errors.terms).toBe("Accept the terms to continue.");
    expect(pl.storefront.checkout.errors.pickupLocationId).toBe("Wybierz punkt odbioru.");
    expect(en.storefront.checkout.errors.pickupLocationId).toBe("Choose a pickup point.");
  });

  it("zły e-mail → email zdefiniowany", async () => {
    expect((await fieldsFor({ ...VALID_INPUT, email: "nie-email" })).email).toBeDefined();
  });

  it("puste imię i nazwisko → fullName required", async () => {
    expect(await fieldsFor({ ...VALID_INPUT, fullName: "" })).toEqual({ fullName: "required" });
  });

  it("zakres dat odwrócony → endDate invalid", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, startDate: "2026-10-07", endDate: "2026-10-01" });
    expect(fields.endDate).toBe("invalid");
  });

  it("odbiór osobisty bez punktu → pickupLocationId required", async () => {
    const { pickupLocationId: _omit, ...noPickup } = VALID_INPUT;
    expect(await fieldsFor(noPickup)).toEqual({ pickupLocationId: "required" });
  });

  it("punkt odbioru przy dostawie (nie-pickup) → not_allowed", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, deliveryMethod: "courier" });
    expect(fields.pickupLocationId).toBe("not_allowed");
  });

  it("pusty koszyk → items required", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, items: [] });
    expect(fields.items).toBeDefined();
  });

  it("metoda dostawy spoza zbioru → invalid", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, deliveryMethod: "teleport", pickupLocationId: undefined });
    expect(fields.deliveryMethod).toBe("invalid");
  });
});

describe("bramka captcha (Turnstile)", () => {
  it("odmowa weryfikatora → captcha_failed, baza NIE jest ruszana", async () => {
    // DOWÓD MUTACYJNY: usunięcie tej bramki z rdzenia (albo zmiana `if (!ok)` na
    // przepuszczenie) sprawi, że przy captcha ok:false wynik nie będzie już
    // captcha_failed, a callRpc zostanie wywołane — oba asserty się spalą.
    const d = deps({ verifyCaptcha: vi.fn(async () => ({ ok: false })) });
    const result = await submitCheckoutCore({ ...VALID_INPUT, captchaToken: "zly" }, d);

    expect(result).toEqual({ status: "captcha_failed" });
    expect(d.callRpc, "odrzucona captcha dotarła do bazy").not.toHaveBeenCalled();
  });

  it("captcha stoi ZA walidacją — błędne wejście nie woła weryfikatora", async () => {
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    await submitCheckoutCore({ email: "nie-email" }, deps({ verifyCaptcha }));
    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it("weryfikator dostaje token z wejścia", async () => {
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    await submitCheckoutCore({ ...VALID_INPUT, captchaToken: "tok-42" }, deps({ verifyCaptcha }));
    expect(verifyCaptcha).toHaveBeenCalledWith("tok-42");
  });
});

describe("kwoty liczy SERWER — wejście ich nie niesie", () => {
  it("do RPC nie idzie żadna kwota (pozycje = tylko product_id + quantity)", async () => {
    const callRpc = vi.fn(async (_args: CheckoutRpcArgs) => RPC_RESULT);
    // Klient DOKLEJA pola kwotowe — muszą zostać zignorowane (schemat ich nie zna).
    await submitCheckoutCore(
      {
        ...VALID_INPUT,
        items: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            quantity: 1,
            rentalGrosze: 1,
            priceGrosze: 1,
          },
        ],
        totalRentalGrosze: 1,
      },
      deps({ callRpc }),
    );

    const args = callRpc.mock.calls[0]![0] as unknown as Record<string, unknown>;
    // Żaden argument RPC nie jest kwotą.
    expect(Object.keys(args).some((k) => /total|grosze|price|amount/i.test(k))).toBe(false);
    // Pozycje niosą wyłącznie product_id + quantity.
    expect(args.p_items).toEqual([
      { product_id: "22222222-2222-4222-8222-222222222222", quantity: 1 },
    ]);
  });
});

describe("mapowanie SQLSTATE na status", () => {
  function rpcThrowing(code?: string) {
    return vi.fn(async () => {
      const err = new Error("db error dla klient@example.com") as CheckoutRpcError;
      if (code) err.code = code;
      throw err;
    });
  }

  it("23P01 (egzemplarz zajęty) → unavailable", async () => {
    const result = await submitCheckoutCore(VALID_INPUT, deps({ callRpc: rpcThrowing("23P01") }));
    expect(result).toEqual({ status: "unavailable" });
  });

  it("22023 (odmowa walidacyjna serwera) → rejected", async () => {
    const result = await submitCheckoutCore(VALID_INPUT, deps({ callRpc: rpcThrowing("22023") }));
    expect(result).toEqual({ status: "rejected" });
  });

  it("nieznany błąd → server_error, bez wycieku treści błędu bazy", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitCheckoutCore(VALID_INPUT, deps({ callRpc: rpcThrowing() }));
    expect(result).toEqual({ status: "server_error" });
    expect(JSON.stringify(result)).not.toContain("klient@example.com");
    consoleError.mockRestore();
  });
});

describe("ścieżka sukcesu", () => {
  it("poprawne wejście → success z podsumowaniem, e-maile po utrwaleniu", async () => {
    const sendEmails = vi.fn(async () => []);
    const result = await submitCheckoutCore(VALID_INPUT, deps({ sendEmails }));

    expect(result.status).toBe("success");
    expect((result as { order: { orderNumber: string } }).order.orderNumber).toBe("AV-2026-001");
    expect(sendEmails, "e-maile nie zostały wywołane po utrwaleniu").toHaveBeenCalledWith(RPC_RESULT);
  });

  it("błąd poczty NIE cofa zamówienia — wchodzi jako emailIssues do wyniku", async () => {
    const sendEmails = vi.fn(async () => ["potwierdzenie nie wyszło"]);
    const result = await submitCheckoutCore(VALID_INPUT, deps({ sendEmails }));

    expect(result.status).toBe("success");
    expect((result as { emailIssues?: string[] }).emailIssues).toEqual(["potwierdzenie nie wyszło"]);
  });

  it("sukces NIE niesie adresu powiadomień najemcy ani konfiguracji nadawcy", async () => {
    const result = await submitCheckoutCore(VALID_INPUT, deps());
    const serialized = JSON.stringify(result);
    // notify_email / email_sender.reply_to są server-only (kontrakt 2.4b ich nie ma).
    expect(serialized).not.toContain("biuro@najemca.example");
  });

  /**
   * log_token (0021/ADR-045) to DOWÓD wykonania checkoutu — kto go ma, ten
   * może dopisać wpis do dziennika tego zamówienia. Wyciek do przeglądarki
   * oddawałby tę zdolność każdemu, kto otworzy narzędzia deweloperskie, czyli
   * przywracał dokładnie tę powierzchnię, którą token zamyka. Ta sama
   * dyscyplina co notify_email (ADR-042).
   */
  it("sukces NIE niesie log_tokenu — token nie opuszcza serwera", async () => {
    const result = await submitCheckoutCore(VALID_INPUT, deps());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(RPC_RESULT.log_token);
    // Nie tylko wartość: samo POLE nie może się pojawić pod żadną nazwą —
    // asercja na wartości przepuściłaby przemianowanie klucza przy zachowaniu
    // treści (np. gdyby kontrakt zaczął zwracać całe `rpc`).
    expect(serialized).not.toContain("log_token");
    expect(serialized).not.toContain("logToken");
  });

  it("kontrakt 2.4b bez zmian — sukces niesie DOKŁADNIE podsumowanie zamówienia", async () => {
    // Regresja na wypadek, gdyby ktoś kiedyś zbudował odpowiedź rozlewając
    // `...rpc` zamiast wymieniać pola: wtedy KAŻDE nowe pole server-only
    // (log_token, notify_email, email_sender) wyciekłoby przy okazji.
    const result = await submitCheckoutCore(VALID_INPUT, deps());
    expect(result.status).toBe("success");
    const order = (result as unknown as { order: Record<string, unknown> }).order;
    expect(Object.keys(order).sort()).toEqual(
      [
        "currency",
        "deliveryGrosze",
        "deliveryMethod",
        "endDate",
        "items",
        "orderNumber",
        "orderStatus",
        "paymentMethod",
        "paymentStatus",
        "startDate",
        "totalDepositGrosze",
        "totalRentalGrosze",
      ].sort(),
    );
  });
});

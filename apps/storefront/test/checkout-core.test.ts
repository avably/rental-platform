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
    // Bilet zaufanej granicy (0059) — atrapa o stałej wartości. Rdzeń go nie
    // interpretuje, tylko PRZEKAZUJE do RPC; że powstaje dopiero za captchą,
    // dowodzi osobny przypadek niżej.
    issueTicket: vi.fn(() => ({ exp: 2_000_000_000, nonce: "nonce-testowy", sig: "sig-testowy" })),
    callRpc: vi.fn(async () => RPC_RESULT),
    sendEmails: vi.fn(async () => []),
    // Domyślnie sklep BEZ płatności online — tor offline i tak działa
    // (ADR-066), więc istniejące przypadki tej suity nic nie tracą.
    readOnlineAvailability: vi.fn(async () => ({ stripeConfigured: false, chargesEnabled: false })),
    // Domyślnie najemca ma opublikowane OBA dokumenty i deklaracja z wejścia
    // ("1.0" w INPUT niżej) idzie trybem integracji — istniejące przypadki
    // suity badają inne bramki i mają przez tę przechodzić. Bramkę ADR-191
    // bada osobny describe, nadpisując te dwa porty.
    readLegalDocuments: vi.fn(async () => [
      { kind: "terms" as const, version_label: "v1" },
      { kind: "privacy" as const, version_label: "v1" },
    ]),
    termsFromRegistry: false,
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

describe("bramka dokumentów prawnych (H-COMP-01, ADR-191)", () => {
  it("brak opublikowanego regulaminu → legal_documents_missing; RPC, captcha i pola własne NIE ruszane", async () => {
    const d = deps({
      readLegalDocuments: vi.fn(async () => [{ kind: "privacy" as const, version_label: "v1" }]),
    });
    const result = await submitCheckoutCore(VALID_INPUT, d);

    expect(result).toEqual({ status: "legal_documents_missing" });
    expect(d.callRpc, "odmowa dotarła do bazy").not.toHaveBeenCalled();
    // Bramka stoi PRZED captchą (token jest jednorazowy — nie palimy go na
    // żądaniu, które i tak odrzucimy) i PRZED odczytem definicji pól.
    expect(d.verifyCaptcha).not.toHaveBeenCalled();
    expect(d.readCustomFields).not.toHaveBeenCalled();
  });

  it("brak opublikowanej polityki prywatności → legal_documents_missing (komplet, nie sam regulamin)", async () => {
    const d = deps({
      readLegalDocuments: vi.fn(async () => [{ kind: "terms" as const, version_label: "v1" }]),
    });
    const result = await submitCheckoutCore(VALID_INPUT, d);
    expect(result).toEqual({ status: "legal_documents_missing" });
    expect(d.callRpc).not.toHaveBeenCalled();
  });

  it("pusty spis (fail-closed transportu w warstwie odczytu) → legal_documents_missing", async () => {
    const d = deps({ readLegalDocuments: vi.fn(async () => []) });
    const result = await submitCheckoutCore(VALID_INPUT, d);
    expect(result).toEqual({ status: "legal_documents_missing" });
    expect(d.callRpc).not.toHaveBeenCalled();
  });

  it("port RZUCAJĄCY to niewiedza, nie brak dokumentów → server_error (wzorzec readCustomFields)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      readLegalDocuments: vi.fn(async () => {
        throw new Error("transport padł");
      }),
    });
    const result = await submitCheckoutCore(VALID_INPUT, d);
    expect(result).toEqual({ status: "server_error" });
    expect(d.callRpc).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("tryb rejestru: deklaracja spoza żywej etykiety → rejected, RPC NIE wołane", async () => {
    // Storefront i embed renderują zgodę z rejestru — ich deklaracja MUSI być
    // etykietą żywej wersji. "1.0" (dawna stała) przestaje mieć jak przejść.
    const d = deps({ termsFromRegistry: true });
    const result = await submitCheckoutCore({ ...VALID_INPUT, termsVersion: "1.0" }, d);
    expect(result).toEqual({ status: "rejected" });
    expect(d.callRpc).not.toHaveBeenCalled();
  });

  it("tryb rejestru: deklaracja równa żywej etykiecie przechodzi do RPC (kontrola pozytywna)", async () => {
    const d = deps({ termsFromRegistry: true });
    const result = await submitCheckoutCore({ ...VALID_INPUT, termsVersion: "v1" }, d);
    expect(result.status).toBe("success");
    expect(d.callRpc).toHaveBeenCalledTimes(1);
  });

  it("tryb integracji: własna stała wersji przechodzi do RPC przy komplecie dokumentów (dług ADR-129d)", async () => {
    const d = deps({ termsFromRegistry: false });
    const result = await submitCheckoutCore({ ...VALID_INPUT, termsVersion: "1.0" }, d);
    expect(result.status).toBe("success");
    expect(d.callRpc).toHaveBeenCalledTimes(1);
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

describe("bilet zaufanej granicy (0059, ADR-125)", () => {
  it("bilet powstaje DOPIERO po zaliczonej captchy — odmowa nie wystawia biletu", async () => {
    // SEDNO BRAMKI. Bilet jest zaświadczeniem o zaliczonych bramkach, więc
    // wystawiony przed nimi nie zaświadcza niczego. Ten assert jest jedynym
    // miejscem, które pilnuje KOLEJNOŚCI — przesunięcie `deps.issueTicket()`
    // ponad `verifyCaptcha` nie zepsułoby żadnego innego testu w repo.
    const d = deps({ verifyCaptcha: vi.fn(async () => ({ ok: false })) });
    const result = await submitCheckoutCore({ ...VALID_INPUT, captchaToken: "zly" }, d);

    expect(result).toEqual({ status: "captcha_failed" });
    expect(d.issueTicket, "bilet wystawiony mimo odrzuconej captchy").not.toHaveBeenCalled();
  });

  it("bilet nie powstaje, gdy odbiją go wcześniejsze bramki (honeypot, limit, walidacja)", async () => {
    const honeypot = deps();
    await submitCheckoutCore({ ...VALID_INPUT, honeypot: "bot" }, honeypot);
    expect(honeypot.issueTicket).not.toHaveBeenCalled();

    const limit = deps({ checkRateLimit: vi.fn(async () => ({ success: false })) });
    await submitCheckoutCore(VALID_INPUT, limit);
    expect(limit.issueTicket).not.toHaveBeenCalled();

    const walidacja = deps();
    await submitCheckoutCore({ email: "nie-email" }, walidacja);
    expect(walidacja.issueTicket).not.toHaveBeenCalled();
  });

  it("trzy pola biletu jadą do RPC bez zmian", async () => {
    const callRpc = vi.fn(async (_args: CheckoutRpcArgs) => RPC_RESULT);
    await submitCheckoutCore(
      VALID_INPUT,
      deps({
        callRpc,
        issueTicket: vi.fn(() => ({ exp: 1_899_000_000, nonce: "n-abc", sig: "s-xyz" })),
      }),
    );

    // DOWÓD MUTACYJNY: usunięcie któregokolwiek z tych trzech pól z argumentów
    // RPC pali ten assert. W produkcji objawiłoby się odrzuceniem KAŻDEGO
    // checkoutu przez bramkę biletu — ale dopiero po zasianiu sekretu, bo
    // lokalnie i w CI baza stoi na dev-skipie.
    const args = callRpc.mock.calls[0]?.[0] as CheckoutRpcArgs;
    expect(args.p_ticket_exp).toBe(1_899_000_000);
    expect(args.p_ticket_nonce).toBe("n-abc");
    expect(args.p_ticket_sig).toBe("s-xyz");
  });

  it("bilet pusty (dev-skip wystawcy) przechodzi przez rdzeń jako trzy null-e", async () => {
    // Rdzeń NIE interpretuje biletu i nie ma prawa go blokować: o dev-skipie
    // decyduje wyłącznie baza (brak aktywnego klucza). Gdyby rdzeń odrzucał
    // pusty bilet, dev i CI straciłyby działający checkout.
    const callRpc = vi.fn(async (_args: CheckoutRpcArgs) => RPC_RESULT);
    const result = await submitCheckoutCore(
      VALID_INPUT,
      deps({ callRpc, issueTicket: vi.fn(() => ({ exp: null, nonce: null, sig: null })) }),
    );

    expect(result.status).toBe("success");
    const args = callRpc.mock.calls[0]?.[0] as CheckoutRpcArgs;
    expect([args.p_ticket_exp, args.p_ticket_nonce, args.p_ticket_sig]).toEqual([null, null, null]);
  });

  it("odmowa biletu z bazy (22023) → rejected, bez zdradzania, że to bramka biletu", async () => {
    const error = new Error("Sesja zamawiania wygasła") as CheckoutRpcError;
    error.code = "22023";
    const result = await submitCheckoutCore(
      VALID_INPUT,
      deps({ callRpc: vi.fn(async () => { throw error; }) }),
    );
    expect(result).toEqual({ status: "rejected" });
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
  function rpcThrowing(code?: string, detail?: string, hint?: string) {
    return vi.fn(async () => {
      const err = new Error("db error dla klient@example.com") as CheckoutRpcError;
      if (code) err.code = code;
      if (detail) err.detail = detail;
      if (hint) err.hint = hint;
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

  it("22023 + detail 'legal_documents_missing' → legal_documents_missing (wyścig cofnięcia publikacji)", async () => {
    // Formularz wyrenderowany, najemca cofnął publikację, submit poszedł:
    // warstwa akcji mogła jeszcze widzieć komplet, ale baza (0086) już nie.
    // Znacznik z DETAIL (jedyny obok terms_outdated — ADR-181) daje klientowi
    // zdanie o dokumentach zamiast ogólnej odmowy.
    const result = await submitCheckoutCore(
      VALID_INPUT,
      deps({ callRpc: rpcThrowing("22023", "legal_documents_missing") }),
    );
    expect(result).toEqual({ status: "legal_documents_missing" });
  });

  it("22023 z innym detail (np. terms_outdated) zostaje przy rejected", async () => {
    const result = await submitCheckoutCore(
      VALID_INPUT,
      deps({ callRpc: rpcThrowing("22023", "terms_outdated") }),
    );
    expect(result).toEqual({ status: "rejected" });
  });

  it("PT422 + hint 'min_rental_days' → min_rental_days z liczbą z DETAIL (0089, ADR-202)", async () => {
    // Bramka minimum najmu w bazie: DETAIL niesie SAMĄ liczbę minimum,
    // HINT — znacznik kategorii. Warstwa TS składa z liczby zdanie
    // „minimum X dni" — bez parsowania komunikatu regexem.
    const result = await submitCheckoutCore(
      VALID_INPUT,
      deps({ callRpc: rpcThrowing("PT422", "3", "min_rental_days") }),
    );
    expect(result).toEqual({ status: "min_rental_days", minDays: 3 });
  });

  it("PT422 min_rental_days z nieparsowalnym DETAIL spada do rejected (bez zmyślania liczby)", async () => {
    for (const detail of [undefined, "", "abc", "0", "-2", "3.5"]) {
      const result = await submitCheckoutCore(
        VALID_INPUT,
        deps({ callRpc: rpcThrowing("PT422", detail, "min_rental_days") }),
      );
      expect(result, `detail=${JSON.stringify(detail)}`).toEqual({ status: "rejected" });
    }
  });

  it("PT422 BEZ hintu min_rental_days → server_error (nieznana odmowa PT nie udaje minimum)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitCheckoutCore(
      VALID_INPUT,
      deps({ callRpc: rpcThrowing("PT422", "3") }),
    );
    expect(result).toEqual({ status: "server_error" });
    consoleError.mockRestore();
  });

  it("23514 (naruszenie CHECK-a pól własnych po scaleniu) → rejected, nie server_error (#7)", async () => {
    // Osiągalne przez scalenie mapy klienta w app.public_checkout: zła wartość,
    // za długa, opcja spoza listy albo 8192 B na mapie. To odmowa DANYCH klienta
    // (422), nie awaria serwera (500).
    const result = await submitCheckoutCore(VALID_INPUT, deps({ callRpc: rpcThrowing("23514") }));
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

describe("odczyt definicji pól własnych — fail-closed (#3)", () => {
  it("błąd odczytu definicji ZAMYKA ścieżkę (server_error), a RPC NIE jest wołane", async () => {
    // getPublicCustomFields RZUCA na błąd transportu (0058): błąd ≠ „brak pól".
    // Bez tego chwilowy blip zdejmowałby wymagalność i przepuszczał zamówienie
    // bez pola oznaczonego jako WYMAGANE. Fail-closed: odmowa, nie ciche {}.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const callRpc = vi.fn(async () => RPC_RESULT);
    const readCustomFields = vi.fn(async () => {
      throw new Error("Odczyt definicji pól własnych nie powiódł się (57014).");
    });
    const result = await submitCheckoutCore(VALID_INPUT, deps({ callRpc, readCustomFields }));

    expect(result).toEqual({ status: "server_error" });
    expect(callRpc, "zamówienie dotarło do bazy mimo nieznanej wymagalności").not.toHaveBeenCalled();
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

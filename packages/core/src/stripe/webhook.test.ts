/**
 * Rdzeń webhooka płatności (Z4, ADR-067) — testy CZYSTE, bez sieci i bazy.
 *
 * Trzy osie, każda z osobnym powodem istnienia:
 *
 *   1. PODPIS — bramka autorstwa. Każda ścieżka odmowy ma tu własny przypadek,
 *      bo „nie przeszło" bez powodu jest nieodróżnialne od „przeszło źle".
 *   2. PARSER — dowód, że z ciała NIE DA SIĘ wyciągnąć stanu. Nie „nie
 *      wyciągamy", tylko „nie da się": zwracany typ ma trzy stringi.
 *   3. WERDYKT — tłumaczenie ODCZYTU na oś statusów, jedyne w repo.
 *
 * Zegar jest wstrzykiwany wszędzie, gdzie ma znaczenie: test okna tolerancji
 * zależny od `Date.now()` byłby zielony przez 299 sekund i czerwony przez
 * jedną — czyli byłby testem loterii.
 */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { IntentRead } from "./types";
import {
  OBSERVED_INTENT_EVENTS,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  isObservedIntentEvent,
  parseStripeEvent,
  settlementVerdict,
  signStripeWebhook,
  verifyStripeSignature,
} from "./webhook";

const SECRET = "whsec_ZmFrZS1zZWtyZXQtd2ViaG9va2E";
const NOW = new Date("2026-07-22T10:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));

function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt_test_1",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_test_1", status: "succeeded", amount_received: 123_45 } },
    ...overrides,
  });
}

function header(payload: string, timestamp = TIMESTAMP, secret = SECRET): string {
  return `t=${timestamp},v1=${signStripeWebhook({ secret, timestamp, payload })}`;
}

const read = (overrides: Partial<IntentRead> = {}): IntentRead => ({
  intentId: "pi_test_1",
  status: "succeeded",
  amountReceivedGrosze: 12_345,
  amountGrosze: 12_345,
  // Małe litery jak w odpowiedzi dostawcy — konwersję wielkości robi werdykt.
  currency: "pln",
  ...overrides,
});

// -----------------------------------------------------------------------
// 1. Podpis
// -----------------------------------------------------------------------

describe("verifyStripeSignature", () => {
  it("przyjmuje żądanie podpisane sekretem endpointu", () => {
    const payload = eventBody();
    expect(verifyStripeSignature({ secret: SECRET, header: header(payload), payload, now: NOW }))
      .toEqual({ ok: true });
  });

  /**
   * KONTRAKT DOSTAWCY, NIE NASZA WYGODA: podpisywana treść to
   * `${timestamp}.${ciało}`, klucz to CAŁY sekret `whsec_...` jako UTF-8,
   * wynik w hex. Ten test przypina każdy z tych trzech szczegółów osobno —
   * gdyby implementacja zdejmowała prefiks `whsec_` (jak robi to schemat
   * Standard Webhooks w lib/standard-webhook.ts) albo kodowała base64,
   * podpis liczony niezależnie tutaj przestałby pasować.
   */
  it("liczy podpis dokładnie tak, jak opisuje dokumentacja dostawcy", () => {
    const payload = eventBody();
    const independent = createHmac("sha256", SECRET)
      .update(`${TIMESTAMP}.${payload}`, "utf8")
      .digest("hex");

    expect(signStripeWebhook({ secret: SECRET, timestamp: TIMESTAMP, payload })).toBe(independent);
    expect(
      verifyStripeSignature({
        secret: SECRET,
        header: `t=${TIMESTAMP},v1=${independent}`,
        payload,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  /**
   * SEDNO BRAMKI: podpis zgadza się z CIAŁEM, nie ze zdarzeniem. Podmiana
   * jednego znaku w payloadzie przy zachowanym nagłówku musi odpaść — to
   * jest dokładnie ta ścieżka, którą handler odsyła 400 bez zapisu.
   */
  it("odrzuca PODMIENIONE ciało przy niezmienionym nagłówku podpisu", () => {
    const original = eventBody();
    const signed = header(original);
    const tampered = eventBody({ id: "evt_podmienione" });

    const result = verifyStripeSignature({
      secret: SECRET,
      header: signed,
      payload: tampered,
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      reason: "signature_mismatch",
      message: expect.stringContaining("Podpis"),
    });
  });

  it("odrzuca podpis policzony CUDZYM sekretem", () => {
    const payload = eventBody();
    const result = verifyStripeSignature({
      secret: SECRET,
      header: header(payload, TIMESTAMP, "whsec_cudzy_sekret"),
      payload,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature_mismatch");
  });

  /**
   * BRAK SEKRETU = ODMOWA, nie „przepuść w dev". Bez tego endpoint bez
   * konfiguracji przyjmowałby dowolny POST z internetu i oznaczał zamówienia
   * jako opłacone — odwrotność dev-skipu Turnstile (ADR-032), bo tam brak
   * CAPTCHY jest nieszkodliwy, a tu stawką są pieniądze.
   */
  it("brak sekretu jest ODMOWĄ, nie przepustką", () => {
    const payload = eventBody();
    const result = verifyStripeSignature({
      secret: undefined,
      header: header(payload),
      payload,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("secret_not_configured");
  });

  it("brak nagłówka podpisu jest odmową", () => {
    const payload = eventBody();
    const result = verifyStripeSignature({ secret: SECRET, header: null, payload, now: NOW });
    expect(result.ok === false && result.reason).toBe("missing_header");
  });

  it("nagłówek bez podpisu v1 jest odmową — schemat v0 NIE jest akceptowany", () => {
    const payload = eventBody();
    const result = verifyStripeSignature({
      secret: SECRET,
      // `v0` to schemat testowy dostawcy o innej konstrukcji. Przyjęcie go
      // „na wszelki wypadek" byłoby dziurą otwartą własnoręcznie.
      header: `t=${TIMESTAMP},v0=${signStripeWebhook({ secret: SECRET, timestamp: TIMESTAMP, payload })}`,
      payload,
      now: NOW,
    });
    expect(result.ok === false && result.reason).toBe("header_malformed");
  });

  it("akceptuje nagłówek z KILKOMA podpisami v1 (rotacja sekretu u dostawcy)", () => {
    const payload = eventBody();
    const ours = signStripeWebhook({ secret: SECRET, timestamp: TIMESTAMP, payload });
    const theirs = signStripeWebhook({ secret: "whsec_stary", timestamp: TIMESTAMP, payload });

    expect(
      verifyStripeSignature({
        secret: SECRET,
        header: `t=${TIMESTAMP},v1=${theirs},v1=${ours}`,
        payload,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  /**
   * Bez okna tolerancji podpis raz podsłuchany byłby ważny WIECZNIE.
   * Granica sprawdzana z obu stron — test „stare odpada" bez testu „świeże
   * przechodzi" byłby zielony także dla weryfikatora odrzucającego wszystko.
   */
  it("odrzuca żądanie starsze niż okno tolerancji, przyjmuje na jego granicy", () => {
    const payload = eventBody();
    const stale = String(Math.floor(NOW.getTime() / 1000) - STRIPE_WEBHOOK_TOLERANCE_SECONDS - 1);
    const edge = String(Math.floor(NOW.getTime() / 1000) - STRIPE_WEBHOOK_TOLERANCE_SECONDS);

    const staleResult = verifyStripeSignature({
      secret: SECRET,
      header: header(payload, stale),
      payload,
      now: NOW,
    });
    expect(staleResult.ok === false && staleResult.reason).toBe("timestamp_out_of_tolerance");

    expect(
      verifyStripeSignature({ secret: SECRET, header: header(payload, edge), payload, now: NOW }),
    ).toEqual({ ok: true });
  });

  it("odrzuca znacznik czasu z PRZYSZŁOŚCI poza oknem (przestawiony zegar nadawcy)", () => {
    const payload = eventBody();
    const future = String(Math.floor(NOW.getTime() / 1000) + STRIPE_WEBHOOK_TOLERANCE_SECONDS + 1);
    const result = verifyStripeSignature({
      secret: SECRET,
      header: header(payload, future),
      payload,
      now: NOW,
    });
    expect(result.ok === false && result.reason).toBe("timestamp_out_of_tolerance");
  });
});

// -----------------------------------------------------------------------
// 2. Parser — dowód, że stanu NIE DA SIĘ wziąć z ciała
// -----------------------------------------------------------------------

describe("parseStripeEvent", () => {
  it("zwraca WYŁĄCZNIE id zdarzenia, typ i id obiektu", () => {
    const parsed = parseStripeEvent(eventBody());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.event).toEqual({
      id: "evt_test_1",
      type: "payment_intent.succeeded",
      objectId: "pi_test_1",
    });
    // Klucze koperty są WYLICZONE, nie sprawdzone „czy zawiera": dopisanie
    // `status` albo `amount` do zwracanego kształtu ma zapalić ten test,
    // bo od tej chwili stan byłby dostępny wołającemu pod ręką.
    expect(Object.keys(parsed.event).sort()).toEqual(["id", "objectId", "type"]);
  });

  it("ignoruje status i kwotę z ciała, choćby były sprzeczne z rzeczywistością", () => {
    // Typ zdarzenia i status obiektu CELOWO się rozjeżdżają — gdyby parser
    // przepuszczał którekolwiek pole stanu, znalazłoby się w kopercie.
    const parsed = parseStripeEvent(
      JSON.stringify({
        id: "evt_x",
        type: "payment_intent.processing",
        data: { object: { id: "pi_x", status: "succeeded", amount_received: 999_999_99 } },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.event).toEqual({
      id: "evt_x",
      type: "payment_intent.processing",
      objectId: "pi_x",
    });
    expect(JSON.stringify(parsed.event)).not.toContain("99999999");
    expect(JSON.stringify(parsed.event)).not.toContain("succeeded");
  });

  it("odrzuca ciało, które nie jest JSON-em", () => {
    expect(parseStripeEvent("nie-json").ok).toBe(false);
  });

  it("odrzuca zdarzenie bez identyfikatora obiektu — nie ma czego odczytać", () => {
    const result = parseStripeEvent(
      JSON.stringify({ id: "evt_x", type: "payment_intent.succeeded", data: { object: {} } }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("data.object.id");
  });

  it("odrzuca zdarzenie bez id albo typu", () => {
    expect(parseStripeEvent(JSON.stringify({ type: "x", data: { object: { id: "pi" } } })).ok).toBe(
      false,
    );
    expect(parseStripeEvent(JSON.stringify({ id: "evt", data: { object: { id: "pi" } } })).ok).toBe(
      false,
    );
  });
});

describe("isObservedIntentEvent", () => {
  it("obejmuje succeeded, payment_failed i processing", () => {
    expect(isObservedIntentEvent("payment_intent.succeeded")).toBe(true);
    expect(isObservedIntentEvent("payment_intent.payment_failed")).toBe(true);
    expect(isObservedIntentEvent("payment_intent.processing")).toBe(true);
  });

  it("nie obejmuje zdarzeń spoza cyklu płatności zamówienia", () => {
    expect(isObservedIntentEvent("customer.created")).toBe(false);
    expect(isObservedIntentEvent("account.updated")).toBe(false);
  });

  it("lista obserwowanych typów dotyczy WYŁĄCZNIE obiektu payment_intent", () => {
    // Gdyby na listę wjechał typ innego obiektu, handler wykonałby
    // `readPaymentIntent` na identyfikatorze, który intentem nie jest.
    for (const type of OBSERVED_INTENT_EVENTS) {
      expect(type.startsWith("payment_intent.")).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------
// 3. Werdykt — z ODCZYTU, nie ze zdarzenia
// -----------------------------------------------------------------------

describe("settlementVerdict", () => {
  it("succeeded z pełną kwotą → paid", () => {
    expect(settlementVerdict(read(), 12_345, "PLN")).toEqual({ status: "paid", reason: "" });
  });

  it("nadpłata też jest opłaceniem", () => {
    expect(settlementVerdict(read({ amountReceivedGrosze: 20_000 }), 12_345, "PLN").status).toBe(
      "paid",
    );
  });

  /**
   * PŁATNOŚĆ CZĘŚCIOWA TEŻ BYWA `succeeded`. Sam status nie wystarcza —
   * i to nie jest przypadek brzegowy, tylko normalny skutek zmiany kwoty
   * w locie. Werdykt `null` (a nie `payment_failed`) jest tu świadomy:
   * pieniądze WPŁYNĘŁY, więc „nieudana płatność" byłoby kłamstwem w drugą
   * stronę. To stan dla człowieka.
   */
  it("succeeded z NIEPEŁNĄ kwotą NIE jest opłaceniem", () => {
    const verdict = settlementVerdict(read({ amountReceivedGrosze: 12_344 }), 12_345, "PLN");
    expect(verdict.status).toBeNull();
    expect(verdict.reason).toContain("12344");
    expect(verdict.reason).toContain("12345");
  });

  /**
   * WALUTA JEST CZĘŚCIĄ KWOTY (K3, ADR-103): 12 345 jednostek podrzędnych
   * EUR to nie jest 12 345 groszy PLN. Zamówienie utrwala walutę przy
   * narodzinach (orders.currency, 0049) i intent powstaje z tej pary — więc
   * rozjazd waluty przy werdykcie oznacza, że dostawca zaksięgował INNĄ
   * kwotę, niż mówi liczba. Werdykt `null` z powodem (stan dla człowieka),
   * lustro płatności częściowej: pieniądze wpłynęły, tylko nie te.
   */
  it("succeeded z pełną liczbą w INNEJ walucie NIE jest opłaceniem", () => {
    const verdict = settlementVerdict(read({ currency: "eur" }), 12_345, "PLN");
    expect(verdict.status).toBeNull();
    expect(verdict.reason.toUpperCase()).toContain("EUR");
    expect(verdict.reason.toUpperCase()).toContain("PLN");
  });

  it("porównanie waluty jest niewrażliwe na wielkość liter (dostawca mówi małymi)", () => {
    expect(settlementVerdict(read({ currency: "pln" }), 12_345, "PLN").status).toBe("paid");
    expect(settlementVerdict(read({ currency: "EUR" }), 12_345, "EUR").status).toBe("paid");
  });

  it("odczyt bez waluty NIE dowodzi opłacenia (domyślna odmowa, jak przy kwocie)", () => {
    const verdict = settlementVerdict(read({ currency: "" }), 12_345, "PLN");
    expect(verdict.status).toBeNull();
  });

  it("requires_payment_method i canceled → payment_failed", () => {
    expect(
      settlementVerdict(read({ status: "requires_payment_method" }), 12_345, "PLN").status,
    ).toBe("payment_failed");
    expect(settlementVerdict(read({ status: "canceled" }), 12_345, "PLN").status).toBe(
      "payment_failed",
    );
  });

  it("processing i requires_action nie zmieniają statusu zamówienia", () => {
    for (const status of ["processing", "requires_action", "requires_confirmation"]) {
      const verdict = settlementVerdict(read({ status }), 12_345, "PLN");
      expect(verdict.status, `status ${status}`).toBeNull();
      expect(verdict.reason).toContain(status);
    }
  });

  /**
   * KONTROLA KIERUNKU (mutacja „pisz status z ciała zdarzenia"): funkcja
   * przyjmuje ODCZYT, więc zdarzenie niosące `succeeded` dla intentu, który
   * u dostawcy jest `requires_payment_method`, nie ma jak dać `paid` —
   * werdykt liczy się z tego, co odpowiedział dostawca.
   */
  it("nie ma jak zbudować werdyktu z ciała zdarzenia — wejściem jest odczyt", () => {
    const verdictFromRead = settlementVerdict(
      read({ status: "requires_payment_method" }),
      12_345,
      "PLN",
    );
    expect(verdictFromRead.status).toBe("payment_failed");
    expect(verdictFromRead.status).not.toBe("paid");
  });

  it("nieznany status dostawcy nie ustawia niczego (zamiast zgadywać)", () => {
    const verdict = settlementVerdict(read({ status: "nowy_status_dostawcy" }), 12_345, "PLN");
    expect(verdict.status).toBeNull();
    expect(verdict.reason).toContain("nowy_status_dostawcy");
  });
});

/**
 * Webhook dostawcy płatności — weryfikacja podpisu, parser zdarzenia
 * i tłumaczenie ODCZYTU na naszą oś statusów (Z4, ADR-067).
 *
 * ================== REGUŁA NACZELNA TEGO PLIKU ==================
 *
 * PODPIS DOWODZI AUTORSTWA, NIE AKTUALNOŚCI. Poprawny `Stripe-Signature`
 * mówi dokładnie dwie rzeczy: „to wysłał dostawca" i „nikt tego po drodze
 * nie zmienił". NIE MÓWI „tak jest teraz". Dostawca nie gwarantuje
 * kolejności dostaw i ponawia zdarzenia po awariach — ciało, które właśnie
 * przyszło, może opisywać stan sprzed kwadransa, a zaraz po nim może
 * przyjść starsze.
 *
 * DLATEGO Z CIAŁA BIERZEMY WYŁĄCZNIE IDENTYFIKATORY. `parseStripeEvent`
 * zwraca trzy stringi: id zdarzenia (idempotencja), typ (czy nas obchodzi)
 * i id obiektu (co odczytać). Kwota, status i waluta z ciała NIE PRZECHODZĄ
 * przez ten parser — nie dlatego, że parser ich nie umie odczytać, tylko
 * dlatego, że nie wolno ich użyć. Gdyby przechodziły, pierwszy wołający
 * miałby je pod ręką i użyłby ich „bo już są".
 *
 * To załatwia jednym ruchem trzy różne problemy:
 *   1. NIEAKTUALNOŚĆ — odczyt jest z chwili decyzji, nie z chwili wysyłki,
 *   2. KOLEJNOŚĆ — dwa zdarzenia dostarczone odwrotnie dają ten sam odczyt,
 *   3. SFAŁSZOWANE CIAŁO przy wyciekłym sekrecie — napastnik z sekretem
 *      podpisze dowolny payload, ale nie zmieni tego, co dostawca odpowie
 *      na `GET /v1/payment_intents/{id}` z NASZYM kluczem.
 *
 * To jest PIĄTE wystąpienie wzorca „sygnał ≠ dowód" z ADR-049 (po powrocie
 * z onboardingu Connect, `POST /v1/accounts`, powrocie z płatności
 * i `confirmPayment()` w przeglądarce) — pierwsze, w którym sygnał jest
 * KRYPTOGRAFICZNIE UWIERZYTELNIONY. I właśnie dlatego jest najgroźniejszy:
 * podpis wygląda jak dowód wszystkiego, a dowodzi tylko autorstwa.
 *
 * ŹRÓDŁO KONTRAKTU (sprawdzone przed implementacją, nie zgadywane):
 * https://docs.stripe.com/webhooks#verify-manually
 *   - nagłówek `Stripe-Signature`: lista par `klucz=wartość` rozdzielona
 *     PRZECINKAMI; `t` to sekundy epoki, `v1` to podpis schematu bieżącego
 *     (może wystąpić WIELOKROTNIE — rotacja sekretu po stronie dostawcy),
 *     `v0` to schemat testowy, którego NIE akceptujemy,
 *   - podpisywana treść: `${t}.${surowe_ciało}` — kropka jako separator,
 *   - HMAC-SHA256, klucz = CAŁY sekret `whsec_...` jako bajty UTF-8,
 *     wynik w HEKSADECYMALNYM zapisie.
 *
 * UWAGA NA RÓŻNICĘ WOBEC `lib/standard-webhook.ts` (Supabase Auth, ADR-048):
 * tam sekret jest base64 z prefiksem do ZDJĘCIA, podpis w base64, a treść to
 * `id.timestamp.body`. Tutaj sekret idzie DOSŁOWNIE (z prefiksem `whsec_`),
 * podpis jest hex, a treść to `timestamp.body`. Dwa podobne schematy, cztery
 * różnice — przepisanie tamtej implementacji „bo wygląda tak samo" dałoby
 * weryfikator, który odrzuca wszystko (w najlepszym razie) albo przyjmuje
 * cudze podpisy (w najgorszym). Dlatego to osobny plik, nie parametr tamtego.
 *
 * ROBIMY TO SAMI, ZAMIAST CIĄGNĄĆ SDK. Cała operacja to jeden HMAC
 * z `node:crypto`; wzorzec repo dla integracji zewnętrznych jest właśnie taki
 * (`verifyTurnstile`, port Resend, `StripeConnectClient`): jawny kod,
 * wstrzykiwany czas, zero sieci w testach.
 *
 * MODUŁ JEST CZYSTY. Zero `fetch`, zero bazy, zero `process.env`, zero
 * `Date.now()` bez możliwości podmiany. Handler (apps/panel) składa z tych
 * funkcji ścieżkę i to on rozmawia ze światem.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { PaymentStatus } from "../rental/order-status";
import type { IntentRead } from "./types";

/** Nagłówek podpisu. Czytany case-insensitive — nagłówki HTTP nie mają wielkości liter. */
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

/**
 * Tolerancja znacznika czasu — pięć minut, wartość domyślna weryfikatora
 * dostawcy. Bez niej podpis raz podsłuchany byłby ważny WIECZNIE: napastnik
 * z nagraniem jednego zdarzenia `payment_intent.succeeded` mógłby je odtwarzać
 * bez końca. (Sam replay rozbiłby się jeszcze o unikat `event_id` w bazie —
 * ale bramka czasu jest tańsza i stoi PRZED zapisem.)
 */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type StripeSignatureFailure =
  | "secret_not_configured"
  | "missing_header"
  | "header_malformed"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch";

export type StripeSignatureResult =
  | { ok: true }
  | { ok: false; reason: StripeSignatureFailure; message: string };

export interface VerifyStripeSignatureInput {
  /** Sekret endpointu (`whsec_...`) — CAŁY, bez zdejmowania prefiksu. */
  secret: string | undefined;
  /** Wartość nagłówka `Stripe-Signature`. */
  header: string | null | undefined;
  /**
   * SUROWE ciało żądania, bajt w bajt. Ponowna serializacja JSON-a (choćby
   * `JSON.stringify(JSON.parse(body))`) zmienia białe znaki i kolejność
   * kluczy — podpis liczony z takiego tekstu nigdy się nie zgodzi, a objaw
   * („wszystko odrzucone") nie wskazuje przyczyny.
   */
  payload: string;
  /** Czas do porównania ze znacznikiem; wstrzykiwany, żeby test nie zależał od zegara. */
  now?: Date;
}

/** Porównanie odporne na atak czasowy; różne długości zwracają false bez rzucania. */
function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Rozbiera nagłówek na znacznik czasu i WSZYSTKIE podpisy schematu `v1`.
 *
 * Wpisy o nierozpoznanym schemacie (`v0` i cokolwiek, co dostawca doda
 * w przyszłości) są POMIJANE, nigdy akceptowane „na wszelki wypadek":
 * `v0` to schemat testowy o innej konstrukcji i przyjęcie go byłoby dziurą
 * otwartą własnoręcznie.
 */
function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } | null {
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value.length > 0) signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function signStripeWebhook(input: {
  secret: string;
  timestamp: string;
  payload: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.payload}`, "utf8")
    .digest("hex");
}

/**
 * FAIL-CLOSED BEZ WYJĄTKÓW. Każda ścieżka, która nie jest UDOWODNIONYM
 * dopasowaniem podpisu, kończy się odmową — łącznie z brakiem sekretu.
 *
 * Nie ma tu odpowiednika dev-skipu z Turnstile (ADR-032) i nie może być:
 * ten endpoint stoi otworem na internet, a jego skutkiem jest przejście
 * zamówienia w `paid`. Przepuszczenie żądania bez sekretu oznaczałoby, że
 * dowolny obcy oznacza sobie zamówienia jako opłacone jednym POST-em.
 */
export function verifyStripeSignature(input: VerifyStripeSignatureInput): StripeSignatureResult {
  if (!input.secret) {
    return {
      ok: false,
      reason: "secret_not_configured",
      message: "Webhook nie jest skonfigurowany (brak AVABLY_STRIPE_WEBHOOK_SECRET).",
    };
  }
  if (!input.header) {
    return {
      ok: false,
      reason: "missing_header",
      message: "Brak nagłówka Stripe-Signature.",
    };
  }

  const parsed = parseSignatureHeader(input.header);
  if (!parsed) {
    return {
      ok: false,
      reason: "header_malformed",
      message: "Nagłówek Stripe-Signature nie zawiera znacznika czasu i podpisu v1.",
    };
  }

  const seconds = Number(parsed.timestamp);
  if (!Number.isFinite(seconds)) {
    return {
      ok: false,
      reason: "header_malformed",
      message: "Znacznik czasu w nagłówku Stripe-Signature nie jest liczbą sekund.",
    };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: "timestamp_out_of_tolerance",
      message: "Znacznik czasu żądania jest poza dopuszczalnym oknem.",
    };
  }

  const expected = signStripeWebhook({
    secret: input.secret,
    timestamp: parsed.timestamp,
    payload: input.payload,
  });

  // Wystarczy JEDEN pasujący podpis — nagłówek niesie ich kilka w trakcie
  // rotacji sekretu u dostawcy.
  if (!parsed.signatures.some((signature) => equalsConstantTime(signature, expected))) {
    return {
      ok: false,
      reason: "signature_mismatch",
      message: "Podpis żądania nie zgadza się z sekretem webhooka.",
    };
  }

  return { ok: true };
}

// -----------------------------------------------------------------------
// Parser zdarzenia
// -----------------------------------------------------------------------

/**
 * WSZYSTKO, co wolno wziąć z ciała zdarzenia. Trzy stringi — i ani jednego
 * pola opisującego STAN.
 *
 * `objectId` to `data.object.id`, czyli identyfikator obiektu, którego
 * zdarzenie dotyczy. To jedyne, do czego ciało służy: powiedzieć, O CO
 * ZAPYTAĆ dostawcę.
 */
export interface StripeEventEnvelope {
  /** `evt_...` — klucz idempotencji. Ten sam przy każdej ponownej dostawie. */
  id: string;
  /** np. `payment_intent.succeeded` — decyduje, czy zdarzenie nas obchodzi. */
  type: string;
  /** `data.object.id` — np. `pi_...`. JEDYNY nośnik treści z ciała. */
  objectId: string;
}

export type StripeEventParseResult =
  | { ok: true; event: StripeEventEnvelope }
  | { ok: false; message: string };

/**
 * Wyciąga kopertę zdarzenia z SUROWEGO ciała.
 *
 * Bez `zod`, choć jest w zależnościach: schemat zod z trzema polami kusiłby,
 * żeby „przy okazji" dopisać `data.object.status` i `amount` — a to jest
 * dokładnie ta linijka, której ten plik ma nie mieć. Ręczne wyłuskanie trzech
 * stringów nie zostawia miejsca na „przy okazji".
 */
export function parseStripeEvent(payload: string): StripeEventParseResult {
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return { ok: false, message: "Ciało zdarzenia nie jest poprawnym JSON-em." };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Ciało zdarzenia nie jest obiektem." };
  }

  const record = body as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const type = typeof record.type === "string" ? record.type : "";
  const data = record.data;
  const object =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).object
      : undefined;
  const objectId =
    typeof object === "object" && object !== null
      ? typeof (object as Record<string, unknown>).id === "string"
        ? ((object as Record<string, unknown>).id as string)
        : ""
      : "";

  if (!id || !type) {
    return { ok: false, message: "Zdarzenie nie ma identyfikatora albo typu." };
  }
  if (!objectId) {
    return { ok: false, message: "Zdarzenie nie wskazuje obiektu (data.object.id)." };
  }

  return { ok: true, event: { id, type, objectId } };
}

/**
 * Typy zdarzeń, po których SIĘGAMY PO ODCZYT.
 *
 * Ta lista NIE JEST mapą „typ → status". Typ zdarzenia odpowiada wyłącznie na
 * pytanie „czy warto teraz zapytać dostawcę o ten obiekt" — o to, JAKI jest
 * stan, pyta się `readPaymentIntent`. Dlatego `payment_intent.processing`
 * jest tu obok `succeeded`: oba znaczą tyle samo, czyli „coś się z tą
 * płatnością wydarzyło, sprawdź".
 *
 * Zdarzenia spoza listy są REJESTROWANE (mamy ślad, że przyszły) i zostawiane
 * bez zapisu stanu — cisza po nierozpoznanym typie byłaby nieodróżnialna od
 * awarii endpointu.
 */
export const OBSERVED_INTENT_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.processing",
  "payment_intent.canceled",
  "payment_intent.requires_action",
  "payment_intent.amount_capturable_updated",
] as const;

export function isObservedIntentEvent(type: string): boolean {
  return (OBSERVED_INTENT_EVENTS as readonly string[]).includes(type);
}

/**
 * Werdykt o zamówieniu, wyprowadzony WYŁĄCZNIE z odczytu u dostawcy.
 *
 * `status: null` znaczy „odczyt nie uprawnia do żadnego przejścia" i NIE jest
 * porażką — tak wygląda płatność w toku. `reason` niesie powód dla rejestru
 * zdarzeń; jest niepusty także przy `status: null`, bo „nic nie zrobiliśmy
 * i oto dlaczego" musi dać się przeczytać po fakcie.
 */
export interface SettlementVerdict {
  status: PaymentStatus | null;
  reason: string;
}

/**
 * Tłumaczy ODCZYT płatności na naszą oś `payment_status`. JEDYNE miejsce
 * w repo, w którym to tłumaczenie istnieje (Z3 świadomie go nie ma).
 *
 * Wejściem jest `IntentRead` — wynik `GET /v1/payment_intents/{id}` — a nie
 * zdarzenie. Podpis funkcji jest tu częścią bariery: nie da się jej podać
 * ciała webhooka, więc nie da się przez pomyłkę zbudować statusu z payloadu.
 *
 * TRZY WARUNKI NA `paid`, WSZYSTKIE KONIECZNE (lustro `isIntentSettled`):
 * dostawca mówi `succeeded` **i** zaksięgowana kwota pokrywa sumę policzoną
 * przez NASZ serwer, **i** [K3/ADR-103] księgowanie szło w walucie
 * ZAMÓWIENIA (`orders.currency`, 0049 — ta sama para kwota+waluta, z której
 * intent POWSTAŁ). Sam status nie wystarcza — płatność częściowa też bywa
 * `succeeded`, a zamówienie opłacone w połowie nie jest opłacone; sama
 * liczba też nie wystarcza — 12 345 centów EUR to nie 12 345 groszy PLN.
 * Rozjazd kwoty ALBO waluty daje `null` z powodem, nie `paid` i nie
 * `payment_failed`: to stan wymagający człowieka, a nie automatycznego
 * werdyktu w którąkolwiek stronę. Porównanie waluty jest niewrażliwe na
 * wielkość liter (dostawca mówi małymi, kolumna wielkimi); pusta waluta
 * odczytu NIE przechodzi jako zgodna (domyślna odmowa, jak przy kwocie).
 */
export function settlementVerdict(
  read: IntentRead,
  expectedGrosze: number,
  expectedCurrency: string,
): SettlementVerdict {
  switch (read.status) {
    case "succeeded":
      if (read.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
        return {
          status: null,
          reason:
            `Dostawca zgłasza succeeded w walucie ${read.currency || "(nieznanej)"} ` +
            `wobec oczekiwanej ${expectedCurrency} — zamówienie NIE zostało oznaczone jako opłacone.`,
        };
      }
      if (read.amountReceivedGrosze >= expectedGrosze) {
        return { status: "paid", reason: "" };
      }
      return {
        status: null,
        reason:
          `Dostawca zgłasza succeeded, ale zaksięgowano ${read.amountReceivedGrosze} gr ` +
          `wobec oczekiwanych ${expectedGrosze} gr — zamówienie NIE zostało oznaczone jako opłacone.`,
      };

    // Odrzucona/wygasła próba. `requires_payment_method` po próbie znaczy
    // dokładnie „karta nie przeszła, podaj inną" — zamówienie żyje, klient
    // ponawia (mapa 0027: payment_failed → pending).
    case "requires_payment_method":
    case "canceled":
      return { status: "payment_failed", reason: "" };

    // Płatność w toku: przelew bankowy, BLIK czekający na potwierdzenie,
    // 3-D Secure. NIE ustawiamy niczego — zamówienie jest już `pending`
    // od chwili związania płatności (0029), a `pending → pending` byłoby
    // zapisem bez treści.
    default:
      return {
        status: null,
        reason: `Płatność w stanie ${read.status} — brak podstawy do zmiany statusu zamówienia.`,
      };
  }
}

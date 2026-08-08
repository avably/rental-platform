/**
 * Port Stripe Connect Express (Z2, ADR-065). Wzorzec portu zewnętrznego
 * z ADR-031 (klient kurierski) i ADR-046 (port domen):
 *
 *   1. `fetch` WSTRZYKIWANY (`fetchFn`) — testy kontraktowe biegną na
 *      nagranych odpowiedziach, CI nie dotyka sieci ani konta dostawcy.
 *   2. Konfiguracja per INSTANCJA, nie moduł. To nie jest estetyka: cache
 *      klienta albo klucza na poziomie modułu w procesie obsługującym wielu
 *      najemców to podszywanie się między nimi (lekcja ADR-031). Klasa nie ma
 *      ŻADNEGO stanu statycznego i test tego pilnuje.
 *   3. ZERO logowania na konsolę; diagnostykę niesie `StripeApiError`
 *      (status, kod i typ błędu dostawcy). Klucz nie ma jak trafić do logu,
 *      bo nic nie logujemy, a komunikaty przechodzą przez `redactSecretKey`.
 *   4. Brak konfiguracji = twardy `StripeConfigError` z konstruktora, nigdy
 *      cichy sukces ani atrapa konta.
 *
 * ADR-049 W KSZTAŁCIE TYPÓW, NIE W KOMENTARZU. `createAccount` zwraca SAM
 * IDENTYFIKATOR — mimo że odpowiedź dostawcy niesie komplet pól gotowości
 * (`charges_enabled`, `payouts_enabled`, `details_submitted`). Odpowiedź na
 * `POST` dowodzi wyłącznie tego, że BYT POWSTAŁ; o gotowości mówi dopiero
 * `readAccount`. Gdyby metoda zwracała stan, pierwszy wołający zapisałby go
 * do bazy „bo już go ma" — i mielibyśmy awarię 2.6b (kolumna `verified`
 * ustawiona bez dowodu) na osi pieniędzy.
 */
import { resolveStripeConfig, type StripeConfigOptions } from "./config";
import type {
  ConnectAccountState,
  CreateIntentParams,
  CreateRefundParams,
  IntentHandle,
  IntentRead,
  OnboardingLink,
  OnboardingUrls,
  RefundRead,
  StripeConfig,
} from "./types";

export const STRIPE_API_BASE = "https://api.stripe.com";

/**
 * Wersja API przypięta JAWNIE. Bez tego nagłówka dostawca użyłby wersji
 * domyślnej konta — czyli konfiguracji, która żyje w cudzym dashboardzie
 * i potrafi się zmienić bez naszego wdrożenia. Kształt odpowiedzi, na którym
 * stoją nasze bramki (`charges_enabled`, `requirements.currently_due`),
 * przestałby być kontraktem.
 */
export const STRIPE_API_VERSION = "2024-06-20";

/** Typ konta Connect. Express: dostawca prowadzi KYC i utrzymuje formularz. */
export const CONNECT_ACCOUNT_TYPE = "express";

export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly type?: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/**
 * Ostatnia zapora przed wyciekiem klucza do UI i do `payment_accounts.last_error`:
 * komunikat dostawcy bywa echem żądania, a `last_error` trafia na ekran najemcy
 * i do bazy. Wycinamy klucz BEZWARUNKOWO, zamiast ufać, że dostawca go nie
 * odbije — koszt jednej podmianki, zysk: sekret nie ma ścieżki na zewnątrz.
 */
export function redactSecretKey(message: string, secretKey: string): string {
  if (!secretKey) return message;
  return message.split(secretKey).join("[usunięto]");
}

/** Odpowiedź błędu dostawcy: `{ error: { type, code, message } }`. */
interface StripeErrorBody {
  error?: { type?: string; code?: string; message?: string };
}

/** Wycinek odpowiedzi konta, na którym nam zależy (reszta pól ignorowana). */
interface StripeAccountBody {
  id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
}

interface StripeAccountLinkBody {
  url?: string;
  expires_at?: number;
}

/**
 * Wycinek odpowiedzi refundu (Z5). `status` i `amount` są tu odczytywane
 * WYŁĄCZNIE na ścieżce `readRefund` — `createRefund` bierze z tego ciała
 * sam `id` i nic więcej (uzasadnienie przy metodzie).
 */
interface StripeRefundBody {
  id?: string;
  status?: string;
  amount?: number;
  payment_intent?: string | null;
  failure_reason?: string | null;
}

/**
 * Wycinek odpowiedzi PaymentIntentu (Z3). `amount_received` jest tu POLEM
 * OSOBNYM od `amount` z rozmysłu: `amount` to nasza deklaracja o tym, ile
 * chcieliśmy pobrać, a `amount_received` — jedyna liczba mówiąca, ile
 * dostawca faktycznie zaksięgował. Porównanie ich z sumą policzoną przez
 * NASZ serwer jest bramką Z4; tu udostępniamy obie, żeby było co porównać.
 */
interface StripePaymentIntentBody {
  id?: string;
  client_secret?: string;
  status?: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  /** Sekundy epoki powstania płatności — podstawa progu porzucenia (L11). */
  created?: number;
}

/**
 * Ciało żądania w formacie dostawcy: `application/x-www-form-urlencoded`
 * z nawiasową notacją zagnieżdżenia (`capabilities[transfers][requested]`).
 * Piszemy własny koder zamiast ciągnąć SDK: port ma trzy wywołania, a SDK
 * przyniosłoby własny transport, którego nie da się wstrzyknąć w teście.
 */
export function encodeStripeForm(
  value: Record<string, unknown>,
  prefix = "",
): string {
  const parts: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof entry === "object" && !Array.isArray(entry)) {
      const nested = encodeStripeForm(entry as Record<string, unknown>, name);
      if (nested) parts.push(nested);
      continue;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
      });
      continue;
    }
    parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(entry))}`);
  }
  return parts.join("&");
}

/**
 * Wymagania blokujące konto TERAZ: `currently_due` + `past_due`. Świadomie
 * BEZ `eventually_due` — tamto jest zapowiedzią przyszłych progów (np. po
 * przekroczeniu obrotu), a nie powodem, dla którego konto dziś nie działa.
 * Wrzucenie ich do jednej listy kazałoby najemcy z działającym kontem
 * uzupełniać dane, o które nikt jeszcze nie prosi.
 */
function requirementsDue(body: StripeAccountBody): string[] {
  const requirements = body.requirements ?? {};
  const merged = [...(requirements.currently_due ?? []), ...(requirements.past_due ?? [])];
  return [...new Set(merged)];
}

function toAccountState(id: string, body: StripeAccountBody): ConnectAccountState {
  return {
    providerAccountId: body.id ?? id,
    // Porównanie z `true`, nie rzutowanie: brak pola w odpowiedzi (dryf
    // kształtu, starsza wersja API) ma znaczyć NIEGOTOWE. Domyślna gotowość
    // przy nieznanym kształcie to definicja cichego sukcesu.
    chargesEnabled: body.charges_enabled === true,
    payoutsEnabled: body.payouts_enabled === true,
    detailsSubmitted: body.details_submitted === true,
    requirementsDue: requirementsDue(body),
    disabledReason: body.requirements?.disabled_reason ?? null,
  };
}

export interface StripeConnectClientOptions extends StripeConfigOptions {
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
}

/** Dane konta zakładanego najemcy — MINIMUM, resztę zbiera dostawca w KYC. */
export interface CreateConnectAccountInput {
  /** Kod kraju ISO-3166-1 alpha-2 rejestracji działalności najemcy. */
  country: string;
  /** Adres kontaktowy najemcy (dostawca użyje go do korespondencji KYC). */
  email?: string;
  /**
   * Klucz idempotencji dostawcy. Bez niego dwuklik zakłada DWA konta,
   * a drugie zostaje sierotą, o której nikt nie wie (wiersz w bazie jest
   * jeden — PK po tenant_id). Wołający buduje go z identyfikatora najemcy.
   * UWAGA: dostawca pamięta klucz ~24h i odtwarza pierwotną odpowiedź.
   */
  idempotencyKey?: string;
}

export class StripeConnectClient {
  private readonly config: StripeConfig;
  private readonly fetchFn: typeof fetch;

  /** Rzuca `StripeConfigError`, gdy brak/sprzeczna konfiguracja — nigdy atrapa. */
  constructor(options: StripeConnectClientOptions = {}) {
    this.config = resolveStripeConfig(options);
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  private async request(
    path: string,
    init: RequestInit & { idempotencyKey?: string; stripeAccount?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const { idempotencyKey, stripeAccount, ...rest } = init;
    let response: Response;
    try {
      response = await this.fetchFn(`${STRIPE_API_BASE}${path}`, {
        ...rest,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": STRIPE_API_VERSION,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          // Płatność powstaje NA KONCIE NAJEMCY (charge bezpośredni), nie na
          // koncie platformy z późniejszym przelewem. Ten nagłówek jest całą
          // różnicą: bez niego środki lądują u NAS, a najemca ma je dostać
          // od swojego klienta. Nagłówek wchodzi wyłącznie tam, gdzie
          // wołający podał konto — konto puste nie ma tu prawa być domyślne.
          ...(stripeAccount ? { "Stripe-Account": stripeAccount } : {}),
          ...rest.headers,
        },
      });
    } catch (error) {
      // Awaria transportu (DNS/timeout) — komunikat wołającego, nie stack
      // trace dostawcy. Redakcja i tu: komunikat sieciowy bywa echem żądania.
      const detail = error instanceof Error ? error.message : String(error);
      throw new StripeApiError(
        redactSecretKey(`Połączenie z API płatności nie powiodło się: ${detail}`, this.config.secretKey),
      );
    }

    // Nie-JSON (strona serwisowa dostawcy) staje się treścią błędu niżej,
    // zamiast po cichu udawać poprawną odpowiedź (wzorzec ADR-031).
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: { message: text.slice(0, 200) } };
      }
    }
    return { status: response.status, body };
  }

  private fail(status: number, body: unknown): StripeApiError {
    const error = (body as StripeErrorBody | null)?.error;
    const message = error?.message ?? `API płatności odpowiedziało ${status}`;
    return new StripeApiError(
      redactSecretKey(message, this.config.secretKey),
      status,
      error?.code,
      error?.type,
    );
  }

  /**
   * Zakłada konto Connect Express najemcy i zwraca WYŁĄCZNIE jego identyfikator.
   *
   * Zdolności (`card_payments`, `transfers`) prosimy od razu: bez nich konto
   * powstaje, ale nie ma jak przyjąć płatności ani przekazać środków najemcy,
   * a formularz KYC nie wie, o co pytać.
   */
  async createAccount(input: CreateConnectAccountInput): Promise<string> {
    const { status, body } = await this.request("/v1/accounts", {
      method: "POST",
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      body: encodeStripeForm({
        type: CONNECT_ACCOUNT_TYPE,
        country: input.country,
        ...(input.email ? { email: input.email } : {}),
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      }),
    });

    if (status < 200 || status >= 300) throw this.fail(status, body);

    const id = (body as StripeAccountBody | null)?.id;
    if (!id) {
      // Dostawca powiedział „utworzone", a nie podał czym. Cokolwiek to znaczy
      // po jego stronie, dla nas znaczy jedno: nie mamy do czego wrócić.
      throw new StripeApiError("API płatności nie zwróciło identyfikatora konta.");
    }
    return id;
  }

  /**
   * JEDYNE źródło stanu konta (ADR-049). Każde miejsce, które twierdzi
   * cokolwiek o gotowości najemcy — ekran, powrót z onboardingu, przyszła
   * płatność w Z3 — przechodzi TĘDY.
   */
  async readAccount(providerAccountId: string): Promise<ConnectAccountState> {
    const { status, body } = await this.request(
      `/v1/accounts/${encodeURIComponent(providerAccountId)}`,
      { method: "GET" },
    );

    if (status >= 200 && status < 300) {
      return toAccountState(providerAccountId, (body ?? {}) as StripeAccountBody);
    }
    throw this.fail(status, body);
  }

  /**
   * Link do formularza KYC. Jednorazowy i krótkożyjący z decyzji dostawcy —
   * nie zapisujemy go w bazie, bo zapisany link to link nieaktualny.
   */
  async createOnboardingLink(
    providerAccountId: string,
    urls: OnboardingUrls,
  ): Promise<OnboardingLink> {
    const { status, body } = await this.request("/v1/account_links", {
      method: "POST",
      body: encodeStripeForm({
        account: providerAccountId,
        refresh_url: urls.refreshUrl,
        return_url: urls.returnUrl,
        type: "account_onboarding",
      }),
    });

    if (status < 200 || status >= 300) throw this.fail(status, body);

    const link = (body ?? {}) as StripeAccountLinkBody;
    if (!link.url) throw new StripeApiError("API płatności nie zwróciło adresu onboardingu.");
    return { url: link.url, expiresAt: link.expires_at ?? 0 };
  }

  /**
   * Tworzy PaymentIntent NA KONCIE NAJEMCY.
   *
   * KWOTA IDZIE BEZ PRZELICZANIA. `amountGrosze` to ta sama liczba, którą
   * policzył nasz serwer, i ta sama, którą dostawca zaksięguje — najmniejsza
   * jednostka waluty po obu stronach. Każde `/100` albo `* 100` w tym miejscu
   * to pobranie stukrotnie złej kwoty; dlatego wartość nie przechodzi tu przez
   * ŻADNĄ arytmetykę, a test tabelaryczny pilnuje bajtów ciała żądania.
   *
   * IDEMPOTENCJA JEST PARAMETREM WYMAGANYM, nie opcją: klucz budowany
   * z `orders.id` sprawia, że dwuklik „Zapłać" i ponowne wejście na krok
   * płatności odtwarzają TEN SAM intent zamiast obciążać klienta drugi raz.
   */
  async createPaymentIntent(input: CreateIntentParams): Promise<IntentHandle> {
    const { status, body } = await this.request("/v1/payment_intents", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      stripeAccount: input.connectedAccountId,
      body: encodeStripeForm({
        amount: input.amountGrosze,
        // Dostawca oczekuje kodu waluty małymi literami; nasza oś trzyma go
        // wielkimi (plans.currency). Jedyna dopuszczalna „konwersja" kwoty
        // w tym pliku dotyczy WIELKOŚCI LITER, nie liczby.
        currency: input.currency.toLowerCase(),
        application_fee_amount: input.applicationFeeGrosze,
        // Metody płatności (BLIK/P24/karta) włącza najemca w panelu dostawcy —
        // lista NIE jest zaszyta u nas. Dopisanie nowej metody w kraju najemcy
        // ma być jego decyzją, nie naszym wdrożeniem.
        automatic_payment_methods: { enabled: true },
        // Po tym polu Z4 odnajduje zamówienie, gdy webhook przyniesie sam
        // identyfikator intentu. Metadane są DODATKIEM do wiązania w bazie
        // (orders.provider_payment_intent_id), nie jego zamiennikiem:
        // metadane u dostawcy są edytowalne z jego panelu.
        metadata: { order_id: input.orderId },
      }),
    });

    if (status < 200 || status >= 300) throw this.fail(status, body);

    const intent = (body ?? {}) as StripePaymentIntentBody;
    if (!intent.id || !intent.client_secret) {
      throw new StripeApiError("API płatności nie zwróciło danych płatności.");
    }
    return {
      intentId: intent.id,
      clientSecret: intent.client_secret,
      // Status prosto od dostawcy, BEZ tłumaczenia na naszą oś. Mapowanie
      // „succeeded → paid" nie należy do portu i nie powstanie tutaj (Z4).
      status: intent.status ?? "unknown",
    };
  }

  /**
   * JEDYNE źródło prawdy o płatności (ADR-049) — lustro `readAccount`.
   *
   * Zwraca `amountReceivedGrosze` ODDZIELNIE od statusu, bo to dwie różne
   * informacje: status mówi, w jakiej fazie jest próba, a kwota — ile
   * naprawdę wpłynęło. Zamówienie opłacone częściowo ma status `succeeded`
   * przy kwocie mniejszej niż nasza suma i tylko porównanie liczb to wyłapie.
   */
  async readPaymentIntent(
    intentId: string,
    connectedAccountId: string,
  ): Promise<IntentRead> {
    const { status, body } = await this.request(
      `/v1/payment_intents/${encodeURIComponent(intentId)}`,
      { method: "GET", stripeAccount: connectedAccountId },
    );

    if (status < 200 || status >= 300) throw this.fail(status, body);

    const intent = (body ?? {}) as StripePaymentIntentBody;
    return {
      intentId: intent.id ?? intentId,
      status: intent.status ?? "unknown",
      // Brak pola = ZERO pobrane. Domyślna kwota „taka, o jaką prosiliśmy"
      // przy nieznanym kształcie odpowiedzi oznaczałaby uznanie zamówienia
      // za opłacone bez ani jednej złotówki — ten sam kształt błędu, co
      // domyślna gotowość konta w `toAccountState`.
      amountReceivedGrosze: typeof intent.amount_received === "number" ? intent.amount_received : 0,
      amountGrosze: typeof intent.amount === "number" ? intent.amount : 0,
      // [K3/ADR-103] Brak pola = waluta NIEZNANA (""), nie „ta, o którą
      // prosiliśmy" — ten sam kierunek domyślności co przy kwocie: nieznana
      // waluta nie przejdzie porównania waluty w werdykcie.
      currency: typeof intent.currency === "string" ? intent.currency : "",
      // Brak pola = 0, czyli „nie wiemy, kiedy powstała". Domyślne `now`
      // udawałoby płatność świeżą (nic by nigdy nie wygasło), a domyślne
      // zero wieku od epoki — wiecznie porzuconą. Zero jako JAWNY brak
      // dowodu zostawia decyzję wołającemu, który umie ją odmówić.
      createdAtSeconds: typeof intent.created === "number" ? intent.created : 0,
    };
  }

  /**
   * Anuluje płatność u dostawcy i NIE ZWRACA STANU — ta sama bariera
   * w kształcie typu, co przy `createAccount` i `createRefund` (ADR-049).
   *
   * Odpowiedź na `POST /v1/payment_intents/{id}/cancel` niesie komplet pól
   * intentu, więc wołający miałby status pod ręką i użyłby go „bo już jest".
   * A to jest dokładnie ten status, którego użyć nie wolno: anulowanie bywa
   * ODRZUCONE przez dostawcę, gdy klient zapłacił sekundę wcześniej —
   * i wtedy prawdą jest `succeeded`, o którym mówi wyłącznie ODCZYT
   * wykonany PO tej próbie.
   *
   * Metoda rzuca `StripeApiError` przy odmowie dostawcy. Wołający ma tę
   * odmowę potraktować jak sygnał „sprawdź jeszcze raz", nigdy jak dowód
   * czegokolwiek o pieniądzach.
   */
  async cancelPaymentIntent(intentId: string, connectedAccountId: string): Promise<void> {
    const { status, body } = await this.request(
      `/v1/payment_intents/${encodeURIComponent(intentId)}/cancel`,
      { method: "POST", stripeAccount: connectedAccountId, body: "" },
    );

    if (status < 200 || status >= 300) throw this.fail(status, body);
  }

  /**
   * Zleca CZĘŚCIOWY zwrot płatności i oddaje WYŁĄCZNIE identyfikator refundu.
   *
   * TO, ŻE METODA NIE ZWRACA STATUSU, JEST JEJ NAJWAŻNIEJSZĄ CECHĄ.
   * Odpowiedź dostawcy na `POST /v1/refunds` niesie `status` — i ten status
   * bardzo często brzmi `pending`, bo BLIK i Przelewy24 oddają pieniądze
   * przez system rozliczeniowy, nie natychmiast. Gdyby metoda ten status
   * zwracała, pierwszy wołający zapisałby go do rejestru kaucji „bo już go
   * ma" — i panel twierdziłby „kaucja zwrócona", podczas gdy klient nie ma
   * pieniędzy. O tym, czy zwrot się wydarzył, mówi wyłącznie `readRefund`.
   *
   * To ten sam ruch, co `createAccount` zwracające sam identyfikator konta
   * (Z2) — bariera w KSZTAŁCIE TYPU, nie w komentarzu, którego można nie
   * przeczytać.
   *
   * KWOTA IDZIE BEZ PRZELICZANIA i jest OBOWIĄZKOWA: refund bez `amount`
   * jest u dostawcy refundem PEŁNYM, więc pominięcie kwoty oddałoby
   * klientowi także najem i dostawę. Wartość nie przechodzi tu przez ŻADNĄ
   * arytmetykę — test tabelaryczny pilnuje bajtów ciała żądania.
   */
  async createRefund(input: CreateRefundParams): Promise<string> {
    const { status, body } = await this.request("/v1/refunds", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      stripeAccount: input.connectedAccountId,
      body: encodeStripeForm({
        payment_intent: input.intentId,
        amount: input.amountGrosze,
        // Metadane są ŚLADEM DIAGNOSTYCZNYM, nigdy podstawą decyzji —
        // u dostawcy są edytowalne z jego panelu (ta sama uwaga co przy
        // metadanych intentu w Z3). Wiązanie żyje w naszej bazie:
        // deposit_refunds.provider_reference.
        metadata: { order_id: input.orderId, refund_request_id: input.refundRequestId },
      }),
    });

    if (status < 200 || status >= 300) throw this.fail(status, body);

    const id = (body as StripeRefundBody | null)?.id;
    if (!id) {
      // Dostawca powiedział „przyjęte", a nie podał czego. Bez identyfikatora
      // nie mamy jak zapytać, co się z tymi pieniędzmi stało — a one już
      // mogą być w drodze.
      throw new StripeApiError("API płatności nie zwróciło identyfikatora zwrotu.");
    }
    return id;
  }

  /**
   * JEDYNE źródło prawdy o zwrocie (ADR-049) — lustro `readPaymentIntent`.
   *
   * `amount` bierzemy Z ODCZYTU, nie z naszego żądania: jeśli dostawca oddał
   * inną kwotę niż prosiliśmy, do rejestru kaucji ma wejść to, co oddał.
   * Brak pola = 0, czyli „nie umiemy tego uznać za zwrot" — ta sama zasada,
   * co `amount_received` przy płatności: domyślna kwota „taka, o jaką
   * prosiliśmy" oznaczałaby zaksięgowanie zwrotu, którego nie widzieliśmy.
   */
  async readRefund(refundId: string, connectedAccountId: string): Promise<RefundRead> {
    const { status, body } = await this.request(
      `/v1/refunds/${encodeURIComponent(refundId)}`,
      { method: "GET", stripeAccount: connectedAccountId },
    );

    if (status < 200 || status >= 300) throw this.fail(status, body);

    const refund = (body ?? {}) as StripeRefundBody;
    return {
      refundId: refund.id ?? refundId,
      status: refund.status ?? "unknown",
      amountGrosze: typeof refund.amount === "number" ? refund.amount : 0,
      intentId: typeof refund.payment_intent === "string" ? refund.payment_intent : null,
      failureReason: typeof refund.failure_reason === "string" ? refund.failure_reason : null,
    };
  }
}

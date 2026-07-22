/**
 * Rdzeń akcji checkoutu — bez `next/headers` i bez tworzenia klienta Supabase,
 * więc testowalny wprost (wzorzec lib/waitlist/core.ts). Owijka „use server"
 * (lib/actions/checkout.ts) dostarcza tu tenant_id z nagłówka, IP, wywołanie RPC,
 * weryfikację captchy, rate-limit i wysyłkę e-maili.
 *
 * KOLEJNOŚĆ BRAMEK (celowa): honeypot → rate-limit → walidacja → captcha → RPC.
 * Honeypot i rate-limit są najtańsze i odcinają boty, zanim parser i weryfikator
 * captchy w ogóle ruszą. Captcha stoi ZA walidacją (jak w waitliście): token
 * jest jednorazowy, więc nie palimy go na wejściu, które i tak odrzuci parser.
 */
import { checkoutSchema, toCheckoutFieldErrors } from "./validation";
import { isPaymentMethodAllowed, type OnlinePaymentAvailability } from "./payment-options";
import type { CheckoutInput, CheckoutPaymentMethod, CheckoutResult } from "./contract";

/** Argumenty RPC app.public_checkout (snake_case — kontrakt z bazą). */
export interface CheckoutRpcArgs {
  p_tenant_id: string;
  p_email: string;
  p_full_name: string;
  p_phone: string | null;
  p_start_date: string;
  p_end_date: string;
  p_delivery_method: string;
  p_pickup_location_id: string | null;
  p_items: { product_id: string; quantity: number }[];
  p_terms_version: string;
  p_locale: string | null;
  p_company_name: string | null;
  p_nip: string | null;
  p_address_street: string | null;
  p_address_zip: string | null;
  p_address_city: string | null;
  p_notes: string | null;
  /** Wybór klienta (0029) — zapisywany na zamówieniu, nie trzymany w sesji. */
  p_payment_method: CheckoutPaymentMethod;
}

/**
 * Wynik RPC app.public_checkout (jsonb). Zawiera KONTEKST WYSYŁKI e-maili
 * (email_sender, notify_email) — konsumowany po stronie serwera (sendEmails),
 * NIGDY nieprzepuszczany do przeglądarki (kontrakt CheckoutResult go nie ma).
 */
export interface CheckoutRpcResult {
  /**
   * Identyfikator zamówienia — SERWEROWY, jak `log_token`: jest kluczem
   * idempotencji płatności i uchwytem do kroku płatności, a kontrakt
   * `CheckoutResult` go nie niesie.
   */
  order_id: string;
  order_number: string;
  order_status: "pending";
  payment_status: "unpaid";
  payment_method: CheckoutPaymentMethod;
  payment_provider: "manual" | "stripe";
  start_date: string;
  end_date: string;
  delivery_method: string;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  delivery_grosze: number;
  currency: string;
  items: {
    product_id: string;
    quantity: number;
    unit_rental_grosze: number;
    unit_deposit_grosze: number;
  }[];
  customer: { email: string; full_name: string; locale: string | null };
  tenant: { name: string; locale: string };
  email_sender: { name: string; reply_to: string | null } | null;
  notify_email: string | null;
  /**
   * Token jednorazowy wiążący PÓŹNIEJSZY zapis dziennika wysyłek z TYM
   * checkoutem (0021/ADR-045). Obowiązuje go ta sama dyscyplina co
   * `notify_email` (ADR-042): dane SERWEROWE, konsumowane przez `sendEmails`
   * — kontrakt `CheckoutResult` ich nie zawiera i nie trafiają do przeglądarki.
   */
  log_token: string;
}

/** Błąd RPC nosi standardowy SQLSTATE z PostgREST (patrz mapowanie niżej). */
export interface CheckoutRpcError extends Error {
  code?: string;
}

export interface CheckoutDeps {
  /** tenant_id z nagłówka x-tenant-id (anty-spoofing middleware, ADR-039). */
  tenantId: string;
  /** Klucz rate-limitu (IP żądania). */
  ip: string;
  checkRateLimit: (
    key: string,
    opts: { limit: number; windowSeconds: number },
  ) => Promise<{ success: boolean }>;
  /** Weryfikacja Turnstile (ADR-032) — rdzeń zna tylko wynik. */
  verifyCaptcha: (token: string | undefined) => Promise<{ ok: boolean }>;
  /** Wywołanie app.public_checkout. Rzuca CheckoutRpcError z `code` (SQLSTATE). */
  callRpc: (args: CheckoutRpcArgs) => Promise<CheckoutRpcResult>;
  /**
   * Wysyłka e-maili PO utrwaleniu zamówienia. NIGDY nie rzuca — zwraca listę
   * powodów niewysłania (pustą, gdy wszystko poszło). Zamówienie istnieje
   * niezależnie od poczty (wzorzec 8b).
   */
  sendEmails: (ctx: CheckoutRpcResult) => Promise<string[]>;
  /**
   * Czy tor online jest dziś dostępny w tym sklepie — `chargesEnabled` musi
   * pochodzić z ODCZYTU u dostawcy (ADR-049), nie z kolumny w bazie.
   *
   * Rzucenie z tej funkcji NIE jest awarią checkoutu: rdzeń traktuje je jak
   * „online niedostępne" i przepuszcza tor offline. Odwrotna decyzja
   * (wywalić się na całym checkoucie, bo dostawca nie odpowiada) odebrałaby
   * najemcy również sprzedaż za przelewem — czyli nasza awaria zabierałaby
   * mu pieniądze.
   */
  readOnlineAvailability: () => Promise<OnlinePaymentAvailability>;
  /**
   * Zapamiętuje uchwyt do TEGO checkoutu (ciasteczko `httpOnly`), żeby krok
   * płatności i strona powrotu wiedziały, o które zamówienie chodzi, bez
   * przenoszenia tokenu przez adres URL.
   */
  rememberCheckout: (handle: { orderId: string; token: string }) => Promise<void>;
}

/**
 * Limit ciasny, ale luźniejszy niż waitlista: checkout bywa poprawiany
 * (zła data, ponowna próba po captchy), ale to nadal jedno zdarzenie na osobę.
 * 10/godzinę per IP zostawia zapas na współdzielone NAT-y, a odcina masowe
 * składanie zamówień skryptem.
 */
export const CHECKOUT_RATE_LIMIT = { limit: 10, windowSeconds: 3600 } as const;

function summaryFrom(rpc: CheckoutRpcResult): CheckoutResult {
  const currency =
    rpc.currency === "EUR" || rpc.currency === "USD" ? rpc.currency : "PLN";
  const deliveryMethod =
    rpc.delivery_method === "courier" ||
    rpc.delivery_method === "parcel_locker" ||
    rpc.delivery_method === "own_delivery"
      ? rpc.delivery_method
      : "pickup";

  return {
    status: "success",
    // Krok płatności należy się WYŁĄCZNIE zamówieniu w reżimie online.
    // Warunek patrzy na to, co utrwalił SERWER (`payment_provider` z wiersza),
    // a nie na to, co przysłał klient — inaczej wejście z `paymentMethod:
    // "online"` prowadziłoby na krok płatności zamówienie przelewowe.
    nextStep: rpc.payment_provider === "stripe" ? "payment" : "confirmation",
    order: {
      orderNumber: rpc.order_number,
      orderStatus: "pending",
      paymentStatus: "unpaid",
      paymentMethod: rpc.payment_method,
      startDate: rpc.start_date,
      endDate: rpc.end_date,
      deliveryMethod,
      totalRentalGrosze: rpc.total_rental_grosze,
      totalDepositGrosze: rpc.total_deposit_grosze,
      deliveryGrosze: rpc.delivery_grosze,
      currency,
      items: rpc.items.map((i) => ({
        productId: i.product_id,
        quantity: i.quantity,
        unitRentalGrosze: i.unit_rental_grosze,
        unitDepositGrosze: i.unit_deposit_grosze,
      })),
    },
  };
}

export async function submitCheckoutCore(
  input: unknown,
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const raw = input as Partial<CheckoutInput> | null | undefined;

  // Honeypot PRZED czymkolwiek: bot wypełnia ukryte pole. Cichy odrzut jako
  // „rejected" (LP pokazuje ogólny błąd) — nie zdradzamy, że to bramka na boty.
  if (raw && typeof raw.honeypot === "string" && raw.honeypot.trim() !== "") {
    return { status: "rejected" };
  }

  const limit = await deps.checkRateLimit(`checkout:ip:${deps.ip}`, CHECKOUT_RATE_LIMIT);
  if (!limit.success) return { status: "rate_limited" };

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "validation_error", fields: toCheckoutFieldErrors(parsed.error) };
  }
  const data = parsed.data;

  // Captcha po walidacji, przed zapisem (ADR-032). Fail-closed: odmowa
  // weryfikatora znaczy, że dane nie schodzą głębiej (RPC nie jest wołane).
  const captcha = await deps.verifyCaptcha(data.captchaToken);
  if (!captcha.ok) return { status: "captcha_failed" };

  // BRAMKA WYBORU METODY — przed zapisem, bo zamówienie założone w reżimie
  // ścisłym bez możliwości zapłaty nie ma jak z niego wyjść. Odczyt jest
  // ŚWIEŻY: między wyrenderowaniem formularza a wysłaniem go dostawca mógł
  // zablokować konto najemcy.
  //
  // Porażka odczytu to „online niedostępne", nie „checkout niedostępny":
  // klient wybierający przelew nie ma prawa oberwać awarią integracji,
  // z której nie korzysta (ADR-066).
  let availability: OnlinePaymentAvailability;
  try {
    availability = await deps.readOnlineAvailability();
  } catch {
    availability = { stripeConfigured: false, chargesEnabled: false };
  }
  if (!isPaymentMethodAllowed(data.paymentMethod, availability)) {
    return { status: "payment_unavailable" };
  }

  let rpc: CheckoutRpcResult;
  try {
    rpc = await deps.callRpc({
      p_tenant_id: deps.tenantId,
      p_email: data.email,
      p_full_name: data.fullName,
      p_phone: data.phone ?? null,
      p_start_date: data.startDate,
      p_end_date: data.endDate,
      p_delivery_method: data.deliveryMethod,
      p_pickup_location_id: data.pickupLocationId ?? null,
      p_items: data.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      p_terms_version: data.termsVersion,
      p_locale: data.locale ?? null,
      p_company_name: data.companyName ?? null,
      p_nip: data.nip ?? null,
      p_address_street: data.addressStreet ?? null,
      p_address_zip: data.addressZip ?? null,
      p_address_city: data.addressCity ?? null,
      p_notes: data.notes ?? null,
      p_payment_method: data.paymentMethod,
    });
  } catch (error) {
    const code = (error as CheckoutRpcError).code;
    // 23P01 = egzemplarz zajęty (wyścig / nieaktualny koszyk) → LP odświeża
    // dostępność. 22023 = odmowa walidacyjna serwera (tenant nieaktywny, zła
    // metoda dostawy, produkt zniknął) → ogólny błąd. Reszta → server_error.
    // Treść błędu bazy zostaje w logu serwera; do klienta idzie sam status.
    if (code === "23P01") return { status: "unavailable" };
    if (code === "22023") return { status: "rejected" };
    console.error("[checkout] RPC nie powiódł się", error);
    return { status: "server_error" };
  }

  // Zamówienie UTRWALONE — od tego miejsca nic go już nie cofa. Uchwyt do
  // niego zapamiętujemy PRZED pocztą i niezależnie od niej: bez uchwytu krok
  // płatności nie miałby jak rozpoznać zamówienia, a klient utknąłby
  // z rezerwacją, której nie da się opłacić.
  //
  // Uchwyt zapamiętujemy dla OBU torów, nie tylko online — strona statusu
  // zamówienia przelewowego korzysta z tego samego mechanizmu.
  try {
    await deps.rememberCheckout({ orderId: rpc.order_id, token: rpc.log_token });
  } catch (error) {
    // Zapis ciasteczka bywa niemożliwy (nagłówki już wysłane). To pogarsza
    // ścieżkę, ale nie unieważnia zamówienia — mówimy o tym w logu serwera,
    // zamiast wywracać wynik utrwalonej operacji.
    console.error("[checkout] nie udało się zapamiętać uchwytu checkoutu", error);
  }

  // Poczta nie może zamówienia cofnąć (wzorzec 8b): sendEmails nie rzuca,
  // a jego powody niewysłania wchodzą do wyniku jako miękkie ostrzeżenie —
  // sukces zamówienia jest niezależny od dostarczenia e-maili.
  const emailIssues = await deps.sendEmails(rpc);
  const result = summaryFrom(rpc) as Extract<CheckoutResult, { status: "success" }>;
  if (emailIssues.length > 0) result.emailIssues = emailIssues;
  return result;
}

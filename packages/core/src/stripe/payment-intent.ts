/**
 * Płatność online za zamówienie storefrontu (Z3, ADR-066) — warstwa domenowa
 * nad klientem Connect, lustro `account.ts`.
 *
 * PO CO OSOBNA WARSTWA: storefront ma wołać CZASOWNIKI („utwórz płatność za to
 * zamówienie", „odczytaj stan płatności"), a nie budować klienta z
 * konfiguracją. Tu mieszkają też bramki, których klient HTTP nie ma prawa
 * znać — bo są regułami NASZEJ domeny pieniędzy, nie kontraktem dostawcy.
 *
 * CZEGO TU NIE MA I NIE BĘDZIE:
 *
 *   1. Żadnej funkcji zwracającej `payment_status`. Ten moduł nie zna naszej
 *      osi statusów i nie ma jak jej ustawić — tłumaczenie „succeeded → paid"
 *      jest w Z4 i wyłącznie tam, po odczycie. Gdyby stało tutaj, pierwszy
 *      wołający z przeglądarki dostałby gotową odpowiedź „opłacone" do
 *      zapisania.
 *   2. Żadnego fallbacku „brak konfiguracji → udawaj, że działa". Brak klucza
 *      = `StripeConfigError` z konstruktora klienta, tak jak w Z2. Tor offline
 *      istnieje niezależnie od tego modułu (ADR-066) i to ON jest odpowiedzią
 *      na brak Stripe'a — nie atrapa płatności online.
 *   3. Żadnej arytmetyki na kwocie. Grosze wchodzą i grosze wychodzą.
 */
import { StripeConnectClient, type StripeConnectClientOptions } from "./api";
import type { CreateIntentParams, IntentHandle, IntentRead } from "./types";

/**
 * Zależności wstrzykiwane w testach — lustro `ConnectAccountDeps`. `client`
 * typem STRUKTURALNYM, żeby test bramek nie musiał mieć konfiguracji; testy
 * kontraktu dostawcy podstawiają `fetchFn`, nie klienta.
 */
export interface PaymentIntentDeps extends StripeConnectClientOptions {
  client?: Pick<StripeConnectClient, "createPaymentIntent" | "readPaymentIntent">;
}

function resolveClient(deps: PaymentIntentDeps): PaymentIntentDeps["client"] & object {
  return deps.client ?? new StripeConnectClient(deps);
}

/**
 * Kwota, której nie wolno wysłać do dostawcy.
 *
 * `Number.isSafeInteger` zamiast `> 0`: ułamek grosza (skutek uboczny dzielenia
 * przez 100 — dokładnie ta mutacja jest w tabeli dowodów) dostawca przyjąłby
 * po CICHU, obcinając go do liczby całkowitej. Zamówienie na 123,45 zł poszłoby
 * jako 1,23 zł i nikt by nie zauważył, bo żadna strona nie zgłosiłaby błędu.
 * Zero też jest odmową: płatność na 0 zł kończy się `succeeded` bez ani jednej
 * złotówki — to najgorszy możliwy stan, bo wygląda jak sukces.
 */
export class PaymentAmountError extends Error {
  constructor(public readonly amountGrosze: number) {
    super(
      `Kwota płatności musi być dodatnią liczbą całkowitą groszy (otrzymano ${amountGrosze}).`,
    );
    this.name = "PaymentAmountError";
  }
}

function assertAmount(amountGrosze: number): void {
  if (!Number.isSafeInteger(amountGrosze) || amountGrosze <= 0) {
    throw new PaymentAmountError(amountGrosze);
  }
}

/**
 * Prowizja platformy: 0 jest wartością legalną (faza 3), ale ujemna ani
 * ułamkowa nie jest. Ta sama dyscyplina co przy kwocie — parametr niesie
 * pieniądze, więc jego kształt jest bramkowany od pierwszego dnia, nie od
 * dnia, w którym wartość przestanie być zerem.
 */
function assertFee(applicationFeeGrosze: number): void {
  if (!Number.isSafeInteger(applicationFeeGrosze) || applicationFeeGrosze < 0) {
    throw new PaymentAmountError(applicationFeeGrosze);
  }
}

/**
 * Tworzy płatność za zamówienie na koncie najemcy.
 *
 * BRAMKA IDEMPOTENCJI JEST TU, NIE W WOŁAJĄCYM: pusty klucz oznaczałby, że
 * każdy powtórzony submit zakłada nową płatność, a klient płaci tyle razy, ile
 * kliknął. Wołający buduje klucz z `orders.id` — identyfikatora, który istnieje
 * dokładnie raz na zamówienie.
 */
export async function createPaymentIntent(
  params: CreateIntentParams,
  deps: PaymentIntentDeps = {},
): Promise<IntentHandle> {
  assertAmount(params.amountGrosze);
  assertFee(params.applicationFeeGrosze);
  if (!params.idempotencyKey) {
    throw new PaymentAmountError(params.amountGrosze);
  }
  if (!params.connectedAccountId) {
    // Bez konta najemcy płatność powstałaby na koncie PLATFORMY — pieniądze
    // klienta wylądowałyby u nas zamiast u sprzedawcy. Pusty string nie ma
    // prawa przejść jako „brak nagłówka".
    throw new Error("Płatność wymaga konta najemcy u dostawcy.");
  }
  return resolveClient(deps).createPaymentIntent(params);
}

/**
 * Odczyt stanu płatności u dostawcy — JEDYNA podstawa twierdzenia o
 * pieniądzach (ADR-049). Wynik parametrów URL, wynik `confirmPayment()`
 * w przeglądarce i ciało webhooka NIE SĄ jego zamiennikami.
 */
export async function readPaymentIntent(
  intentId: string,
  deps: PaymentIntentDeps & { connectedAccountId: string },
): Promise<IntentRead> {
  return resolveClient(deps).readPaymentIntent(intentId, deps.connectedAccountId);
}

/**
 * Czy odczyt dowodzi, że zamówienie jest opłacone.
 *
 * DWA WARUNKI, OBA KONIECZNE: dostawca mówi `succeeded` **i** kwota, którą
 * zaksięgował, pokrywa sumę policzoną przez NASZ serwer. Sam status nie
 * wystarcza — płatność częściowa (nadpłata/niedopłata przy zmianie kwoty
 * w locie) też bywa `succeeded`. Suma z klienta w tej funkcji nie istnieje:
 * `expectedGrosze` ma pochodzić z bazy, nie z przeglądarki.
 *
 * Funkcja jest CZYSTA i nic nie zapisuje — decyzję o `payment_status='paid'`
 * podejmuje wyłącznie handler webhooka (Z4).
 */
export function isIntentSettled(read: IntentRead, expectedGrosze: number): boolean {
  return read.status === "succeeded" && read.amountReceivedGrosze >= expectedGrosze;
}

/**
 * Zwrot kaucji u dostawcy (Z5, ADR-068) — warstwa domenowa nad klientem
 * Connect, lustro `payment-intent.ts`.
 *
 * ================== JEDNO ZDANIE, NA KTÓRYM STOI CAŁY PLIK ==================
 *
 * „ZWROT W TOKU" TO NIE „ZWRÓCONE". To jest cała treść tego modułu i jedyny
 * powód, dla którego nie jest on trzema linijkami.
 *
 * `POST /v1/refunds` odpowiada obiektem refundu ze statusem — i ten status
 * przy BLIK-u i Przelewach24 brzmi `pending`, bo pieniądze wracają przez
 * system rozliczeniowy, a nie w chwili kliknięcia. Zapisanie wtedy do
 * rejestru kaucji wiersza `refunded` znaczy, że panel twierdzi „oddaliśmy
 * kaucję", podczas gdy klient pieniędzy nie ma. O tej awarii dowiedzielibyśmy
 * się od klienta — najgorszą możliwą drogą, po tygodniu, ze skargą.
 *
 * Dlatego bariera stoi w KSZTAŁCIE TYPÓW, nie w dyscyplinie wołającego:
 * `createDepositRefund` zwraca `string` (sam identyfikator), więc nie ma
 * z czego zbudować twierdzenia o zwrocie. Twierdzenie może powstać wyłącznie
 * z `RefundRead`, a `RefundRead` powstaje wyłącznie z `GET /v1/refunds/{id}`.
 *
 * CZEGO TU NIE MA I NIE BĘDZIE:
 *   1. Żadnego zapisu do bazy — ten moduł nie zna `deposit_events` ani
 *      `deposit_refunds`. Kolejność zapisów (rejestr PRZED `payment_status`)
 *      jest regułą warstwy panelu i mieszka tam.
 *   2. Żadnej arytmetyki na kwocie. Grosze wchodzą, grosze wychodzą.
 *   3. Żadnego fallbacku „brak konfiguracji → udawaj". Brak klucza to
 *      `StripeConfigError` z konstruktora klienta, jak w Z2/Z3.
 */
import { StripeConnectClient, type StripeConnectClientOptions } from "./api";
import { PaymentAmountError } from "./payment-intent";
import type { CreateRefundParams, RefundRead } from "./types";

/**
 * Zależności wstrzykiwane w testach — lustro `PaymentIntentDeps`. `client`
 * typem STRUKTURALNYM, żeby test bramek nie musiał mieć konfiguracji.
 */
export interface RefundDeps extends StripeConnectClientOptions {
  client?: Pick<StripeConnectClient, "createRefund" | "readRefund">;
}

function resolveClient(deps: RefundDeps): RefundDeps["client"] & object {
  return deps.client ?? new StripeConnectClient(deps);
}

/**
 * Zleca zwrot i oddaje SAM IDENTYFIKATOR.
 *
 * Bramki kwoty są tu te same co przy pobraniu (`PaymentAmountError`):
 * ułamek grosza — skutek uboczny dzielenia przez 100 — dostawca przyjąłby
 * po CICHU, obcinając do liczby całkowitej, i oddałby klientowi kaucję
 * stukrotnie mniejszą. Zero też jest odmową: refund na 0 gr kończy się
 * `succeeded` bez ani jednej złotówki, czyli wygląda dokładnie jak sukces.
 */
export async function createDepositRefund(
  params: CreateRefundParams,
  deps: RefundDeps = {},
): Promise<string> {
  if (!Number.isSafeInteger(params.amountGrosze) || params.amountGrosze <= 0) {
    throw new PaymentAmountError(params.amountGrosze);
  }
  if (!params.idempotencyKey) {
    // Bez klucza dwuklik operatora to dwa refundy — czyli oddanie kaucji
    // dwa razy. Klucz jest parametrem WYMAGANYM, nie opcją.
    throw new PaymentAmountError(params.amountGrosze);
  }
  if (!params.intentId) {
    throw new Error("Zwrot kaucji wymaga wskazania płatności, z której ma zostać wykonany.");
  }
  if (!params.connectedAccountId) {
    // Bez konta najemcy żądanie poszłoby na konto PLATFORMY — czyli
    // szukalibyśmy tam płatności, której tam nie ma (lustro bramki z Z3).
    throw new Error("Zwrot kaucji wymaga konta najemcy u dostawcy.");
  }
  return resolveClient(deps).createRefund(params);
}

/**
 * Odczyt stanu zwrotu u dostawcy — JEDYNA podstawa twierdzenia, że kaucja
 * wróciła do klienta (ADR-049).
 */
export async function readDepositRefund(
  refundId: string,
  deps: RefundDeps & { connectedAccountId: string },
): Promise<RefundRead> {
  return resolveClient(deps).readRefund(refundId, deps.connectedAccountId);
}

/**
 * Werdykt o zwrocie, wyprowadzony WYŁĄCZNIE z odczytu — lustro
 * `settlementVerdict` z webhooka.
 *
 * TRZY WYNIKI, NIE DWA. `pending` NIE JEST ani sukcesem, ani porażką i nie
 * wolno go zwinąć w żadną z tych dwóch stron: zwinięty w sukces kłamie
 * klientowi o pieniądzach, zwinięty w porażkę kazałby operatorowi zlecić
 * DRUGI zwrot tej samej kaucji, podczas gdy pierwszy jest w drodze.
 *
 * Funkcja jest CZYSTA — nic nie zapisuje i nie zna naszej bazy.
 */
export type RefundVerdict =
  | { outcome: "settled"; amountGrosze: number; reason: "" }
  | { outcome: "pending"; reason: string }
  | { outcome: "failed"; reason: string };

export function refundVerdict(read: RefundRead): RefundVerdict {
  switch (read.status) {
    case "succeeded":
      // KWOTA Z ODCZYTU, nie z żądania. Zero znaczy „dostawca nie podał, ile
      // oddał" — a zwrot bez kwoty nie jest zwrotem, o którym wolno pisać
      // w rejestrze, w którym kwota jest całą treścią wiersza.
      if (read.amountGrosze <= 0) {
        return {
          outcome: "pending",
          reason:
            "Dostawca zgłasza succeeded, ale nie podał kwoty zwrotu — brak podstawy do zapisu w rejestrze kaucji.",
        };
      }
      return { outcome: "settled", amountGrosze: read.amountGrosze, reason: "" };

    // `failed` — zwrot upadł (np. zamknięte konto odbiorcy).
    // `canceled` — zwrot wycofany, zanim się wydarzył.
    // Obie drogi znaczą to samo dla rejestru: ZERO wiersza, powód widoczny.
    case "failed":
    case "canceled":
      return {
        outcome: "failed",
        reason: read.failureReason
          ? `Dostawca odrzucił zwrot (${read.status}): ${read.failureReason}.`
          : `Dostawca odrzucił zwrot (${read.status}).`,
      };

    // `pending`, `requires_action` i cokolwiek, czego dziś nie znamy.
    // NIEZNANY STATUS JEST STANEM POŚREDNIM, nie porażką: dopisanie przez
    // dostawcę nowej wartości nie ma prawa zamienić zwrotu w drodze
    // w „odrzucony" i wywołać drugiego zwrotu tej samej kaucji.
    default:
      return {
        outcome: "pending",
        reason: `Zwrot w stanie ${read.status} — pieniądze nie dotarły jeszcze do klienta.`,
      };
  }
}

/**
 * Typy zdarzeń dostawcy, po których sięgamy po ODCZYT zwrotu (rozszerzenie
 * listy obserwowanych z Z4).
 *
 * Ta lista NIE JEST mapą „typ → status" — tak samo jak `OBSERVED_INTENT_EVENTS`.
 * Typ odpowiada wyłącznie na pytanie „czy warto teraz zapytać dostawcę o ten
 * refund"; o to, JAKI jest stan, pyta `readRefund`. Dlatego `refund.failed`
 * jest tu obok `charge.refund.updated`: oba znaczą tyle samo, czyli
 * „sprawdź".
 *
 * DWIE RODZINY NAZW, BO DOSTAWCA MA DWIE. `charge.refund.updated` to nazwa
 * starsza, `refund.*` — nowsza; która z nich przyjdzie, zależy od wersji API
 * skonfigurowanej dla endpointu, a ta żyje w cudzym panelu. Nasłuchiwanie
 * obu jest tańsze niż zgadywanie, a idempotencja zapisu (unikat odnośnika
 * w 0031) sprawia, że dwa zdarzenia o tym samym refundzie nie zaszkodzą.
 */
export const OBSERVED_REFUND_EVENTS = [
  "charge.refund.updated",
  "refund.created",
  "refund.updated",
  "refund.failed",
] as const;

export function isObservedRefundEvent(type: string): boolean {
  return (OBSERVED_REFUND_EVENTS as readonly string[]).includes(type);
}

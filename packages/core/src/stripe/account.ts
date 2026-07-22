/**
 * Operacje na koncie Connect najemcy — warstwa, której używa panel (Z2,
 * ADR-065).
 *
 * Po co osobny plik nad klientem: ekran i akcje panelu mają wołać CZASOWNIKI
 * domeny („odczytaj stan konta", „daj link do KYC"), a nie budować klienta
 * z konfiguracją. Ta warstwa trzyma też wzorzec UCZCIWEJ CZĘŚCIOWEJ PORAŻKI
 * (ADR-033/036/046): synchronizacja stanu NIE RZUCA — zwraca powód do zapisania
 * w `payment_accounts.last_error` i pokazania najemcy z przyciskiem ponowienia.
 *
 * Czego tu NIE MA i nie będzie: żadnej funkcji, która produkuje
 * `ConnectAccountState` z czegokolwiek poza odczytem. Ani z odpowiedzi na
 * `POST /v1/accounts`, ani z parametrów `return_url`, ani z „ostatnio
 * widzianego" wiersza w bazie.
 */
import { StripeConnectClient, type StripeConnectClientOptions, type CreateConnectAccountInput } from "./api";
import type {
  ConnectAccountState,
  ConnectAccountSync,
  OnboardingLink,
  OnboardingUrls,
} from "./types";

/**
 * Zależności wstrzykiwane w testach. `client` celowo typem STRUKTURALNYM
 * (`Pick`), żeby test mógł podstawić atrapę bez konfiguracji — ale wzorzec
 * z portu domen zostaje: testy bramek podstawiają `fetchFn`, nie klienta,
 * bo atrapa klienta sprawdzałaby atrapę.
 */
export interface ConnectAccountDeps extends StripeConnectClientOptions {
  client?: Pick<StripeConnectClient, "createAccount" | "readAccount" | "createOnboardingLink">;
}

function resolveClient(deps: ConnectAccountDeps): ConnectAccountDeps["client"] & object {
  return deps.client ?? new StripeConnectClient(deps);
}

/**
 * Zakłada konto najemcy u dostawcy. Zwraca IDENTYFIKATOR — nic więcej nie ma
 * prawa z tego wyjść (patrz docblock `api.ts`).
 */
export async function createConnectAccount(
  input: CreateConnectAccountInput,
  deps: ConnectAccountDeps = {},
): Promise<string> {
  return resolveClient(deps).createAccount(input);
}

/** Stan konta Z ODCZYTU. Rzuca — wołający decyduje, czy chce wersję bezpieczną. */
export async function readConnectAccount(
  providerAccountId: string,
  deps: ConnectAccountDeps = {},
): Promise<ConnectAccountState> {
  return resolveClient(deps).readAccount(providerAccountId);
}

export async function createOnboardingLink(
  providerAccountId: string,
  urls: OnboardingUrls,
  deps: ConnectAccountDeps = {},
): Promise<OnboardingLink> {
  return resolveClient(deps).createOnboardingLink(providerAccountId, urls);
}

/**
 * Synchronizacja stanu, która NIGDY nie wywraca operacji nadrzędnej.
 *
 * `catch` jest CELOWO szeroki (nie tylko `StripeApiError`): brak konfiguracji
 * (`StripeConfigError` z konstruktora klienta), nieoczekiwany kształt
 * odpowiedzi i błąd programistyczny w porcie mają dać ten sam skutek co
 * odmowa dostawcy — powód na ekranie i przycisk ponowienia. Wąski `catch`
 * zamieniałby nieprzewidziany wyjątek w awarię ekranu ustawień.
 *
 * PRZY PORAŻCE `state` JEST NULL. To nie jest szczegół: wołający ma wtedy
 * zapisać WYŁĄCZNIE `last_error`, zostawiając kolumny gotowości nietknięte.
 * Wyzerowanie ich przy awarii sieci pokazałoby najemcy „konto przestało
 * działać", a przy Z3 kazałoby ukryć płatność online z powodu naszego
 * timeoutu — czyli awaria po naszej stronie zabierałaby najemcy pieniądze.
 */
export async function syncConnectAccountSafely(
  providerAccountId: string,
  deps: ConnectAccountDeps = {},
): Promise<ConnectAccountSync> {
  try {
    const state = await readConnectAccount(providerAccountId, deps);
    return { ok: true, state, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Komunikat idzie do bazy i na ekran, więc długość jest ograniczona —
    // strona serwisowa dostawcy potrafi zwrócić kilobajty HTML-a.
    return { ok: false, state: null, error: message.slice(0, 500) };
  }
}

/**
 * Czy konto jest gotowe do PRZYJMOWANIA płatności. Wyodrębnione, bo Z3 zada
 * dokładnie to pytanie — i ma je zadać na świeżo odczytanym stanie, nie na
 * wierszu z bazy.
 *
 * `payoutsEnabled` CELOWO nie wchodzi do tego warunku: konto `restricted`
 * przyjmuje płatności i blokuje wypłatę, więc zwinięcie obu flag w jedno
 * „gotowe" albo zablokowałoby sprzedaż działającemu najemcy, albo (gorzej)
 * zamilczałoby o tym, że pieniądze utknęły. Obie flagi są widoczne osobno.
 */
export function canAcceptCharges(state: ConnectAccountState): boolean {
  return state.chargesEnabled;
}

/**
 * Stan prezentacyjny karty płatności — JEDYNE miejsce, które zamienia flagi
 * dostawcy w słowo widoczne dla najemcy.
 *
 * `missing`   — konta nie ma (najemca go nie zakładał albo skasował),
 * `pending`   — konto istnieje, ale nie przyjmuje płatności: KYC w toku,
 *               odrzucone albo czekające na weryfikację dostawcy,
 * `payouts_blocked` — przyjmuje płatności, ale NIE WYPŁACA. To jest ten stan,
 *               który wygląda jak sukces i nim nie jest,
 * `ready`     — obie osi zielone.
 */
export function connectAccountStage(
  state: ConnectAccountState | null,
): "missing" | "pending" | "payouts_blocked" | "ready" {
  if (!state) return "missing";
  if (!state.chargesEnabled) return "pending";
  if (!state.payoutsEnabled) return "payouts_blocked";
  return "ready";
}

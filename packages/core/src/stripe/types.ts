/**
 * Kształty portu Stripe Connect (Z2, ADR-065).
 *
 * Typy są tu CELOWO oddzielone od klienta: `ConnectAccountState` musi dać się
 * zaimportować przez ekran panelu bez wciągania konfiguracji ani `fetch`.
 */

/**
 * Konfiguracja integracji Stripe PLATFORMY (nie najemcy — konto najemcy to
 * `provider_account_id` w bazie, nie klucz).
 *
 * `webhookSecret` jest JEDYNYM polem nullowalnym i to nie jest niedopatrzenie:
 * `AVABLY_STRIPE_WEBHOOK_SECRET` powstaje dopiero w Z4 (endpoint webhooka
 * jeszcze nie istnieje, więc Stripe nie ma jak wydać sekretu podpisu). Gdyby
 * pole było wymagane, cały port Connect byłby niedostępny do czasu Z4 —
 * czyli konfiguracja NIEISTNIEJĄCEJ jeszcze ścieżki blokowałaby ścieżkę
 * działającą. Odwrotny błąd (webhook bez sekretu przepuszcza zdarzenia) jest
 * zamknięty osobną bramką: `requireStripeWebhookSecret`, która RZUCA.
 */
export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string | null;
}

/** Wynik pytania „czy ta ścieżka ma z czym działać" — liczone na SERWERZE. */
export interface StripeAvailability {
  available: boolean;
  /** Powód niedostępności: NAZWY brakujących zmiennych, nigdy ich wartości. */
  reason: string | null;
}

/**
 * Stan konta Connect najemcy.
 *
 * ŹRÓDŁO: WYŁĄCZNIE `GET /v1/accounts/{id}` (ADR-049). Ten typ nie ma prawa
 * powstać z odpowiedzi na `POST /v1/accounts` ani z powrotu przeglądarki na
 * `return_url` — dlatego `createConnectAccount` zwraca sam identyfikator,
 * a nie stan.
 */
export interface ConnectAccountState {
  providerAccountId: string;
  /**
   * Konto może PRZYJMOWAĆ płatności. Nie mówi nic o wypłatach — patrz niżej.
   */
  chargesEnabled: boolean;
  /**
   * Konto może WYPŁACAĆ środki najemcy. Osobne pole, nigdy zwinięte razem
   * z `chargesEnabled` w jedno „gotowe": konto `restricted` przyjmuje
   * `PaymentIntent` i blokuje wypłatę, więc brak błędu przy płatności NIE
   * dowodzi, że najemca zobaczy pieniądze.
   */
  payoutsEnabled: boolean;
  /** Najemca doszedł do końca formularza KYC (nie znaczy: został przyjęty). */
  detailsSubmitted: boolean;
  /**
   * Identyfikatory wymagań dostawcy, które blokują konto TERAZ
   * (`requirements.currently_due` + `past_due`). Pusta lista przy koncie
   * niegotowym oznacza „dostawca weryfikuje", nie „nic nie trzeba".
   */
  requirementsDue: string[];
  /** Powód ograniczenia konta (`requirements.disabled_reason`), gdy jest. */
  disabledReason: string | null;
}

/** Link onboardingowy Connect — jednorazowy i KRÓTKOŻYJĄCY (kilka minut). */
export interface OnboardingLink {
  url: string;
  /** Sekundy epoki, prosto od dostawcy (`expires_at`). */
  expiresAt: number;
}

/** Adresy powrotu przekazywane dostawcy przy tworzeniu linku onboardingu. */
export interface OnboardingUrls {
  /** Link wygasł albo został użyty ponownie — wracamy po nowy. */
  refreshUrl: string;
  /**
   * Najemca „skończył". To DEKLARACJA PRZEGLĄDARKI o tym, gdzie była —
   * handler tego adresu MUSI wykonać odczyt stanu konta (ADR-049).
   */
  returnUrl: string;
}

/**
 * Wynik synchronizacji stanu konta, zapisywalny wprost w kolumnach
 * `public.payment_accounts`. Wzorzec `DomainRegistrationResult` (ADR-046):
 * porażka jest WARTOŚCIĄ do zapisania i pokazania, nie wyjątkiem.
 */
export interface ConnectAccountSync {
  ok: boolean;
  /** NULL przy porażce odczytu — wtedy kolumny stanu zostają NIETKNIĘTE. */
  state: ConnectAccountState | null;
  /** → payment_accounts.last_error. NULL przy sukcesie (czyści zaległy powód). */
  error: string | null;
}

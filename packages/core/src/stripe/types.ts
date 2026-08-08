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
 * Parametry płatności online (Z3, ADR-066).
 *
 * KWOTA I WALUTA SĄ TU RAZEM I NIE MAJĄ WARTOŚCI DOMYŚLNYCH. Waluta bez
 * zaszywania — od 0049 obie przychodzą z WIERSZA ZAMÓWIENIA
 * (`orders.currency`, ADR-103), kwota w najmniejszej jednostce — ta sama
 * liczba, którą policzył serwer, bez żadnego przelicznika po drodze.
 */
export interface CreateIntentParams {
  /** int, grosze — bez konwersji. Wartość policzona przez SERWER. */
  amountGrosze: number;
  /** Kod ISO waluty zamówienia (`orders.currency`, ADR-103) — nigdy zaszyty. */
  currency: string;
  /** Konto najemcy u dostawcy — na NIM powstaje płatność (charge bezpośredni). */
  connectedAccountId: string;
  /**
   * Prowizja platformy. W fazie 3 zawsze 0, ale parametr istnieje OD DZIŚ:
   * dołożenie prowizji w fazie 4 ma być zmianą WARTOŚCI, nie zmianą kształtu
   * (ograniczenie globalne 8 planu fazy).
   */
  applicationFeeGrosze: number;
  /** Zamówienie, którego dotyczy płatność — jedzie w metadanych do dostawcy. */
  orderId: string;
  /**
   * Klucz idempotencji = `orders.id`. Powtórzony submit i ponowne wejście na
   * krok płatności odtwarzają TEN SAM intent — inaczej klient płaci dwa razy.
   */
  idempotencyKey: string;
}

/**
 * Uchwyt do płatności oddawany przeglądarce.
 *
 * `clientSecret` NIE JEST sekretem naszej platformy: to poświadczenie na JEDNĄ
 * płatność, wystawione po to, żeby dane karty poszły z przeglądarki wprost do
 * dostawcy, z pominięciem naszego serwera. `status` jedzie prosto od dostawcy,
 * BEZ tłumaczenia na naszą oś `payment_status` — tłumaczenie jest w Z4 i tylko
 * tam.
 */
export interface IntentHandle {
  intentId: string;
  clientSecret: string;
  status: string;
}

/**
 * Odczyt płatności u dostawcy (ADR-049) — jedyna dopuszczalna podstawa
 * twierdzenia o pieniądzach.
 *
 * `amountReceivedGrosze` osobno od `amountGrosze`: pierwsze to ile WPŁYNĘŁO,
 * drugie — o ile prosiliśmy. Wołający porównuje pierwsze z sumą policzoną
 * przez WŁASNY serwer; drugie służy diagnozie rozjazdu.
 *
 * `currency` (K3, ADR-103): waluta, w której dostawca księgował. Liczba bez
 * waluty nie jest kwotą — werdykt porównuje ją z `orders.currency` (0049),
 * czyli z walutą, z którą intent POWSTAŁ. Małe litery jak w odpowiedzi
 * dostawcy; porównanie robi wołający, niewrażliwie na wielkość. Pusta
 * wartość znaczy „dostawca nie powiedział" i NIE przechodzi jako zgodna.
 */
export interface IntentRead {
  intentId: string;
  status: string;
  amountReceivedGrosze: number;
  amountGrosze: number;
  currency: string;
  /**
   * Sekundy epoki, prosto od dostawcy (`created`) — KIEDY POWSTAŁA PŁATNOŚĆ,
   * a nie kiedy powstał nasz wiersz.
   *
   * Pole istnieje wyłącznie dla rekoncyliacji (L11, ADR-104) i to ono jest
   * jedyną dopuszczalną podstawą zdania „ta płatność jest porzucona".
   * Zamówienie bywa sprzed tygodnia, a płatność przy nim — sprzed minuty
   * (klient wrócił i właśnie zaczął płacić); decyzja oparta na wieku
   * NASZEGO rekordu wygasiłaby ją w trakcie wpisywania karty.
   *
   * `0` znaczy „dostawca nie podał" i NIE JEST datą 1970: wołający ma
   * traktować to jako brak dowodu, nie jako wiek maksymalny.
   */
  createdAtSeconds: number;
}

/**
 * Parametry zwrotu kaucji (Z5, ADR-069).
 *
 * ZWROT JEST CZĘŚCIOWYM REFUNDEM TRANSAKCJI NAJMU, nie osobną operacją —
 * decyzja właściciela D4. Kaucja pojechała w tym samym PaymentIntencie co
 * najem i dostawa (0029), więc oddanie jej to zwrot CZĘŚCI tej jednej
 * płatności. `amountGrosze` jest tu kwotą KAUCJI, a nie kwotą zamówienia —
 * i nie wolno jej pominąć, bo refund bez kwoty jest u dostawcy refundem
 * PEŁNYM: oddałby klientowi także najem i dostawę.
 */
export interface CreateRefundParams {
  /** Płatność, z której zwracamy część (`pi_...` z `orders`). */
  intentId: string;
  /** int, grosze — kwota KAUCJI. Bez konwersji, bez arytmetyki. */
  amountGrosze: number;
  /** Konto najemcy — refund żyje tam, gdzie płatność (charge bezpośredni). */
  connectedAccountId: string;
  /**
   * Klucz idempotencji = identyfikator wiersza `deposit_refunds`. Jedno
   * żądanie operatora = jeden wiersz = jeden klucz. Klucz zbudowany
   * z (zamówienie, kwota) zjadałby drugi LEGALNY zwrot częściowy tej samej
   * kwoty jako duplikat — pełne uzasadnienie w migracji 0031.
   */
  idempotencyKey: string;
  /** Ślad diagnostyczny w metadanych dostawcy — nigdy podstawa decyzji. */
  orderId: string;
  refundRequestId: string;
}

/**
 * Odczyt zwrotu u dostawcy (ADR-049) — lustro `IntentRead`.
 *
 * TO JEST JEDYNA PODSTAWA ZDANIA „KAUCJA ZOSTAŁA ZWRÓCONA". Odpowiedź na
 * `POST /v1/refunds` nią NIE JEST — i dlatego `createRefund` zwraca sam
 * identyfikator, dokładnie jak `createAccount` z Z2 zwraca sam identyfikator
 * konta, mimo że odpowiedź niesie komplet pól gotowości.
 *
 * `amountGrosze` pochodzi z ODCZYTU, nie z naszego żądania: przy rozjeździe
 * prawdą jest to, co dostawca faktycznie oddał — i to ta liczba wchodzi do
 * rejestru kaucji.
 */
export interface RefundRead {
  refundId: string;
  /** Prosto od dostawcy: pending | requires_action | succeeded | failed | canceled. */
  status: string;
  amountGrosze: number;
  /** Płatność, której zwrot dotyczy (`pi_...`); NULL, gdy dostawca jej nie podał. */
  intentId: string | null;
  /** `failure_reason` dostawcy — powód, dla którego zwrot upadł. */
  failureReason: string | null;
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

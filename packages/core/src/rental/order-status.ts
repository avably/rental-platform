/**
 * Maszyna stanów zamówienia. Czyste funkcje, zero I/O — jak reszta `rental/`.
 *
 * Wartości statusów MUSZĄ pokrywać się co do litery z CHECK-ami migracji 0007
 * (orders.order_status / orders.payment_status). Zgodność z żywą bazą przypina
 * test introspekcyjny w packages/db/test/order-gates.test.ts — dodanie statusu
 * w bazie bez zmiany tutaj (albo odwrotnie) jest czerwonym buildem, nie cichym
 * rozjazdem.
 *
 * UWAGA O BRAMCE (ADR-025): `canTransition` w JS jest wygodą UI — członek
 * tenanta ma UPDATE na orders przez PostgREST, więc kod panelu może ominąć.
 * Faktyczną bramką przejść jest trigger w bazie (migracja 0010), którego mapa
 * jest lustrem TEJ mapy; tożsamość obu przypina behawioralny test zgodności
 * TS↔SQL (wszystkie 36 par w order-gates.test.ts). Zmieniasz przejście —
 * zmieniasz OBA miejsca, a test zgodności pilnuje, żebyś nie zapomniał.
 */

export const ORDER_STATUSES = [
  "pending",
  "reserved",
  "ready_for_pickup",
  "picked_up",
  "returned",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "manual",
  "completed",
  "deposit_refunded",
  "refunded",
  "cancelled",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Statusy płatności blokujące anulowanie zamówienia (jedno źródło prawdy;
 * lustro w triggerze 0010, zgodność przypięta testem).
 *
 * Kryterium (decyzja produktowa, ADR-025): blokuje każdy stan, w którym środki
 * klienta są pobrane albo pobranie jest w toku — anulowanie zamówienia z
 * pobranymi pieniędzmi bez rozliczenia to przywłaszczenie, nie korekta.
 * Ścieżka odblokowania: najpierw zwrot (payment_status → refunded/cancelled),
 * potem anulowanie. `unpaid` nie blokuje, bo nie ma czego rozliczać.
 */
export const BLOCKING_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "pending",
  "paid",
  "manual",
  "completed",
  "deposit_refunded",
];

/**
 * Statusy zamówienia, w których pozycje zamówienia BLOKUJĄ egzemplarz w
 * kalendarzu dostępności. `returned` i `cancelled` zwalniają egzemplarz —
 * wcześniejszy zwrot ma natychmiast otwierać termin, a anulowane zamówienie
 * nie trzyma sprzętu. Konsumenci: zapytania panelu o zajęte terminy (warstwa
 * wywołująca silnika filtruje po statusie — patrz komentarz w availability.ts)
 * i bramka dostępności w bazie (0010); zgodność SQL↔TS przypięta testem.
 */
export const AVAILABILITY_BLOCKING_ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "reserved",
  "ready_for_pickup",
  "picked_up",
];

/**
 * Mapa dozwolonych przejść payment_status (ADR-035). Oś jest w fazie 1
 * sterowana RĘCZNIE przez operatora (ADR-027 decyzja nr 7), a realne
 * płatności to faza 3 — mapa NIE modeluje drobnoziarnistego cyklu Stripe,
 * tylko chroni granicę rozliczenia:
 *   - zbiór OTWARTY {unpaid, pending, paid, manual, completed} przechodzi
 *     swobodnie w obrębie siebie ORAZ w rozliczenie (korekta operatorska —
 *     faza 1 nie ma podstawy, by policować kolejność stanów offline),
 *   - `deposit_refunded` wychodzi WYŁĄCZNIE w `refunded`/`cancelled` — nie
 *     wraca do otwartych, bo regres „rozliczona → opłacona" gubiłby fakt
 *     rozliczenia (dokładnie ta luka, którą Zadanie 9 zamyka),
 *   - `refunded` i `cancelled` są terminalne: rozliczona płatność się nie
 *     „od-rozlicza".
 * Lustro w triggerze `app.payment_transition_allowed` (0015); tożsamość obu
 * map przypina test zgodności 64 par w order-gates.test.ts. Wejście w
 * `deposit_refunded` ma DODATKOWĄ bramkę spójności z rejestrem kaucji (0015):
 * saldo 0 przy pobraniach > 0 (lustro isDepositSettled — ADR-027).
 */
const OPEN_PAYMENT_STATUSES = ["unpaid", "pending", "paid", "manual", "completed"] as const;

const PAYMENT_SETTLEMENT_TARGETS = ["deposit_refunded", "refunded", "cancelled"] as const;

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: [...OPEN_PAYMENT_STATUSES.filter((s) => s !== "unpaid"), ...PAYMENT_SETTLEMENT_TARGETS],
  pending: [...OPEN_PAYMENT_STATUSES.filter((s) => s !== "pending"), ...PAYMENT_SETTLEMENT_TARGETS],
  paid: [...OPEN_PAYMENT_STATUSES.filter((s) => s !== "paid"), ...PAYMENT_SETTLEMENT_TARGETS],
  manual: [...OPEN_PAYMENT_STATUSES.filter((s) => s !== "manual"), ...PAYMENT_SETTLEMENT_TARGETS],
  completed: [...OPEN_PAYMENT_STATUSES.filter((s) => s !== "completed"), ...PAYMENT_SETTLEMENT_TARGETS],
  deposit_refunded: ["refunded", "cancelled"],
  refunded: [],
  cancelled: [],
};

/**
 * Czy przejście payment_status `from` → `to` jest dozwolone. Przejście
 * tożsamościowe (from === to) NIE jest przejściem — zwraca false; UPDATE
 * niezmieniający statusu w ogóle nie pyta maszyny (tak samo trigger 0015).
 */
export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/**
 * Mapa dozwolonych przejść (ADR-025):
 *   - ścieżka w przód: pending → reserved → ready_for_pickup → picked_up → returned,
 *   - korekta pomyłki operatora: cofnięcie o JEDEN krok (reserved → pending,
 *     ready_for_pickup → reserved, picked_up → ready_for_pickup),
 *   - anulowanie z każdego stanu PRZED wydaniem; po wydaniu (picked_up) nie ma
 *     anulowania — sprzęt jest u klienta, ścieżką jest zwrot i rozliczenie,
 *   - `returned` i `cancelled` są terminalne: na zwrocie wisi rozliczenie
 *     kaucji (Zadanie 5), a reaktywacja anulowanego to nowe zamówienie.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["reserved", "cancelled"],
  reserved: ["ready_for_pickup", "pending", "cancelled"],
  ready_for_pickup: ["picked_up", "reserved", "cancelled"],
  picked_up: ["returned", "ready_for_pickup"],
  returned: [],
  cancelled: [],
};

/**
 * Czy przejście `from` → `to` jest dozwolone. Przejście tożsamościowe
 * (from === to) NIE jest przejściem — zwraca false; UPDATE niezmieniający
 * statusu w ogóle nie pyta maszyny stanów (tak samo trigger w 0010).
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

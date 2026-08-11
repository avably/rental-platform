/**
 * Okno domykania przy `suspended` (Zasada 8 dunningu, ADR-138). Czyste
 * funkcje bez I/O — jak reszta `rental/`.
 *
 * Zawieszona organizacja dostaje 30 dni OD CHWILI ZAWIESZENIA na domknięcie
 * najmów, w których pieniądze klientów zostały już pobrane; potem panel
 * zamyka się w całości. Zegar liczy się od `tenants.suspended_at` (0067),
 * NIGDY od dat najmu — `end_date` nie ma górnej granicy i jest sterowane
 * przez dłużnika, a spóźniony zwrot ma je z definicji w przeszłości.
 *
 * ZAMROŻONY ZBIÓR („otwarte zobowiązanie"): okno nie działa na
 * „zamówieniach", tylko na zbiorze wyznaczonym chwilą zawieszenia.
 * `isOpenObligation` jest WŁASNYM predykatem, nie lustrem
 * `BLOCKING_PAYMENT_STATUSES` — tamta stała jest bramką ANULOWANIA
 * (zawiera `pending` i `deposit_refunded`) i użyta jako miara „pieniądze
 * klienta są u najemcy" otwierałaby okno zamówieniom, za które nikt nie
 * zapłacił, a zamykała je rozliczonym tylko połowicznie.
 *
 * WYJŚCIA PO PUSTYM ZBIORZE NIE MA (świadomie): okno kończy WYŁĄCZNIE
 * zegar. Zamknięcie panelu po oznaczeniu ostatniego zwrotu stworzyłoby
 * perwersyjny bodziec „nie oznaczę zwrotu, bo stracę dostęp".
 */

import type { OrderStatus, PaymentStatus } from "./order-status";

/** Długość okna domykania w dniach — liczona od `tenants.suspended_at`. */
export const CLOSING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Czy okno domykania jest jeszcze otwarte. Granica jest OSTRA po stronie
 * zamknięcia: `now() >= suspended_at + 30 dni` → zamknięte (spec Zasady 8).
 *
 * FAIL-CLOSED: brak `suspended_at` (null — np. zawieszenie sprzed 0067) albo
 * wartość nieparsowalna → okno ZAMKNIĘTE. Zegar bez punktu zaczepienia nie
 * może otwierać panelu.
 */
export function isClosingWindowOpen(
  suspendedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!suspendedAt) return false;
  const startMs = Date.parse(suspendedAt);
  if (Number.isNaN(startMs)) return false;
  return nowMs < startMs + CLOSING_WINDOW_DAYS * DAY_MS;
}

/**
 * Ile PEŁNYCH dni okna zostało (na baner „zostało N dni"). Zaokrąglenie
 * W GÓRĘ: ostatnie godziny okna to wciąż „1 dzień", nigdy „0 dni" przy
 * otwartym oknie. Po zamknięciu (i przy braku zegara) zwraca 0.
 */
export function closingWindowDaysLeft(
  suspendedAt: string | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!suspendedAt) return 0;
  const startMs = Date.parse(suspendedAt);
  if (Number.isNaN(startMs)) return 0;
  const leftMs = startMs + CLOSING_WINDOW_DAYS * DAY_MS - nowMs;
  if (leftMs <= 0) return 0;
  return Math.ceil(leftMs / DAY_MS);
}

/**
 * Statusy płatności, w których pieniądze klienta SĄ u najemcy — miara
 * wypłacalności zamrożonego zbioru. CELOWO bez `pending` (pobranie w toku,
 * nie fakt) i bez `deposit_refunded` (kaucja już rozliczona — zamówienie
 * `returned` wypada ze zbioru właśnie przez saldo 0).
 */
export const CLOSING_OBLIGATION_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "paid",
  "manual",
  "completed",
];

/**
 * Statusy zamówienia „w toku" — sprzęt jest w obiegu albo czeka na wydanie.
 * `returned` wchodzi do zbioru osobną gałęzią (niezerowe saldo kaucji),
 * `cancelled` nigdy.
 */
export const CLOSING_OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "reserved",
  "ready_for_pickup",
  "picked_up",
];

/** Kształt zamówienia, o który pyta predykat zamrożonego zbioru. */
export interface ClosableOrderShape {
  /** `orders.created_at` (timestamptz ISO). */
  createdAt: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  /**
   * Saldo rejestru kaucji (pobrania − rozliczenia, grosze). Istotne
   * WYŁĄCZNIE dla `returned`: niezerowe saldo trzyma zamówienie w zbiorze,
   * bo klient wciąż czeka na zwrot kaucji.
   */
  depositBalanceGrosze: number;
}

/**
 * Predykat zamrożonego zbioru (Zasada 8):
 *
 *     otwarte_zobowiazanie(order) :=
 *           order.created_at < tenant.suspended_at
 *       AND order.payment_status ∈ {paid, manual, completed}
 *       AND (   order.order_status ∈ {pending, reserved, ready_for_pickup, picked_up}
 *            OR (order.order_status = 'returned' AND saldo_kaucji ≠ 0) )
 *
 * Konsekwencje wprost: `unpaid`/`pending` NIE wchodzą (i nie da się ich już
 * opłacić — publiczne RPC płatnicze są dla `suspended` zamknięte), zamówienie
 * po pełnym rozliczeniu kaucji WYPADA, a płatność zaksięgowana webhookiem
 * PO zawieszeniu WCHODZI, bo zamówienie powstało wcześniej (webhook nie
 * czyta statusu tenanta) — to domyka najcięższe znalezisko przeciw pełnej
 * blokadzie.
 *
 * GRANICA JEST OSTRA (decyzja świadoma, spec Zasady 8: „utworzone PRZED
 * zawieszeniem"): `created_at == suspended_at` stoi POZA zbiorem. Równość
 * jest osiągalna głównie przez obcięcie `Date.parse` do milisekund
 * (timestamptz niesie mikrosekundy) — ta sub-milisekundowa drzazga wypada
 * ze zbioru, czyli fail-closed, zgodnie ze spec-em. Produkcyjnie OBA
 * stemple składa jeden zegar bazy (`created_at`: default now();
 * `suspended_at`: now() w RPC 0067) — porównanie międzyzegarowe nie
 * istnieje. Seed testu, który stempluje `suspended_at` zegarem klienta,
 * porównuje DWA zegary (host vs kontener Postgresa) i flakuje przy dryfie
 * VM Dockera — znaczniki seeduj z `created_at` wiersza, nie z `new Date()`.
 *
 * FAIL-CLOSED jak w zegarze: brak/nieparsowalny `suspended_at` albo
 * nieparsowalny `created_at` → zamówienie POZA zbiorem.
 */
export function isOpenObligation(
  order: ClosableOrderShape,
  suspendedAt: string | null | undefined,
): boolean {
  if (!suspendedAt) return false;
  const suspendedMs = Date.parse(suspendedAt);
  const createdMs = Date.parse(order.createdAt);
  if (Number.isNaN(suspendedMs) || Number.isNaN(createdMs)) return false;
  if (createdMs >= suspendedMs) return false;
  if (!CLOSING_OBLIGATION_PAYMENT_STATUSES.includes(order.paymentStatus)) return false;
  if (CLOSING_OPEN_ORDER_STATUSES.includes(order.orderStatus)) return true;
  return order.orderStatus === "returned" && order.depositBalanceGrosze !== 0;
}

/**
 * Przejścia statusu zamówienia dozwolone W OKNIE DOMYKANIA — wyłącznie
 * DO PRZODU po ścieżce zwrotu sprzętu. CELOWO bez `pending → reserved`
 * (przyjęcie rezerwacji to nowe zobowiązanie, nie domykanie), bez cofnięć
 * (korekta operatorska otwierałaby drogę wstecz przez saldo) i bez
 * anulowania (OFF bez wyjątków — rozwiązywanie umów konsumenckich pod
 * marką najemcy z powodu naszej faktury łamie Zasady 3, 5 i 6).
 */
const CLOSING_FORWARD_TRANSITIONS: Readonly<Partial<Record<OrderStatus, OrderStatus>>> = {
  reserved: "ready_for_pickup",
  ready_for_pickup: "picked_up",
  picked_up: "returned",
};

/** Czy przejście `from` → `to` jest dozwolone w oknie domykania. */
export function isClosingForwardTransition(from: OrderStatus, to: OrderStatus): boolean {
  return CLOSING_FORWARD_TRANSITIONS[from] === to;
}

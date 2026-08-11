/**
 * Filtr dnia listy zamówień (`?dzien=…`) — cel linków „Zobacz wszystkie (N)"
 * z kafli pulpitu (UX1, ADR-140).
 *
 * KONTRAKT: definicja każdego zbioru jest LUSTREM gałęzi `app.dashboard_day`
 * (migracja 0069) — licznik kafla i licznik wyników listy muszą się zgadzać,
 * inaczej link „Zobacz wszystkie (7)" prowadzi do listy z inną liczbą.
 * Definicje w jednym miejscu (ten moduł), lista tłumaczy je na warunki
 * zapytania; saldo kaucji przy `alarmy` dolicza się z rejestru po odczycie
 * (baza nie trzyma salda w kolumnie — ten sam zabieg co okno domykania).
 *
 * Filtr SKŁADA SIĘ z pozostałymi (status, klient, q) przez AND — jak każdy
 * inny parametr listy; z presetami zakresu się nie wyklucza, bo operuje na
 * dokładnych datach, nie na nachodzeniu zakresów.
 */
import type { DashboardDayKind } from "@/lib/dashboard/queries";

export const ORDER_DAY_FILTERS = [
  "wydania-dzis",
  "zwroty-dzis",
  "po-terminie",
  "jutro",
  "alarmy",
] as const;

export type OrderDayFilter = (typeof ORDER_DAY_FILTERS)[number];

/** Kafel pulpitu → wartość parametru `dzien` (cel „Zobacz wszystkie (N)"). */
export const DAY_FILTER_FOR_KIND: Record<DashboardDayKind, OrderDayFilter> = {
  pickup_today: "wydania-dzis",
  return_today: "zwroty-dzis",
  overdue: "po-terminie",
  prepare_tomorrow: "jutro",
  money_alert: "alarmy",
};

/**
 * Statusy „jeszcze nie wydane" — wspólne dla wydań dziś i jutra do
 * przygotowania (lustro gałęzi pickup/prepare z 0069).
 */
export const DAY_PICKUP_ORDER_STATUSES = [
  "pending",
  "reserved",
  "ready_for_pickup",
] as const;

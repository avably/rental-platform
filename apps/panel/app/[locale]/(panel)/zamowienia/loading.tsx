import { OrdersListSkeleton } from "@/components/skeleton/orders-list-skeleton";

/**
 * Stan ładowania listy zamówień (uwaga przeglądu N1).
 *
 * Plik trasy jest CIENKI celowo: geometria szkieletu mieszka w
 * `components/skeleton/orders-list-skeleton.tsx`, razem z manifestem regionów
 * i kontraktem odpowiedniości. Poprzednia wersja malowała pięć wierszy tabeli
 * sprzed przebudowy #113 — bez kafli, belki i kart mobilnych — więc szkielet
 * pokazywał inny ekran niż ten, który po chwili wchodził.
 */
export default function OrdersLoading() {
  return <OrdersListSkeleton />;
}

import { OrderDetailSkeleton } from "@/components/skeleton/order-detail-skeleton";

/**
 * Stan ładowania szczegółu zamówienia (uwaga przeglądu N1).
 *
 * Jak przy liście: geometria siedzi w `components/skeleton/`, tu zostaje sama
 * kompozycja. Poprzednia wersja malowała układ sprzed #114 (cztery pola w
 * kolumnie i panel boczny z chipami), a ekran ma dziś oś czasu, kartę klienta
 * i ramę dwukolumnową — stąd zarówno „nie odpowiada", jak i skok układu.
 */
export default function OrderDetailLoading() {
  return <OrderDetailSkeleton />;
}

import { CustomersListSkeleton } from "@/components/skeleton/customers-list-skeleton";

/**
 * Stan ładowania listy klientów (R6a).
 *
 * Plik trasy jest CIENKI celowo: geometria szkieletu mieszka w
 * `components/skeleton/customers-list-skeleton.tsx`, razem z manifestem
 * regionów i kontraktem odpowiedniości (`test/customers-skeleton-parity`).
 */
export default function CustomersLoading() {
  return <CustomersListSkeleton />;
}

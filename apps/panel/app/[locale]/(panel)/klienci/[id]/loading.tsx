import { CustomerDetailSkeleton } from "@/components/skeleton/customer-detail-skeleton";

/**
 * Stan ładowania karty klienta (R6a).
 *
 * Cienki plik trasy: geometria mieszka w
 * `components/skeleton/customer-detail-skeleton.tsx` razem z manifestem
 * regionów i kontraktem odpowiedniości.
 */
export default function CustomerDetailLoading() {
  return <CustomerDetailSkeleton />;
}

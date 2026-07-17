/**
 * Silnik wynajmu: dostępność i wycena jako czyste funkcje bez I/O.
 * Publiczne wejście modułu — pozostałe warstwy wołają wyłącznie stąd.
 */

export { addDays, assertIsoDate, rangesOverlapInclusive, rentalDaysInclusive, type IsoDate } from "./dates";

export {
  checkAvailability,
  type AvailabilityParams,
  type AvailabilityResult,
  type BookedRange,
  type UnitServiceWindow,
} from "./availability";

export {
  calculatePrice,
  type PriceParams,
  type PriceResult,
  type PricingTier,
} from "./pricing";

export { quoteExtension, type ExtensionQuote } from "./extension";

export {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  BLOCKING_PAYMENT_STATUSES,
  canPaymentTransition,
  canTransition,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  type OrderStatus,
  type PaymentStatus,
} from "./order-status";

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

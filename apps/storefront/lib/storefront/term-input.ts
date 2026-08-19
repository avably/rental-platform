/**
 * TERM DLA POWŁOKI — JEDNO MIEJSCE REGUŁY „FLAGA OFF → NULL" (ADR-203).
 *
 * Trasy handlowe podają powłoce `term` w SZEŚCIU miejscach (strona główna,
 * podstrona treściowa, /katalog, koszyk, strona sprzętu ×2 gałęzie, kasa).
 * Gdyby każda z nich składała warunek u siebie, pierwsza nowa trasa — albo
 * pierwszy refaktoring jednej z sześciu — zgubiłby flagę na jednej podstronie
 * i na żadnej innej, bez ani jednego błędu w konsoli. Ten helper czyni tę
 * niespójność niewyrażalną: warunek jest JEDEN, a trasy podają wyłącznie
 * składniki. Pilnuje tego kontrakt źródła w store-term-flag.test.tsx
 * (każde `term={` w trasach to `storeTermInput(...)` albo jawny `null`)
 * RAZEM z dowodem behawioralnym na prawdziwym renderze tras.
 *
 * `null` znaczy dla powłoki dokładnie to, co znaczył od ADR-179: pasek
 * terminu nie istnieje (ani pigułka w belce, ani wiersz mobilny, ani panel
 * konfliktu R4 — świadoma decyzja ADR-203: bez globalnej zmiany terminu nie
 * ma zdarzenia, o którym panel R4 opowiada; konflikt per-sprzęt obsługuje
 * widget strony sprzętu i wiążąca bramka serwera). Widget `ProductBooking`
 * NIE przechodzi przez ten helper i flagi nie zna — ma własne pole i własne
 * okno wyboru, więc przy wyłączonej pigułce pozostaje JEDYNYM, w pełni
 * samowystarczalnym miejscem wyboru terminu.
 */
import type { StoreTermInput } from "@/components/storefront/store-chrome";
import type { StoreTermProduct } from "@/components/storefront/store-term";
import type { StoreFlags } from "@/lib/site/store-flags";
import type { StorefrontLocale } from "@/lib/storefront/locale";

export function storeTermInput(
  flags: StoreFlags,
  products: StoreTermProduct[],
  locale: StorefrontLocale,
): StoreTermInput | null {
  return flags.termCalendarEnabled ? { products, locale } : null;
}

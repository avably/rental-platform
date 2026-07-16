import { DEFAULT_LOCALE, LOCALES } from "@avably/core";
import { defineRouting } from "next-intl/routing";

/**
 * Routing locale storefrontu — ta sama konwencja co w panelu: prefiks zawsze
 * jawny, domyślnie EN.
 *
 * To jest oś PLATFORMY (strony marketingowe pod kanonem). Storefront TENANTA
 * pod `<slug>.avably.io` ma własną oś: język bierze z `tenants.locale`, a nie
 * z preferencji przeglądarki odwiedzającego — kupujący ma zobaczyć sklep w
 * języku, który ustawił najemca. Rozstrzygnięcie tenanta po hoście dochodzi
 * razem z routingiem po subdomenie.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

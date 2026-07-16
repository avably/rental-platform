import { DEFAULT_LOCALE, LOCALES } from "@avably/core";
import { defineRouting } from "next-intl/routing";

/**
 * Routing locale panelu. Prefiks ZAWSZE jawny (`/en`, `/pl`) — również dla
 * domyślnego EN. Wariant "as-needed" dawałby dwa adresy tej samej strony
 * (`/` i `/en`), co psuje kanonizację i utrudnia czytanie logów.
 *
 * `/` przekierowuje na locale wykryte z nagłówka Accept-Language, z fallbackiem
 * na EN.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

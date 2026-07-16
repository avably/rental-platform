/**
 * Ścieżki świadome locale dla przekierowań server-side.
 *
 * Guardy (`requireSuperadminPage`, sprawdzenia `getAuthContext`) przekierowują
 * na ścieżki wewnętrzne zapisane bez prefiksu języka (`/login`,
 * `/bezpieczenstwo`). Routing panelu ma `localePrefix: "always"`, więc taką
 * ścieżkę i tak dostanie prefiks — ale nadany PONOWNIE przez next-intl, czyli
 * z wykrywania (cookie/Accept-Language), a nie z adresu, na którym user
 * faktycznie stał. Polski użytkownik wchodzący na /pl/admin/tenants lądował
 * przez to na /en/login.
 *
 * Dlatego prefiks doklejamy TU, zanim redirect opuści guarda.
 *
 * Zwracamy ścieżkę, a nie wołamy `redirect()` w środku, celowo: wywołanie
 * `redirect()` musi zostać w miejscu użycia, żeby TypeScript widział jego
 * typ `never` i zawężał (`if (!ctx) redirect(await localePath("/login"))`
 * pozostawia `ctx` zawężone, `await redirectLocalized(...)` już nie).
 *
 * KONWENCJA: ścieżki `next` (dokąd wrócić po zalogowaniu / wyzwaniu MFA)
 * trzymamy BEZ prefiksu locale i lokalizujemy dopiero w chwili przekierowania
 * — inaczej dostalibyśmy podwójny prefiks (`/pl/pl/admin`).
 */
import { getLocale } from "next-intl/server";

import { getPathname } from "@/i18n/navigation";

export type Query = Record<string, string>;

/**
 * Ścieżka wewnętrzna z prefiksem locale BIEŻĄCEGO żądania.
 *
 * `getPathname` z next-intl (a nie ręczne `/${locale}${path}`) — prefiks ma
 * wynikać z konfiguracji routingu, żeby zmiana `localePrefix` nie wymagała
 * poprawiania tego pliku.
 */
export async function localePath(pathname: string, query?: Query): Promise<string> {
  const locale = await getLocale();
  return getPathname({
    href: query ? { pathname, query } : pathname,
    locale,
  });
}

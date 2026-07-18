/**
 * Nagłówki tenanta na ŻĄDANIU — kontrakt zaufania między middleware a stronami
 * tenanckimi (Zadanie 2.1, ADR-039).
 *
 * BRAMKA ANTY-SPOOFINGU. Strona tenancka ufa `x-tenant-id` jako tożsamości
 * tenanta. Gdyby klient mógł podać ten nagłówek i zostać mu zaufanym, każdy
 * odwiedzający dowolny storefront mógłby udawać cudzego tenanta — złamanie
 * izolacji u samego wejścia. Dlatego middleware NAJPIERW usuwa każdy
 * przychodzący nagłówek tenanta (`stripInboundTenantHeaders`), a dopiero potem
 * — wyłącznie na gałęzi tenanckiej i wyłącznie z rozwiązania server-side —
 * ustawia go z powrotem (`setResolvedTenant`). Klient nie ma jak przemycić
 * własnej wartości.
 */

export const TENANT_ID_HEADER = "x-tenant-id";
export const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * Usuwa WSZYSTKIE nagłówki tenanta przyniesione przez klienta. Wołane na
 * KAŻDEJ gałęzi (marketing, tenant, 404), zanim cokolwiek przekaże żądanie
 * dalej — żaden przychodzący nagłówek tenanta nie przetrwa middleware.
 * `Headers.delete` jest case-insensitive, więc `X-Tenant-Id` również padnie.
 */
export function stripInboundTenantHeaders(headers: Headers): void {
  headers.delete(TENANT_ID_HEADER);
  headers.delete(TENANT_SLUG_HEADER);
}

/**
 * Ustawia rozwiązane server-side nagłówki tenanta (nadpisuje, nie dokłada).
 *
 * `slug` jest OPCJONALNY od 2.6 (ADR-046): własna domena najemcy rozwiązuje się
 * przez `app.resolve_tenant_by_domain`, które zwraca SAM uuid — slugu po prostu
 * nie znamy, a dopisanie zgadywanej wartości byłoby gorsze niż jej brak.
 * Bramka anty-spoofingu zostaje nienaruszona: `stripInboundTenantHeaders`
 * zdejmuje OBA nagłówki bezwarunkowo, więc pominięty tu slug znaczy
 * „nieustawiony", nigdy „przepuszczony od klienta". Tożsamością tenanta, której
 * ufają trasy, jest `x-tenant-id`.
 */
export function setResolvedTenant(headers: Headers, tenant: { id: string; slug?: string }): void {
  headers.set(TENANT_ID_HEADER, tenant.id);
  if (tenant.slug) headers.set(TENANT_SLUG_HEADER, tenant.slug);
}

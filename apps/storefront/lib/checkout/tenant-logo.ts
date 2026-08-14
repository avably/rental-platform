/**
 * ZNAK NAJEMCY W POTWIERDZENIU ZAMÓWIENIA (ADR-175) — strona sklepu.
 *
 * Klient, który właśnie zarezerwował sprzęt, dostaje wiadomość od WYPOŻYCZALNI
 * — a nie od platformy, o której istnieniu nie musi wiedzieć. Znak przyjeżdża
 * tą samą drogą, co do nagłówka sklepu (`app.get_tenant_appearance`, ADR-171),
 * więc jest to DOKŁADNIE ten obraz, który klient widział minutę wcześniej,
 * składając zamówienie, i dokładnie ten sam adres publiczny.
 *
 * ============ IZOLACJA ============
 *
 * `tenantId` przychodzi z nagłówka wstrzykniętego przez proxy po rozwiązaniu
 * HOSTA server-side i jest tym SAMYM identyfikatorem, którym powstało
 * zamówienie (argument `p_tenant_id` w `app.public_checkout`) — więc znak
 * pochodzi z wiersza najemcy, którego dotyczy wiadomość, a nie z „bieżącego
 * najemcy" rozumianego jako stan sesji. Sama funkcja bazy jest SECURITY
 * DEFINER z jawnym zawężeniem `t.id = p_tenant_id`.
 *
 * ============ NIE RZUCA ============
 *
 * Wzorzec 8b bez wyjątku: zamówienie jest w tym momencie utrwalone i żaden
 * problem z odczytem znaku nie może go cofnąć ani zamienić wysyłki w porażkę.
 * Nieudany odczyt znaczy tu tyle, co brak znaku — wiadomość wyjdzie z nazwą
 * wypożyczalni, jak wychodziła.
 */
import type { EmailTenantLogo } from "@avably/emails";

import { getTenantAppearance } from "@/lib/site/published";
import { resolveStoreLogo } from "@/lib/site/store-logo";

/**
 * Fragment zależności `sendCheckoutEmails`: `{ tenantLogo }` albo pusty obiekt.
 *
 * Kształt jest taki, a nie `EmailTenantLogo | undefined`, żeby wołający wpiął
 * go rozwinięciem i nie musiał powtarzać warunku „dołóż klucz, gdy jest znak".
 */
export async function checkoutEmailLogo(
  tenantId: string,
  tenantName: string,
): Promise<{ tenantLogo?: EmailTenantLogo }> {
  try {
    const appearance = await getTenantAppearance(tenantId);
    const logo = resolveStoreLogo(
      appearance,
      tenantName,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    );
    return logo ? { tenantLogo: { src: logo.src, alt: logo.alt } } : {};
  } catch {
    return {};
  }
}

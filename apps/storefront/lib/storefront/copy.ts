/**
 * Copy storefrontu tenanta wg `tenants.locale` (oś tenancka, nie URL) — ładowane
 * z messages/<locale>.json i przekazywane PROPSAMI do komponentów (wzorzec
 * waitlisty: LandingCopy jako prop). Oś tenancka nie przechodzi przez next-intl
 * middleware (język bierze z tenanta, nie z przeglądarki), więc nie używamy tu
 * providera — czysty obiekt stringów wystarcza i jest serializowalny do klienta.
 *
 * Parytet kluczy EN↔PL pilnuje test messages-parity — brak stringa w jednym
 * locale pada w CI, nie w przeglądarce klienta.
 */
import type { StorefrontLocale } from "@/lib/storefront/locale";
import plMessages from "../../messages/pl.json";

/** Kształt copy wywiedziony z PL (źródło prawdy struktury); EN ma parytet. */
export type StorefrontCopy = (typeof plMessages)["storefront"];

const LOADERS: Record<StorefrontLocale, () => Promise<{ default: { storefront: StorefrontCopy } }>> = {
  pl: () => import("../../messages/pl.json"),
  en: () => import("../../messages/en.json"),
};

export async function getStorefrontCopy(locale: StorefrontLocale): Promise<StorefrontCopy> {
  const messages = await LOADERS[locale]();
  return messages.default.storefront;
}

/**
 * Prosta interpolacja `{token}` → wartość (kilka miejsc: liczby sztuk, nazwa
 * produktu, sformatowana cena). Świadomie minimalna — nie ICU: copy tenancki
 * nie ma liczby mnogiej ani formatów zależnych od locale (te robi formatMoney).
 */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

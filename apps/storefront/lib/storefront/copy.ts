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

/**
 * LICZNIK POZYCJI Z POPRAWNĄ ODMIANĄ („1 pozycja / 2 pozycje / 5 pozycji").
 *
 * Regułę mnogości rozstrzyga `Intl.PluralRules` dla locale NAJEMCY (oś
 * tenancka, jak całe copy) — a nie drabinka `if` po końcówkach, która dla
 * polskiego myli się na 12–14 i na setkach. Copy niesie TRZY formy jako
 * szablony; angielski ma form dwie, więc `few` powtarza `many` w pliku
 * messages (parytet kluczy pilnowany testem), a `other` CLDR schodzi na
 * `many` — dla obu języków to jest właściwa forma domyślna.
 */
export function pluralCount(
  total: number,
  locale: StorefrontLocale,
  forms: { one: string; few: string; many: string },
): string {
  const rule = new Intl.PluralRules(locale).select(total);
  const template = rule === "one" ? forms.one : rule === "few" ? forms.few : forms.many;
  return format(template, { total });
}

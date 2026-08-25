/**
 * LISTA KORZYŚCI POD PRZYCISKIEM REZERWACJI (spec 2026-08-25, benchmark pkt 5).
 *
 * ==================== SKĄD SIĘ BIERZE ====================
 *
 * Wzorzec z przejścia właściciela po czołowych sklepach: karta zakupu ma pod
 * przyciskiem krótką listę konkretów, po których klient rozstrzyga „czy to jest
 * dla mnie", zanim kliknie. Adaptacja do najmu, nie kopia — u nas konkretem
 * jest KAUCJA i RABAT ZA DŁUŻSZY NAJEM.
 *
 * ==================== ŻADNEJ OBIETNICY, KTÓREJ NIE MA W DANYCH ====================
 *
 * Każda pozycja tej listy jest ODCZYTEM z pozycji katalogu najemcy, a nie
 * napisem z szablonu. Nie ma tu „darmowej dostawy", „gwarancji najniższej ceny"
 * ani „wysyłki w 24 h": sklep nie ma pola, z którego mógłby je wyprowadzić, a
 * obietnica bez pola jest obietnicą NASZĄ złożoną w imieniu najemcy. Sprzęt bez
 * kaucji i bez progów cenowych nie dostaje listy w ogóle — pusta ramka albo
 * wypełniacz byłyby tą samą wadą, tylko cichszą.
 *
 * ==================== CZEGO TU NIE MA I DLACZEGO ====================
 *
 * Spec wymieniał też metody ODBIORU I DOWOZU („Odbiór osobisty — gratis",
 * „Dowóz od 80 zł"). Ich na tej stronie NIE MA i nie jest to przeoczenie:
 * ustawienia dostaw jadą do sklepu WYŁĄCZNIE kopertą `app.get_public_catalog`,
 * czyli odczytem O(katalogu), którego strona sprzętu świadomie nie wykonuje od
 * ADR-185 (bramka `koszt-odslony.integration`: „strona sprzętu NIE POBIERA
 * pozycji, których nie pokazuje"). Wąskiego odczytu metod dostawy dziś nie ma,
 * a dołożenie go to migracja — czyli decyzja spoza tego zadania. Kształt
 * wyniku (lista etykiet) jest po to, żeby dopisanie ich później było dopisaniem
 * pozycji, a nie przebudową karty.
 */
import { formatMoney, type CurrencyCode, type PriceParams } from "@avably/core";

import { format, type StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

export interface ProductBenefit {
  /** Rodzaj pozycji — stabilny znacznik dla testów i dla klucza Reacta. */
  kind: "deposit" | "tier";
  label: string;
}

/**
 * PRÓG, KTÓRY WARTO POKAZAĆ: najkrótszy najem, od którego cena spada.
 *
 * Najkrótszy, a nie najgłębszy rabat — bo klient stojący nad kalendarzem
 * decyduje „czy przedłużyć o dzień", a nie „czy wziąć na miesiąc". Progi bez
 * upustu (`multiplier >= 1`) i próg jednodniowy odpadają: pierwszy nie jest
 * korzyścią, drugi nie jest progiem (najem zaczyna się od doby).
 */
function bestTier(params: PriceParams): { days: number; percent: number } | null {
  const candidates = params.tiers
    .filter((tier) => tier.tierDays >= 2 && tier.multiplier < 1)
    .sort((a, b) => a.tierDays - b.tierDays);

  const tier = candidates[0];
  if (!tier) return null;

  const percent = Math.round((1 - tier.multiplier) * 100);
  return percent > 0 ? { days: tier.tierDays, percent } : null;
}

export function productBenefits({
  priceParams,
  copy,
  currency,
  locale,
}: {
  priceParams: PriceParams;
  copy: StorefrontCopy;
  currency: CurrencyCode;
  locale: StorefrontLocale;
}): ProductBenefit[] {
  const benefits: ProductBenefit[] = [];

  const tier = bestTier(priceParams);
  if (tier) {
    benefits.push({
      kind: "tier",
      label: format(copy.product.benefitTier, { days: tier.days, percent: tier.percent }),
    });
  }

  if (priceParams.depositGrosze > 0) {
    benefits.push({
      kind: "deposit",
      label: format(copy.product.benefitDeposit, {
        amount: formatMoney(priceParams.depositGrosze, currency, locale),
      }),
    });
  }

  return benefits;
}

/**
 * Cennik SaaS Avably — JEDNO źródło prawdy o obietnicy cenowej (ADR-135).
 *
 * Kwoty są DECYZJĄ WŁAŚCICIELA (wariant B pricingu, 2026-08-08; kontrakt
 * publiczny na LP): Standard 199 zł netto/mies., Premium 399 zł netto/mies.,
 * rok z góry w cenie DZIESIĘCIU miesięcy, trial 14 dni bez karty, bez umowy
 * na rok, bez opłaty wdrożeniowej. Ekran planu w panelu (J2 faza 1) czyta
 * wyłącznie stąd — cyfra zaszyta w komponencie albo w messages i18n to
 * rozjazd z obietnicą, który pali test parytetu
 * (apps/panel/test/plan-billing-section.test.tsx).
 *
 * LP (apps/storefront/messages/{pl,en}.json, marketing.pricingPage) trzyma
 * dziś te same kwoty jako literały treści przypięte własnym testem
 * (marketing-template.test.ts). Przepięcie LP na tę stałą to OSOBNE zadanie
 * w pasie storefrontu — do tego czasu obie strony pilnują własnych bramek.
 *
 * Tabela `public.plans` (seed 0004: start/pro/max) to PLACEHOLDER sprzed
 * cennika i NIE jest źródłem tych kwot — jej wymiana na standard/premium
 * należy do fazy 2 (Stripe jako prawda handlowa, plans jako katalog
 * uprawnień).
 */

/** Długość triala w dniach — lustro `now() + interval '14 days'` z 0066. */
export const SAAS_TRIAL_DAYS = 14;

/**
 * Rok z góry kosztuje tyle, co N miesięcy. Obietnica LP: „rok w cenie
 * dziesięciu miesięcy" — rabat jest ILORAZEM, nie procentem.
 */
export const SAAS_YEARLY_MONTHS_CHARGED = 10;

export type SaasPlanId = "standard" | "premium";

export interface SaasPlanPricing {
  id: SaasPlanId;
  /** Abonament miesięczny NETTO w groszach (VAT 23% dochodzi na fakturze). */
  monthlyNetGrosze: number;
  /** Rok z góry NETTO w groszach = monthlyNetGrosze × SAAS_YEARLY_MONTHS_CHARGED. */
  yearlyNetGrosze: number;
}

export const SAAS_PLAN_PRICING: readonly SaasPlanPricing[] = [
  { id: "standard", monthlyNetGrosze: 199_00, yearlyNetGrosze: 1_990_00 },
  { id: "premium", monthlyNetGrosze: 399_00, yearlyNetGrosze: 3_990_00 },
] as const;

import type { ContractLocale } from "./types";

/**
 * Formatuje kwotę podaną w GROSZACH na string do wyświetlenia w dokumencie.
 *
 * Pakiet nie liczy kwot — dostaje gotową liczbę groszy i składa jej
 * reprezentację. Formatowanie jest RĘCZNE (bez `Intl.NumberFormat`), żeby
 * snapshoty były deterministyczne niezależnie od wersji ICU w środowisku CI
 * kontra maszyna dewelopera. Separator dziesiętny zależy od locale, waluta
 * jest kodem podanym przez wołającego (PLN, EUR, …) i idzie po kwocie.
 *
 * Bez grupowania tysięcy — token liczbowy zostaje ciągły, co czyni asercje
 * na kwotach w wyekstrahowanym tekście PDF odpornymi na sposób, w jaki
 * parser rozkłada spacje.
 */
export function formatMoney(
  grosze: number,
  currency: string,
  locale: ContractLocale,
): string {
  const rounded = Math.round(grosze);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const decimalSeparator = locale === "pl" ? "," : ".";
  const amount = `${major}${decimalSeparator}${String(minor).padStart(2, "0")}`;
  const sign = negative ? "-" : "";
  return `${sign}${amount} ${currency}`;
}

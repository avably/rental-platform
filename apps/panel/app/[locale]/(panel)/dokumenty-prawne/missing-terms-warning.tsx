import { useTranslations } from "next-intl";

/**
 * OSTRZEŻENIE: SKLEP SPRZEDAJE BEZ OPUBLIKOWANEGO REGULAMINU (B4, ADR-129).
 *
 * Stan jest realny i dzisiaj DOMYŚLNY: migracja 0063 przeniosła treść
 * regulaminu z ustawień umów do szkicu, ale świadomie NIE opublikowała jej za
 * najemcę — opublikowanie cudzego dokumentu prawnego w jego imieniu uczyniłoby
 * nas jego autorem. Skutkiem jest sklep, który przyjmuje zamówienia z polem
 * „akceptuję regulamin", a klient nie ma pod czym tego regulaminu przeczytać.
 *
 * OSTRZEŻENIE NICZEGO NIE BLOKUJE — decyzja właściciela. Twardy blok
 * sprzedaży bez regulaminu to osobne zadanie po epiku H1; wprowadzony tutaj,
 * bokiem, zatrzymałby sprzedaż wszystkim dzisiejszym najemcom w chwili
 * wdrożenia. Ostrzeżenie mówi więc wprost, CO Z TEGO WYNIKA, i zostawia
 * decyzję najemcy.
 *
 * `role="status"`, nie `role="alert"`: to stan zastany ekranu, a nie zdarzenie,
 * które właśnie zaszło — `alert` przerywałby czytnikowi ekranu lekturę strony
 * przy każdym wejściu.
 */
export function MissingTermsWarning() {
  const t = useTranslations("legalDocuments");

  return (
    <section
      data-legal-terms-warning
      role="status"
      className="border-status-attention-border bg-status-attention-bg text-status-attention-fg flex flex-col gap-1.5 rounded-lg border p-5"
    >
      <p className="text-sm font-semibold">{t("warningTitle")}</p>
      <p className="text-[13px] leading-[18px]">{t("warningBody")}</p>
      <p className="text-[13px] leading-[18px]">{t("warningConsequence")}</p>
    </section>
  );
}

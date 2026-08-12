import { Button } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";

import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";

/**
 * Karta podglądu umowy (U10, ADR-151) — odpowiedź na „operator zapisuje
 * warunki w ciemno" z audytu UX (2.18).
 *
 * Wzorzec bierzemy z ekranu Progi cenowe (W8 audytu): ekran ma pokazać WYNIK
 * liczony/rysowany TYM SAMYM mechanizmem, który zadziała na produkcji. Tam jest
 * to silnik wyceny, tutaj — szablon umowy z `packages/pdf`. Różnica jest tylko
 * w nośniku: wycena mieści się w tabeli obok formularza, a umowa to dwustronicowy
 * PDF, więc otwiera się w nowej karcie zamiast wciskać się w miarę formularza.
 *
 * Karta mówi wprost trzy rzeczy, których operator nie ma skąd wiedzieć:
 *   1. podgląd pokazuje ZAPISANE ustawienia (a nie to, co właśnie wpisano),
 *   2. niczego nie zapisuje — nie ma po nim dokumentu w historii zamówienia,
 *   3. skąd bierze się nazwa firmy, której na tym ekranie nie ma (audyt 6.3).
 */
export function ContractPreviewCard({ available }: { available: boolean }) {
  const t = useTranslations("contractSettings");
  const locale = useLocale();

  return (
    <ScreenSection
      data-contract-preview={available ? "ready" : "missing"}
      title={t("previewTitle")}
      description={t("previewIntro")}
    >
      {available ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {/*
              Zwykła kotwica, nie <Link> routera: odpowiedzią jest strumień
              application/pdf, a nie trasa Reacta — nawigacja klienta nie ma
              czego wyrenderować. `target="_blank"` wymaga `rel="noreferrer"`:
              trasa jest nasza, ale nowej karty z dostępem do `window.opener`
              nie zostawiamy nawet u siebie.
            */}
            <Button asChild type="button" variant="secondary">
              <a
                href={`/${locale}/ustawienia-umow/podglad`}
                target="_blank"
                rel="noreferrer"
                data-contract-preview-link
              >
                {t("previewOpen")}
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("previewNoTrace")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("previewCustomFields")}
          </p>
        </>
      ) : (
        <p className="text-sm">{t("previewMissing")}</p>
      )}

      <p className="text-muted-foreground text-[13px] leading-[18px]">
        {t("companyNameSource")}{" "}
        <Link
          href="/organizacja"
          className="underline underline-offset-[3px] hover:no-underline"
          data-contract-company-link
        >
          {t("companyNameLink")}
        </Link>
      </p>
    </ScreenSection>
  );
}

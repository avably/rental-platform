"use client";

/**
 * PANEL „STYL STRONY" (K5, ADR-090) — personalizacja W RAMACH motywu.
 *
 * Operator nie wybiera tu koloru, tylko AKCENT Z PALETY SWOJEGO MOTYWU. Zbiór
 * jest zamknięty i należy do motywu, bo tylko wtedy da się UDOWODNIĆ, że każdy
 * wybór daje czytelną stronę — dowodem jest wyczerpująca bramka kontrastu
 * w @avably/core/site, która chodzi po tym samym rejestrze, z którego pochodzą
 * próbki niżej. Dowolny hex byłby obietnicą bez pokrycia: szesnastu milionów
 * kombinacji nikt nie policzy.
 *
 * Para krojów jest wspólna dla wszystkich motywów, więc wybiera się ją z pełnej
 * listy — motyw wnosi tu tylko wartość domyślną.
 *
 * MIESZKA W OSOBNYM PLIKU (ADR-230), a nie w `builder-palette.tsx`, bo reużywa
 * go DRUGA powierzchnia: ekran „Wygląd sklepu" (`/strona/wyglad`) wpina te same
 * kontrolki akcentu i krojów w `updateStoreStyle` (tenant-global, bez `siteId`).
 * Import z palety kreatora ciągnąłby na tamten ekran całą warstwę przeciągania
 * elementów; osobny liść trzyma zależność cienką i JEDNO źródło tych kontrolek.
 */
import {
  FONT_PAIRS,
  SELECTABLE_FONT_PAIRS,
  accentsOf,
  themeTokens,
  type ResolvedSiteStyle,
  type SiteFontPair,
} from "@avably/core/site";
import { useTranslations } from "next-intl";

import { PanelSelect } from "@/components/fields/panel-select";

export function StylePanel({
  disabled,
  style,
  locale,
  idPrefix,
  onSave,
}: {
  disabled: boolean;
  style: ResolvedSiteStyle;
  locale: string;
  idPrefix: string;
  onSave: (style: ResolvedSiteStyle) => void;
}) {
  const t = useTranslations("site");
  const theme = themeTokens(style.theme);
  const language = locale === "en" ? "en" : "pl";

  return (
    <div data-builder-style className="border-border mt-auto flex flex-col gap-3 border-t pt-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("style.legend")}</h3>
        {/* Opis dyrekcji jest DANYMI motywu — panel go tylko pokazuje. */}
        <p className="text-muted-foreground text-[13px] leading-[18px]">{theme.mood[language]}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-[13px] font-medium">{t("style.accent")}</legend>
        <div className="flex flex-wrap gap-2">
          {accentsOf(style.theme).map((accent) => {
            const wariant = theme.bands.default.accent;
            const swatch = theme.accents[accent]![wariant]!.fill;
            const active = accent === style.accent;
            return (
              <button
                key={accent}
                type="button"
                data-style-accent={accent}
                aria-pressed={active}
                aria-label={accent}
                disabled={disabled}
                onClick={() => onSave({ ...style, accent })}
                className={`size-7 cursor-pointer rounded-full border-2 transition-transform [transition-duration:var(--motion-fast)] disabled:cursor-not-allowed ${
                  active ? "border-foreground scale-110" : "border-border hover:scale-105"
                }`}
                style={{ background: swatch }}
              />
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1" data-style-font-pair>
        <label htmlFor={`${idPrefix}-font-pair`} className="text-[13px] font-medium">
          {t("style.fontPair")}
        </label>
        {/* Kontrolka panelu, nie natywny `select` — kontrakt powłoki (ADR-063)
            pilnuje jednego wyglądu pól w całej aplikacji. */}
        <PanelSelect
          id={`${idPrefix}-font-pair`}
          value={style.fontPair}
          disabled={disabled}
          onValueChange={(value) => onSave({ ...style, fontPair: value as SiteFontPair })}
          options={SELECTABLE_FONT_PAIRS.map((pair) => ({
            value: pair,
            label: FONT_PAIRS[pair].label[language],
          }))}
        />
      </div>
    </div>
  );
}

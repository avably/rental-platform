"use client";

/**
 * GALERIA SZABLONÓW STARTOWYCH (K5 v2, ADR-090) — kafle z MINIATURAMI STRON.
 *
 * ================== DLACZEGO MINIATURA, A NIE IKONKA ==================
 *
 * Operator wypożyczalni nie wybiera „szablonu nr 3" — wybiera stronę, którą za
 * chwilę zobaczy u siebie. Ikonka albo próbka koloru każą mu ZGADYWAĆ, jak to
 * będzie wyglądać, a pierwsze kliknięcie i tak kasuje szkic. Kafel jest więc
 * ZMNIEJSZONYM RENDEREM: tym samym `SiteRenderer`, tymi samymi sekcjami i tym
 * samym motywem, co strona po zastosowaniu szablonu — tyle że w skali.
 *
 * Skalowanie idzie `transform: scale()` na pudełku o szerokości PROJEKTOWEJ,
 * a nie zwężeniem kontenera. To rozróżnienie jest istotne: renderer mierzy
 * KONTENER (ADR-085), więc kontener zwężony do 300 px pokazałby układ TELEFONU
 * — czyli miniaturę czegoś innego, niż operator dostanie na komputerze.
 * `scale()` zmniejsza obraz, nie zmienia szerokości mierzonej przez zapytania
 * kontenera, i miniatura zostaje wierna.
 *
 * ================== DLACZEGO KAFEL NIE JEST INTERAKTYWNY W ŚRODKU ==================
 *
 * Miniatura zawiera odnośniki i przyciski strony (CTA, link autora zdjęcia).
 * W kaflu wyboru byłyby pułapką: kliknięcie „Zarezerwuj" w miniaturze miałoby
 * wybrać szablon, a nie otworzyć cudzy adres. Dlatego cała miniatura ma
 * wyłączone zdarzenia wskaźnika i jest schowana przed czytnikiem ekranu
 * (`aria-hidden`), a klikalny i opisany jest KAFEL — jeden cel, jedna intencja.
 */
import {
  STARTER_TEMPLATES,
  starterTemplateCanvases,
  starterTemplateTheme,
  themeTokens,
  type ResolvedSiteStyle,
  type SectionCanvas,
  type StarterTemplate,
} from "@avably/core/site";
import { SiteRenderer } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Wysokość widocznego wycinka strony w kaflu (px po przeskalowaniu). Kafel
 * pokazuje GÓRĘ strony — hero i początek drugiej sekcji — bo to po nich
 * rozpoznaje się świat wizualny; cała strona zmniejszona do kafla byłaby
 * pasmem nieczytelnych plamek.
 */
const TILE_HEIGHT = 300;

function styleOf(id: StarterTemplate): ResolvedSiteStyle {
  const theme = starterTemplateTheme(id);
  const tokens = themeTokens(theme);
  return { theme, accent: tokens.defaultAccent, fontPair: tokens.fontPair };
}

export function TemplateGallery({
  disabled,
  onPick,
  onDismiss,
}: {
  disabled: boolean;
  onPick: (id: StarterTemplate) => void;
  /** Zamknięcie bez wyboru — nieobecne przy pierwszej wizycie (nie ma do czego wracać). */
  onDismiss?: () => void;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const language = locale === "en" ? "en" : "pl";

  // Sześć pełnych stron to sześć konwersji — liczymy je RAZ na język.
  const previews = useMemo(
    () =>
      STARTER_TEMPLATES.map((id) => ({
        id,
        style: styleOf(id),
        mood: themeTokens(starterTemplateTheme(id)).mood[language],
        sections: starterTemplateCanvases(id, locale).map((section, index) => ({
          id: `${id}-${index}`,
          position: index,
          type: section.type,
          content: section.content as SectionCanvas,
        })),
      })),
    [locale, language],
  );

  return (
    <div data-template-gallery className="bg-background min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t("starter.title")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t("starter.description")}</p>
          </div>
          {onDismiss ? (
            <button
              type="button"
              data-template-gallery-dismiss
              onClick={onDismiss}
              disabled={disabled}
              className="text-muted-foreground hover:text-foreground cursor-pointer text-sm underline"
            >
              {t("starter.dismiss")}
            </button>
          ) : null}
        </header>

        {/* Kafle mają szerokość STAŁĄ, bo taka jest skala miniatury (patrz
            `.starter-preview`); siatka je centruje, zamiast rozciągać. */}
        <ul className="grid grid-cols-[320px] justify-center gap-5 md:grid-cols-[repeat(2,480px)]">
          {previews.map((preview) => (
            <li key={preview.id}>
              <button
                type="button"
                data-starter-template={preview.id}
                disabled={disabled}
                onClick={() => onPick(preview.id)}
                className="border-border hover:border-foreground focus-visible:outline-accent group flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border text-left transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed"
              >
                <span
                  className="bg-muted block overflow-hidden"
                  style={{ height: TILE_HEIGHT }}
                  aria-hidden="true"
                >
                  {/* Skala i szerokość projektowa siedzą w arkuszu panelu
                      (`.starter-preview`) — patrz komentarz tam. */}
                  <span className="starter-preview pointer-events-none block">
                    <SiteRenderer sections={preview.sections} style={preview.style} motion="off" />
                  </span>
                </span>
                <span className="flex flex-col gap-1 p-4">
                  <span className="text-sm font-medium">{t(`starter.names.${preview.id}`)}</span>
                  <span className="text-muted-foreground text-[13px] leading-[18px]">{preview.mood}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

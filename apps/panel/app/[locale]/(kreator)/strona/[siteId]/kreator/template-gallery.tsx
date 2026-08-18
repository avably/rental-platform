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
 * ================== MINIATURA JEST BRATEM PRZYCISKU, NIE JEGO DZIECKIEM ==================
 *
 * (M-A11Y-02, ADR-195.) Miniatura zawiera przyciski i odnośniki strony
 * (przycisk powiększenia w galerii, CTA hero, formularz kontaktu), a kafel
 * był `<button>` — czyli `<button>` w `<button>`. To nie jest „brzydki HTML,
 * który jakoś działa": parser przy pierwszym wewnętrznym `<button>` DOMYKA
 * zewnętrzny (reguła „button in button scope"), więc DOM po sparsowaniu SSR
 * różni się od drzewa Reacta i hydracja pada twardo („Hydration failed"),
 * a React przemalowuje cały ekran od zera. Zasłony `pointer-events: none`
 * i `aria-hidden` tego nie leczą — struktury nie zmieniają, a fokus klawiatury
 * dalej wchodził w elementy schowane przed czytnikiem.
 *
 * Dlatego wzorzec „card action": kafel jest NIEinteraktywnym `<li>`, miniatura
 * martwym pudełkiem (`inert` — poza wskaźnikiem, tab-orderem i drzewem
 * dostępności), a jedynym elementem interaktywnym jest BRAT miniatury —
 * `<button>` z nazwą szablonu, którego strefę kliku rozciąga na cały kafel
 * pseudo-element (`after:absolute after:inset-0`). Jeden cel, jedna intencja,
 * zero interaktywnych potomków w interaktywnym przodku — czego pilnuje bramka
 * `kreator-miniatury-struktura.test.tsx`.
 */
import {
  STARTER_TEMPLATES,
  starterTemplateContents,
  starterTemplateTheme,
  themeTokens,
  type ResolvedSiteStyle,
  type StarterTemplate,
} from "@avably/core/site";
import { SiteRenderer, type RenderSection } from "@avably/ui";
import { Plus } from "lucide-react";
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
  onEmpty,
  onDismiss,
}: {
  disabled: boolean;
  onPick: (id: StarterTemplate) => void;
  /**
   * START OD PUSTEJ STRONY (ADR-161) — pozycja na LIŚCIE punktów wyjścia,
   * a nie osobne pytanie w oknie dodawania strony. Okno dodawania pyta
   * o TOŻSAMOŚĆ strony (nazwa i adres), a nie o jej zawartość; ta lista jest
   * jedynym miejscem, w którym pada pytanie „od czego zacząć" — i pada także
   * przy „zacznij od nowa" na stronie, która treść już ma.
   */
  onEmpty: () => void;
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
        sections: starterTemplateContents(id, locale).map((section, index) => ({
          id: `${id}-${index}`,
          position: index,
          type: section.type,
          content: section.content,
        })) as RenderSection[],
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
          {/*
            PUSTA STRONA STOI PIERWSZA, bo jest jedynym punktem wyjścia bez
            treści do skasowania — i jedynym, którego miniatura byłaby kłamstwem
            (nie ma czego pokazać). Zamiast zmniejszonego renderu dostaje więc
            pole o tej samej wysokości z podpisem: kafel ma wyglądać jak PUSTA
            STRONA, a nie jak brakująca miniatura.
          */}
          <li>
            <button
              type="button"
              data-starter-empty
              disabled={disabled}
              onClick={onEmpty}
              className="border-border hover:border-foreground focus-visible:outline-accent flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border text-left transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed"
            >
              <span
                className="bg-muted text-muted-foreground flex items-center justify-center border-b border-dashed"
                style={{ height: TILE_HEIGHT }}
                aria-hidden="true"
              >
                <Plus className="size-8" />
              </span>
              <span className="flex flex-col gap-1 p-4">
                <span className="text-sm font-medium">{t("starter.emptyName")}</span>
                <span className="text-muted-foreground text-[13px] leading-[18px]">
                  {t("starter.emptyMood")}
                </span>
              </span>
            </button>
          </li>

          {previews.map((preview) => (
            /*
              KAFEL NIE JEST PRZYCISKIEM (ADR-195) — patrz nagłówek pliku.
              Interaktywny jest wyłącznie pasek z nazwą; jego `::after` pokrywa
              cały kafel, więc klik działa wszędzie tak, jak działał. Obrys
              fokusa idzie na tym samym `::after` DO WEWNĄTRZ kafla (ujemny
              offset): dodatni wystawałby poza `overflow-hidden` rodzica
              i zostałby ucięty w pionie.
            */
            <li
              key={preview.id}
              className="border-border hover:border-foreground relative flex flex-col overflow-hidden rounded-lg border transition-colors [transition-duration:var(--motion-fast)]"
            >
              {/*
                `inert` robi CAŁĄ robotę zasłon naraz i strukturalnie: zdejmuje
                miniaturę ze wskaźnika, z tab-orderu i z drzewa dostępności.
                `aria-hidden` zostaje dla czytników sprzed inert; klasa
                `pointer-events-none` na skali — dla kompletu. Fokus NIE ma już
                jak wejść w treść miniatury, bo martwe jest całe pudełko.
              */}
              <span
                aria-hidden="true"
                inert
                data-starter-miniatura={preview.id}
                className="bg-muted block overflow-hidden"
                style={{ height: TILE_HEIGHT }}
              >
                {/* Skala i szerokość projektowa siedzą w arkuszu panelu
                    (`.starter-preview`) — patrz komentarz tam. */}
                <span className="starter-preview pointer-events-none block">
                  <SiteRenderer sections={preview.sections} style={preview.style} motion="off" />
                </span>
              </span>
              <button
                type="button"
                data-starter-template={preview.id}
                disabled={disabled}
                onClick={() => onPick(preview.id)}
                className="focus-visible:after:outline-accent flex cursor-pointer flex-col gap-1 p-4 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-solid focus-visible:after:outline-[3px] focus-visible:after:-outline-offset-2 disabled:cursor-not-allowed"
              >
                {/* Dostępna nazwa kafla = widoczna nazwa szablonu (plus nastrój)
                    — czytnik ogłasza to, co widać, bez osobnego aria-label. */}
                <span className="text-sm font-medium">{t(`starter.names.${preview.id}`)}</span>
                <span className="text-muted-foreground text-[13px] leading-[18px]">{preview.mood}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

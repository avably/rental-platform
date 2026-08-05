"use client";

/**
 * PICKER SEKCJI (E2) — JEDYNA droga dodania sekcji: typy po lewej, PODGLĄDY
 * po prawej.
 *
 * ==================== DLACZEGO PICKER, A NIE PRZECIĄGANIE ====================
 *
 * Do E2 sekcję dodawało się dwiema drogami: kliknięciem kafla w palecie (na
 * końcu strony) albo przeciągnięciem kafla na podświetlone miejsce. Decyzja
 * właściciela z grilla planu „Sekcje 2.0" wycina przeciąganie Z PALETY w
 * całości: klik w „+" między sekcjami jest jedyną drogą, bo wskazuje miejsce
 * DOKŁADNIE i działa bez myszy. Przeciąganie ISTNIEJĄCYCH sekcji (uchwyt,
 * strzałki ↑↓) zostaje bez zmian — tam problem naprawdę brzmi „przenieś to
 * na tamto".
 *
 * ==================== DLACZEGO PODGLĄD, A NIE SAM OPIS ====================
 *
 * Kafel z nazwą i jednym zdaniem opisu każe operatorowi ZGADYWAĆ, co dostanie;
 * jedyną drogą sprawdzenia było dodanie i cofnięcie. Podgląd jest ZMNIEJSZONYM
 * RENDEREM dokładnie tej treści, którą wstawi kliknięcie — ten sam
 * `SiteRenderer`, ten sam motyw strony, ten sam preset. Nie ilustracja: wynik.
 *
 * Typ strukturalny (v3, ADR-094) ma podgląd NA KAŻDY WARIANT UKŁADU ze swojego
 * rejestru, bo to jest realny wybór operatora („rozwijane odpowiedzi" kontra
 * „lista otwarta" to dwie różne sekcje FAQ, nie dwa odcienie tej samej).
 * Typ płótnowy ma jeden podgląd — jego preset jest jeden.
 *
 * ==================== MIEJSCE OPISUJE SĄSIAD ====================
 *
 * Picker nie zna indeksów. Dostaje `beforeId` — identyfikator sekcji, NAD którą
 * ma stanąć nowa — i oddaje go wołającemu bez interpretacji. Brak kotwicy
 * znaczy „na końcu strony". Powód jest w `orderWithSectionBefore`
 * (@avably/core/site): indeks przestaje być prawdą, gdy między kliknięciem
 * a zapisem lista się zmieni, a identyfikator zostaje prawdą zawsze.
 */
import {
  SECTION_TYPES,
  isPinnedLastType,
  isStructuredType,
  presetContentFor,
  sectionCanvasFrom,
  structuredPresetFor,
  structuredSpecOf,
  withStructuredLayout,
  type ResolvedSiteStyle,
  type SectionType,
} from "@avably/core/site";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SiteRenderer,
  type RenderSection,
  type StorefrontProduct,
} from "@avably/ui";
import {
  AlignLeft,
  HelpCircle,
  Images,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MapPin,
  Megaphone,
  MousePointerClick,
  PanelBottom,
  Plus,
  Quote,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { siteImagePublicBase } from "@/lib/site-image-base";

/** Ikona typu sekcji w kolumnie wyboru. */
const SECTION_TYPE_ICONS: Record<SectionType, LucideIcon> = {
  hero: Megaphone,
  products: LayoutGrid,
  pricing: Tag,
  faq: HelpCircle,
  contact: Mail,
  freeform: AlignLeft,
  testimonials: Quote,
  gallery: Images,
  usp: Sparkles,
  cta: MousePointerClick,
  directions: MapPin,
  delivery: Truck,
  footer: PanelBottom,
};

/**
 * MIEJSCE WSTAWIENIA — to samo pojęcie, którym mówi serwer (`insertBefore`).
 * `beforeId` nieobecne = koniec strony (czyli „+" pod ostatnią sekcją, kafel
 * palety i pusta strona).
 */
export interface InsertTarget {
  beforeId?: string;
  /** Typ sekcji, NAD którą stanie nowa — wyłącznie do opisu w oknie. */
  beforeType?: SectionType;
}

/** Wariant układu do wstawienia: nazwa z rejestru albo `undefined` (płótno v2). */
export type InsertLayout = string | undefined;

/** Treść, którą wstawi kliknięcie — DOKŁADNIE ta, którą pokazuje podgląd. */
function previewContent(type: SectionType, layout: InsertLayout, locale: string): unknown {
  if (!isStructuredType(type)) return sectionCanvasFrom(type, presetContentFor(type, locale));
  const preset = structuredPresetFor(type, locale);
  return layout ? withStructuredLayout(preset, layout) : preset;
}

/** Warianty do pokazania: układy z rejestru (v3) albo jeden preset (v2). */
function layoutsOf(type: SectionType): InsertLayout[] {
  return isStructuredType(type) ? [...structuredSpecOf(type).layouts] : [undefined];
}

export function SectionPicker({
  open,
  target,
  style,
  products,
  disabled,
  unavailableTypes,
  onAdd,
  onClose,
}: {
  open: boolean;
  /** Gdzie wejdzie nowa sekcja. `null`, gdy okno jest zamknięte. */
  target: InsertTarget | null;
  /** Motyw SZKICU — podgląd ma pokazywać stronę operatora, nie stronę wzorcową. */
  style: ResolvedSiteStyle;
  /** Katalog do podglądu sekcji produktów — inaczej pokazywałaby pustkę. */
  products: StorefrontProduct[];
  disabled: boolean;
  /** Typy, których strona nie przyjmie drugi raz (dziś: stopka) — ADR-092. */
  unavailableTypes: readonly SectionType[];
  onAdd: (type: SectionType, layout: InsertLayout, target: InsertTarget) => void;
  onClose: () => void;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const [selected, setSelected] = useState<SectionType>(SECTION_TYPES[0]!);

  /*
   * Typ przypięty ma na stronie dokładnie jedno miejsce — koniec. Wstawiony
   * z „+" w środku strony i tak wylądowałby na dole (normalizacja serwera),
   * więc kafel, który by to obiecał, KŁAMAŁBY o wyniku. Zamiast tego mówi
   * wprost, dlaczego jest wyłączony.
   */
  const atEnd = target?.beforeId === undefined;
  const reasonFor = (type: SectionType): string | null => {
    if (unavailableTypes.includes(type)) return t("sections.alreadyOnPage");
    if (isPinnedLastType(type) && !atEnd) return t("sectionPicker.pinnedOnlyAtEnd");
    return null;
  };

  const blocked = reasonFor(selected);
  const previews = useMemo(
    () =>
      layoutsOf(selected).map((layout, index) => ({
        layout,
        key: layout ?? "default",
        section: {
          id: `${selected}-${index}`,
          position: index,
          type: selected,
          content: previewContent(selected, layout, locale),
        } as RenderSection,
      })),
    [selected, locale],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        onClose();
        // Następne otwarcie zaczyna od góry listy: okno pamiętające ostatni
        // wybór podpowiadałoby typ, którego operator już użył.
        setSelected(SECTION_TYPES[0]!);
      }}
    >
      <DialogContent data-section-picker className="max-h-[85vh] gap-4 overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("sectionPicker.title")}</DialogTitle>
          <DialogDescription data-picker-target={target?.beforeId ?? "end"}>
            {target?.beforeType
              ? t("sectionPicker.placeBefore", { type: t(`sectionTypes.${target.beforeType}`) })
              : t("sectionPicker.placeAtEnd")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 md:grid-cols-[240px_1fr]">
          <ul
            data-picker-types
            aria-label={t("sectionPicker.typesLegend")}
            className="border-border flex max-h-[55vh] list-none flex-col gap-1 overflow-y-auto p-0 md:border-r md:pr-3"
          >
            {SECTION_TYPES.map((type) => {
              const Icon = SECTION_TYPE_ICONS[type];
              const active = type === selected;
              return (
                <li key={type}>
                  <button
                    type="button"
                    data-picker-type={type}
                    aria-pressed={active}
                    onClick={() => setSelected(type)}
                    className={`focus-visible:outline-accent dark:focus-visible:outline-ring flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:-outline-offset-2 ${
                      active ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{t(`sectionTypes.${type}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div data-picker-previews className="flex max-h-[55vh] min-w-0 flex-col items-center gap-3 overflow-y-auto">
            <p className="text-muted-foreground self-start text-[13px] leading-[18px]">
              {t(`sectionTypeDescriptions.${selected}`)}
            </p>

            {blocked ? (
              <p role="status" data-picker-blocked className="text-muted-foreground text-sm">
                {blocked}
              </p>
            ) : null}

            {previews.map((preview) => {
              const label = preview.layout
                ? t(`structured.${selected}.layouts.${preview.layout}`)
                : t("sectionPicker.singleLayout");
              return (
                <button
                  key={preview.key}
                  type="button"
                  data-picker-add={preview.key}
                  data-picker-add-type={selected}
                  disabled={disabled || blocked !== null}
                  aria-label={t("sectionPicker.addVariant", {
                    type: t(`sectionTypes.${selected}`),
                    layout: label,
                  })}
                  onClick={() => {
                    if (!target) return;
                    onAdd(selected, preview.layout, target);
                    onClose();
                    setSelected(SECTION_TYPES[0]!);
                  }}
                  className="border-border hover:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex cursor-pointer flex-col overflow-hidden rounded-lg border text-left outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {/*
                    PODGLĄD JEST NIEKLIKALNY W ŚRODKU (wzorzec galerii szablonów):
                    zawiera przyciski i odnośniki strony, a w oknie wyboru każdy
                    z nich byłby pułapką — klik ma dodać sekcję, a nie otworzyć
                    cudzy adres. Skala siedzi w arkuszu (`.section-preview`),
                    bo zwężenie kontenera pokazałoby układ TELEFONU (ADR-085).
                  */}
                  {/*
                    WYSOKOŚĆ WYCINKA (px po przeskalowaniu). Kafel pokazuje GÓRĘ
                    sekcji — tyle, żeby różnica MIĘDZY WARIANTAMI była widoczna
                    (przy FAQ: rozwinięte odpowiedzi kontra same pytania), a nie
                    sam nagłówek. Szerokość kafla i skala są STAŁE i dobrane do
                    siebie (arkusz: `.section-preview`), bo skali nie da się
                    policzyć z szerokości kontenera: `scale()` przyjmuje LICZBĘ,
                    a dzielenie jednostki kontenerowej przez liczbę daje długość.
                  */}
                  <span
                    className="section-preview-frame bg-muted block w-[320px] overflow-hidden md:w-[480px]"
                    style={{ height: 260 }}
                    aria-hidden="true"
                  >
                    <span className="section-preview pointer-events-none block">
                      <SiteRenderer
                        sections={[preview.section]}
                        style={style}
                        motion="off"
                        products={products}
                        siteImageBase={siteImagePublicBase()}
                      />
                    </span>
                  </span>
                  <span className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
                    <Plus className="size-4 shrink-0" aria-hidden />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

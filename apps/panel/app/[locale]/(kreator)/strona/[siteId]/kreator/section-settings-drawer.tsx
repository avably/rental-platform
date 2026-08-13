"use client";

/**
 * PRAWA SZUFLADA „Ustawienia sekcji" (K1, ADR-083; płótno — K2, ADR-084).
 *
 * Szuflada ma DWA oblicza, bo treść sekcji ma dwie generacje:
 *   • sekcja v1 dostaje DOTYCHCZASOWY formularz treści (`SectionContentForm`) —
 *     ten sam kod, te same schematy, ta sama akcja;
 *   • sekcja v2 (płótno) dostaje wysokość i tło sekcji oraz treść ZAZNACZONEGO
 *     elementu. To celowo NIE jest edycja w miejscu (klik w tekst na płótnie) —
 *     ta przychodzi z K3 razem z paletą elementów. Bez tych pól K2 ODEBRAŁBY
 *     operatorowi możliwość, którą miał w K1: nowa sekcja rodzi się od razu
 *     jako płótno, więc jej treści nie ma już gdzie poprawić.
 *
 * Zmiany płótna idą przez SZKIC edytora (historia + autozapis), a nie własną
 * akcją — dlatego nie ma tu przycisku „Zapisz": jest jeden kanał zapisu i jeden
 * wskaźnik stanu na całą trasę.
 *
 * Baza szuflady to `Sheet` (Radix Dialog), więc pułapkę fokusu, Escape i powrót
 * fokusu na pasek narzędzi dostajemy z przetestowanego prymitywu.
 */
import {
  isStructuredType,
  type StructuredSectionContent,
  BINDING_EMPTY_MODES,
  BUTTON_VARIANTS,
  ELEMENT_ALIGNMENTS,
  ELEMENT_COLORS,
  ELEMENT_ICONS,
  HEADING_LEVELS,
  PRODUCT_BINDING_FIELDS,
  ICON_TONES,
  IMAGE_FITS,
  SECTION_BACKGROUNDS,
  SECTION_MAX_ROWS,
  SECTION_MIN_ROWS,
  SHAPE_FILLS,
  SHAPE_KINDS,
  TEXT_VARIANTS,
  bindableAttributesOf,
  bindingOf,
  isBoundAttribute,
  productBindingFieldsOf,
  linkHrefSchema,
  sizeOf,
  supportsHug,
  withSize,
  type BindingValueKind,
  type CanvasElement,
  type ElementBinding,
  type ProductBindingField,
  type SectionCanvas,
  type StructuredPickEntry,
} from "@avably/core/site";
import type { CurrencyCode } from "@avably/core";
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SectionContentForm } from "@/app/[locale]/(panel)/strona/section-content-form";
import { PanelSelect } from "@/components/fields/panel-select";
import { FormMeasure } from "@/components/screens/form-measure";

import { StructuredSectionForm, type StructuredFormTab } from "./structured-section-form";
import { replaceElement } from "./use-canvas-editor";

export function SectionSettingsDrawer({
  siteId,
  currency,
  importSources,
  section,
  canvas,
  structured,
  structuredTab,
  selectedElementId,
  onCanvasChange,
  onStructuredChange,
  onConvert,
  onPickImage,
  onClose,
  onSaved,
}: {
  siteId: string;
  /**
   * Wpisy z innych modułów panelu do skopiowania w mini-CMS (E5, ADR-096).
   * Szuflada ich nie czyta — podaje dalej mini-CMS-owi, który zestawia je
   * z deklaracją `itemsImport` w rejestrze typu.
   */
  /** Waluta najemcy — pole pieniężne szuflady (E6). */
  currency: CurrencyCode;
  importSources?: Record<string, readonly unknown[]>;
  /** Sekcja w edycji albo null — szuflada zamknięta. */
  section: EditorSection | null;
  /** Szkic płótna tej sekcji (v2). Brak = sekcja w kształcie v1 albo v3. */
  canvas?: SectionCanvas;
  /** Szkic sekcji STRUKTURALNEJ (v3, ADR-094) — wtedy szuflada jest mini-CMS-em. */
  structured?: StructuredSectionContent;
  /**
   * Zakładka, na której ma się otworzyć mini-CMS (E8) — patrz `initialTab`
   * w `StructuredSectionForm`. Szuflada jej nie interpretuje: przenosi ją od
   * tego, kto ją otworzył, do formularza.
   */
  structuredTab?: StructuredFormTab;
  selectedElementId: string | null;
  onCanvasChange: (update: (canvas: SectionCanvas) => SectionCanvas) => void;
  onStructuredChange: (
    update: (content: StructuredSectionContent) => StructuredSectionContent,
  ) => void;
  /**
   * KONWERSJA „Przełącz na sekcję 2.0” (ADR-094, decyzja właściciela z grilla).
   * Podana wyłącznie dla sekcji, której typ MA silnik strukturalny, a treść go
   * jeszcze nie używa. Wstawia świeży preset POD spodem — bez zgadywania treści.
   */
  onConvert?: () => void;
  /** Otwarcie pickera zdjęcia dla ZAZNACZONEGO elementu (K3). */
  onPickImage?: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Sheet open={section !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" data-section-settings className="w-full gap-4 overflow-y-auto sm:max-w-md">
        {section ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("builder.settingsTitle", { type: t(`sectionTypes.${section.type}`) })}</SheetTitle>
              <SheetDescription>
                {structured
                  ? t("structured.drawerDescription")
                  : canvas
                    ? t("builder.canvasSettingsDescription")
                    : t("builder.settingsDescription")}
              </SheetDescription>
            </SheetHeader>
            {/*
              Szuflada jest po K1 JEDYNYM formularzem tego ekranu, więc to ona
              niesie wspólną miarę wiersza (P8). Szerokość samej szuflady jest
              dziś węższa niż miara — i dobrze: miara jest sufitem czytelności,
              a nie sposobem na rozepchnięcie panelu.

              `key` na id sekcji: formularz treści v1 trzyma pola w stanie
              klienta, więc bez remontu przełączenie szuflady na INNĄ sekcję
              pokazywałoby wartości poprzedniej.
            */}
            <FormMeasure>
              {structured ? (
                /*
                  SEKCJA STRUKTURALNA (v3, ADR-094) — szuflada JEST edytorem
                  treści: lista wpisów, pola z rejestru typu, wariant układu.
                  Na płótnie nie ma czego zaznaczać, więc nie ma tu ani ustawień
                  elementu, ani wysokości sekcji (tę niesie treść, nie geometria).
                */
                <StructuredSectionForm
                  key={section.id}
                  siteId={siteId}
                  content={structured}
                  currency={currency}
                  importSources={importSources}
                  initialTab={structuredTab}
                  onChange={onStructuredChange}
                />
              ) : canvas ? (
                <CanvasSettings
                  canvas={canvas}
                  selectedElementId={selectedElementId}
                  onChange={onCanvasChange}
                  onPickImage={onPickImage}
                  /*
                    KATALOG DO WSKAZANIA W WIĄZANIU (faza 3, ADR-163) — TA SAMA
                    lista, którą szuflada sekcji sprzętu dostaje pod `itemsPick`
                    i którą płótno rysuje w kaflach. Jedno źródło, więc pozycja
                    wskazana w wiązaniu na pewno narysuje się na podglądzie.
                  */
                  catalogProducts={
                    (importSources?.catalogProducts ?? []) as readonly StructuredPickEntry[]
                  }
                  convert={
                    onConvert && isStructuredType(section.type) ? (
                      <ConvertToStructured type={section.type} onConvert={onConvert} />
                    ) : null
                  }
                />
              ) : (
                <>
                  <SectionContentForm key={section.id} siteId={siteId} section={section} onSaved={onSaved} />
                  {onConvert && isStructuredType(section.type) ? (
                    <ConvertToStructured type={section.type} onConvert={onConvert} />
                  ) : null}
                </>
              )}
            </FormMeasure>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * ADRES PRZYCISKU — WALIDOWANY W MIEJSCU WPISANIA (ADR-166).
 *
 * Reszta pól szuflady pisze wprost do szkicu, bo każda ich wartość jest
 * z definicji poprawna (wybór ze zbioru zamkniętego albo dowolny tekst). Adres
 * jest jedynym polem elementu, którego wartość może schemat ODRZUCIĆ:
 * `linkHrefSchema` przepuszcza wyłącznie http(s), ścieżkę własną, kotwicę,
 * `mailto:` i `tel:` — bo ta wartość ląduje w atrybucie `href` na PUBLICZNEJ
 * stronie (ADR-094).
 *
 * Bez tej bramki „javascript:…" wchodziło do szkicu, autozapis dostawał od
 * serwera odmowę, a operator jej NIE WIDZIAŁ: komunikat błędu kreatora stoi pod
 * belką, czyli POD modalną nakładką szuflady. Odmowa niewidoczna jest w skutkach
 * nie do odróżnienia od cichego zapisu — dlatego komunikat stoi PRZY POLU
 * i mówi wprost, że nie zapisano.
 *
 * To NIE jest druga walidacja: to TEN SAM schemat z `@avably/core/site`, wołany
 * o krok wcześniej. Bramką pozostaje serwer (`sectionInputSchema` w akcji
 * zapisu) i to on jest granicą bezpieczeństwa — tutaj jest komunikat.
 *
 * Pole trzyma WŁASNY stan wpisywania, bo bez niego odrzucony znak nie miałby
 * się gdzie pojawić: wartość wracałaby z elementu, a operator widziałby
 * zamarłe pole bez wyjaśnienia. Resynchronizacja idzie wzorcem płótna
 * (porównanie w renderze, bez kaskady efektów) — dzięki temu „cofnij" i zmiana
 * zaznaczenia przynoszą tu wartość z modelu.
 */
function LinkField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
  onCommit: (href: string) => void;
}) {
  const t = useTranslations("site");
  const [draft, setDraft] = useState(value);
  const [syncedFrom, setSyncedFrom] = useState(value);
  if (syncedFrom !== value) {
    setSyncedFrom(value);
    setDraft(value);
  }

  const parsed = linkHrefSchema.safeParse(draft);
  // Pole opróżnione do zera nie jest błędem, tylko połową ruchu „wpisz nowy
  // adres" — tak samo, jak przy etykiecie i opisie zdjęcia.
  const rejected = draft.trim() !== "" && !parsed.success;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t("canvas.href")}</Label>
      <Input
        id={id}
        data-element-field="href"
        value={draft}
        aria-invalid={rejected || undefined}
        aria-describedby={rejected ? `${id}-error` : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const check = linkHrefSchema.safeParse(next);
          if (!check.success) return;
          setSyncedFrom(check.data);
          onCommit(check.data);
        }}
      />
      {rejected ? (
        <p id={`${id}-error`} role="alert" data-element-href-error className="text-destructive text-[13px] leading-[18px]">
          {t("canvas.hrefInvalid")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * POLE TEKSTOWE, KTÓRE DAJE SIĘ OPRÓŻNIĆ (K3, ADR-169).
 *
 * Etykieta, opis zdjęcia i treść napisu pisały wprost do szkicu z bramką
 * `if (trim() === "") return;` — czyli kasowanie ostatniego znaku było
 * ODRZUCANE, a wartość wracała z modelu w tym samym renderze. Dla operatora
 * wyglądało to na zamarłe pole: żeby przepisać treść od zera, trzeba było
 * zaznaczyć całość i nadpisać jednym ruchem. Powód bramki był słuszny (schemat
 * odrzuca pustkę), ale odpowiedzią na „tej wartości nie zapiszemy" nie może być
 * CISZA — to ta sama wada, co reszta tego ADR-a, o dwa piętra niżej.
 *
 * Odtąd pole trzyma własny stan wpisywania (wzorzec `LinkField`): pustka jest
 * dozwolonym stanem POŚREDNIM, do szkicu nie idzie, a operator czyta wprost, że
 * tak zostawionej wartości nie zapiszemy.
 */
function DraftText({
  id,
  label,
  value,
  disabled,
  rows,
  field,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  /** Liczba wierszy = pole wielolinijkowe; brak = jednolinijkowy `Input`. */
  rows?: number;
  field?: string;
  onCommit: (next: string) => void;
}) {
  const t = useTranslations("site");
  const [draft, setDraft] = useState(value);
  const [syncedFrom, setSyncedFrom] = useState(value);
  if (syncedFrom !== value) {
    setSyncedFrom(value);
    setDraft(value);
  }

  const empty = draft.trim() === "";
  const common = {
    id,
    value: draft,
    disabled,
    "data-element-field": field,
    "aria-describedby": empty ? `${id}-empty` : undefined,
    onChange: (event: { target: { value: string } }) => {
      const next = event.target.value;
      setDraft(next);
      if (next.trim() === "") return;
      setSyncedFrom(next);
      onCommit(next);
    },
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {rows ? <Textarea rows={rows} {...common} /> : <Input {...common} />}
      {empty ? (
        <p
          id={`${id}-empty`}
          role="alert"
          data-element-empty-note
          className="text-destructive text-[13px] leading-[18px]"
        >
          {t("canvas.emptyNotSaved")}
        </p>
      ) : null}
    </div>
  );
}

function CanvasSettings({
  canvas,
  selectedElementId,
  onChange,
  onPickImage,
  catalogProducts = [],
  convert,
}: {
  canvas: SectionCanvas;
  selectedElementId: string | null;
  onChange: (update: (canvas: SectionCanvas) => SectionCanvas) => void;
  onPickImage?: () => void;
  /** Pozycje katalogu do wskazania w wiązaniu (faza 3, ADR-163). */
  catalogProducts?: readonly StructuredPickEntry[];
  /** Akcja „Przełącz na sekcję 2.0” albo `null` — patrz `ConvertToStructured`. */
  convert?: ReactNode;
}) {
  const t = useTranslations("site");
  const id = useId();
  const selected = canvas.elements.find((element) => element.id === selectedElementId) ?? null;

  /*
   * Wysokość płótna nie może zejść pod najniższy element — schemat odrzuciłby
   * taki zapis („element wychodzi poza dolną krawędź"), a operator zobaczyłby
   * komunikat walidacji zamiast wyjaśnienia. Podłoga jest więc policzona
   * z treści, a nie stała.
   */
  const floor = canvas.elements.reduce(
    (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
    SECTION_MIN_ROWS,
  );

  return (
    <div data-canvas-settings className="flex flex-col gap-5">
      <Field label={t("canvas.rows")} htmlFor={`${id}-rows`}>
        <Input
          id={`${id}-rows`}
          type="number"
          inputMode="numeric"
          min={floor}
          max={SECTION_MAX_ROWS}
          value={canvas.rows}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) return;
            const rows = Math.min(SECTION_MAX_ROWS, Math.max(floor, Math.round(next)));
            onChange((current) => (current.rows === rows ? current : { ...current, rows }));
          }}
        />
      </Field>

      <Field label={t("canvas.background")} htmlFor={`${id}-bg`}>
        <PanelSelect
          id={`${id}-bg`}
          value={canvas.background}
          onValueChange={(value) =>
            onChange((current) => ({ ...current, background: value as SectionCanvas["background"] }))
          }
          options={SECTION_BACKGROUNDS.map((value) => ({
            value,
            label: t(`canvas.backgrounds.${value}`),
          }))}
        />
      </Field>

      {selected ? (
        /* `key` na elemencie: pole adresu trzyma własny stan wpisywania
           (patrz `LinkField`), więc bez remontu przełączenie zaznaczenia na
           INNY przycisk pokazywałoby adres poprzedniego — ta sama pułapka, co
           przy formularzu treści v1 wyżej. */
        <ElementSettings
          key={selected.id}
          element={selected}
          onPickImage={onPickImage}
          catalogProducts={catalogProducts}
          onChange={(update) => onChange((current) => replaceElement(current, selected.id, update))}
        />
      ) : (
        <p data-canvas-no-selection className="text-muted-foreground text-sm">
          {t("canvas.noSelection")}
        </p>
      )}

      {convert}
    </div>
  );
}

/**
 * „PRZEŁĄCZ NA SEKCJĘ 2.0" (ADR-094, decyzja właściciela z grilla 2026-08-04).
 *
 * Konwersja jest RĘCZNA i mówi to wprost. Wstawia POD spodem świeżą sekcję
 * strukturalną tego samego typu z presetem, a starą zostawia nietkniętą —
 * operator przepisuje treść i kasuje starą, kiedy skończy.
 *
 * Dlaczego bez auto-mapowania: treść spłaszczona do płótna nie niesie już
 * informacji, który napis był pytaniem, a który odpowiedzią. Zgadywanie dałoby
 * wynik poprawny czasem i cicho przestawiony resztę razy — a to jest gorsze niż
 * przepisanie trzech akapitów, bo błędu nie widać.
 *
 * Komponent jest GENERYCZNY: pokazuje się dla KAŻDEGO typu, który ma silnik
 * strukturalny (dziś FAQ, po E3–E7 dziewięć typów) — bez zmian w tym pliku.
 */
function ConvertToStructured({ type, onConvert }: { type: string; onConvert: () => void }) {
  const t = useTranslations("site");

  return (
    <div data-cms-convert={type} className="border-border flex flex-col gap-2 border-t pt-5">
      <p className="text-sm font-medium">{t("structured.convertTitle")}</p>
      <p className="text-muted-foreground text-[13px] leading-[18px]">
        {t("structured.convertBody")}
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-cms-convert-action
        className="self-start"
        onClick={onConvert}
      >
        {t("structured.convertAction")}
      </Button>
    </div>
  );
}

/**
 * Właściwości ZAZNACZONEGO elementu (K3, ADR-086): treść, wyrównanie, SKALA
 * nagłówka, KOLOR z tokenów, opis alternatywny zdjęcia i wybór ikony
 * z allowlisty.
 *
 * Szuflada jest UZUPEŁNIENIEM edycji w miejscu, nie jej substytutem: tekst
 * poprawia się klikając w niego na płótnie, a tutaj siedzi to, czego nie da
 * się pokazać w samej treści — role, skale i wybory ze zbiorów zamkniętych.
 * Ani rozmiar fontu, ani kolor NIE są tu liczbą: operator wybiera pozycję ze
 * skali szablonu i rolę z motywu, więc zmiana jednego albo drugiego przestawia
 * stronę razem z nimi.
 */
function ElementSettings({
  element,
  onChange,
  onPickImage,
  catalogProducts = [],
}: {
  element: CanvasElement;
  onChange: (update: (element: CanvasElement) => CanvasElement) => void;
  onPickImage?: () => void;
  catalogProducts?: readonly StructuredPickEntry[];
}) {
  const t = useTranslations("site");
  const id = useId();

  function patch(changes: Partial<CanvasElement>) {
    onChange((current) => ({ ...current, ...changes }) as CanvasElement);
  }

  const size = sizeOf(element);
  /*
   * WIĄZALNE ATRYBUTY BIORĄ SIĘ Z REJESTRU RDZENIA, nie z `if`-a po rodzaju
   * elementu (faza 3, ADR-163). Dzięki temu poszerzenie zamkniętej listy jest
   * jedną linią w `BINDABLE_ATTRIBUTES` i zero linii tutaj — a atrybut, którego
   * na liście NIE MA, nie dostaje kontrolki, więc operator nie ma jak zapisać
   * wiązania, którego schemat i tak by nie przyjął.
   */
  const bindable = bindableAttributesOf(element.kind);
  /** Czy pole statyczne tego atrybutu jest zablokowane wartością z katalogu. */
  const bound = (attribute: string) => isBoundAttribute(element, attribute);

  return (
    <div data-element-settings={element.kind} className="border-border flex flex-col gap-5 border-t pt-5">
      <p className="text-sm font-medium">{t(`elementKinds.${element.kind}`)}</p>

      {/*
        POWRÓT WYMIARU DO TREŚCI (K4, ADR-088, decyzja właściciela).
        Pociągnięcie za uchwyt ustawia wymiar JAWNY i to jest właściwy domyślny
        kierunek — tu jest droga z powrotem. Przycisk pokazuje się wyłącznie
        wtedy, gdy jest co przywracać: wymiar już objęty treścią nie ma czego
        obejmować drugi raz.
      */}
      {supportsHug(element.kind) && (size.w === "fixed" || size.h === "fixed") ? (
        <div className="flex flex-wrap gap-2">
          {size.w === "fixed" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-element-hug="w"
              onClick={() => onChange((current) => withSize(current, { ...size, w: "hug" }))}
            >
              {t("canvas.hugWidth")}
            </Button>
          ) : null}
          {size.h === "fixed" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-element-hug="h"
              onClick={() => onChange((current) => withSize(current, { ...size, h: "hug" }))}
            >
              {t("canvas.hugHeight")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {element.kind === "heading" || element.kind === "text" ? (
        <DraftText
          id={`${id}-text`}
          label={t("canvas.text")}
          rows={element.kind === "text" ? 5 : 2}
          value={element.text}
          /*
            POLE ZWIĄZANE JEST NIEEDYTOWALNE (faza 3, ADR-163). Kreator nie
            jest panelem danych: gdyby napis dało się tu poprawić mimo
            wiązania, operator zmieniałby treść, której render i tak nie
            pokaże — i uczyłby się, że kreator czasem zapisuje w próżnię.
          */
          disabled={bound("text")}
          onCommit={(text) => patch({ text } as Partial<CanvasElement>)}
        />
      ) : null}

      {element.kind === "button" ? (
        <>
          <DraftText
            id={`${id}-label`}
            label={t("canvas.label")}
            field="label"
            value={element.label}
            disabled={bound("label")}
            onCommit={(label) => patch({ label } as Partial<CanvasElement>)}
          />
          <LinkField
            id={`${id}-href`}
            value={element.href}
            onCommit={(href) => patch({ href } as Partial<CanvasElement>)}
          />
          {/* WYGLĄD PRZYCISKU — pole modelu od K2 (`BUTTON_VARIANTS`), które do
              ADR-166 nie miało ani jednej kontrolki: każdy przycisk wstawiony
              z palety zostawał wypełniony na zawsze, chociaż render zna też
              wariant obrysowany. */}
          <Field label={t("canvas.buttonStyle")} htmlFor={`${id}-button-style`}>
            <PanelSelect
              id={`${id}-button-style`}
              value={element.variant}
              onValueChange={(value) =>
                patch({ variant: value as (typeof BUTTON_VARIANTS)[number] } as Partial<CanvasElement>)
              }
              options={BUTTON_VARIANTS.map((value) => ({
                value,
                label: t(`canvas.buttonStyles.${value}`),
              }))}
            />
          </Field>
        </>
      ) : null}

      {element.kind === "image" ? (
        <>
          <DraftText
            id={`${id}-alt`}
            label={t("canvas.alt")}
            value={element.alt}
            /*
              ZWIĄZANE ZDJĘCIE NIESIE WŁASNY OPIS. Wiązanie oddaje parę „adres
              + opis alternatywny", więc opis wpisany tutaj opisywałby zdjęcie,
              którego na tym elemencie już nie ma.
            */
            disabled={bound("source")}
            /* Opis alternatywny jest WYMAGANY przez schemat (dostępność), więc
               pustki nie zapisujemy — ale mówimy o tym wprost. */
            onCommit={(alt) => patch({ alt } as Partial<CanvasElement>)}
          />
          {/* KADROWANIE — pole modelu `IMAGE_FITS` bez kontrolki do ADR-166.
              Różnica jest widoczna od razu (przycięcie kontra całe zdjęcie
              w pudełku), więc jej brak zmuszał do dobierania geometrii pod
              proporcje pliku. */}
          <Field label={t("canvas.fit")} htmlFor={`${id}-fit`}>
            <PanelSelect
              id={`${id}-fit`}
              value={element.fit}
              onValueChange={(value) =>
                patch({ fit: value as (typeof IMAGE_FITS)[number] } as Partial<CanvasElement>)
              }
              options={IMAGE_FITS.map((value) => ({ value, label: t(`canvas.fits.${value}`) }))}
            />
          </Field>
          {onPickImage && !bound("source") ? (
            <Button type="button" size="sm" variant="secondary" data-element-image-pick onClick={onPickImage}>
              {t("canvas.changeImage")}
            </Button>
          ) : null}
        </>
      ) : null}

      {/*
        WIĄZANIA ATRYBUTÓW (faza 3, ADR-163) — na dole szuflady, bo odpowiadają
        na pytanie „skąd wartość", a nie „jak wygląda". Pytanie o wygląd zadaje
        się przy każdej edycji, o źródło — raz.
      */}
      {bindable.map(({ attribute, value }) => (
        <AttributeBinding
          key={attribute}
          attribute={attribute}
          valueKind={value}
          binding={bindingOf(element, attribute)}
          catalogProducts={catalogProducts}
          onChange={(next) => onChange((current) => withBinding(current, attribute, next))}
        />
      ))}

      {element.kind === "icon" ? (
        <>
          <Field label={t("canvas.icon")} htmlFor={`${id}-icon`}>
            {/* Wybór z ALLOWLISTY (ADR-082) — treść tenanta nie może wskazać
                symbolu, którego render nie zna. */}
            <PanelSelect
              id={`${id}-icon`}
              value={element.name}
              onValueChange={(value) => patch({ name: value } as Partial<CanvasElement>)}
              options={ELEMENT_ICONS.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label={t("canvas.tone")} htmlFor={`${id}-tone`}>
            {/* Ton z MOTYWU, nie kolor — `ICON_TONES` istnieje w modelu od K3
                i przechodzi ze zmianą motywu razem ze stroną. */}
            <PanelSelect
              id={`${id}-tone`}
              value={element.tone}
              onValueChange={(value) =>
                patch({ tone: value as (typeof ICON_TONES)[number] } as Partial<CanvasElement>)
              }
              options={ICON_TONES.map((value) => ({ value, label: t(`canvas.tones.${value}`) }))}
            />
          </Field>
        </>
      ) : null}

      {/*
        KSZTAŁT (ADR-166) — jedyny rodzaj z palety, który do tej pory nie miał
        w szufladzie ANI JEDNEGO pola, chociaż jego model niesie dwa: rodzaj
        (`SHAPE_KINDS`) i wypełnienie (`SHAPE_FILLS`). Bez nich kształt wstawiony
        z palety zostawał na zawsze jasnym prostokątem, a welon pod tekstem na
        zdjęciu — ten, dla którego kontrast liczy bramka motywu (ADR-090) — był
        nieosiągalny z interfejsu.

        Wypełnienie pokazuje się WYŁĄCZNIE dla prostokąta, bo render linii go
        nie czyta (patrz `element-canvas.tsx`): kontrolka bez skutku uczy, że
        ustawienia kłamią.
      */}
      {element.kind === "shape" ? (
        <>
          <Field label={t("canvas.shape")} htmlFor={`${id}-shape`}>
            <PanelSelect
              id={`${id}-shape`}
              value={element.shape}
              onValueChange={(value) =>
                patch({ shape: value as (typeof SHAPE_KINDS)[number] } as Partial<CanvasElement>)
              }
              options={SHAPE_KINDS.map((value) => ({ value, label: t(`canvas.shapes.${value}`) }))}
            />
          </Field>
          {element.shape === "box" ? (
            <Field label={t("canvas.fill")} htmlFor={`${id}-fill`}>
              <PanelSelect
                id={`${id}-fill`}
                value={element.fill}
                onValueChange={(value) =>
                  patch({ fill: value as (typeof SHAPE_FILLS)[number] } as Partial<CanvasElement>)
                }
                options={SHAPE_FILLS.map((value) => ({ value, label: t(`canvas.fills.${value}`) }))}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {element.kind === "heading" ? (
        <Field label={t("canvas.level")} htmlFor={`${id}-level`}>
          {/* Wielkość nagłówka to SKALA szablonu, nie liczba pikseli — trzy
              poziomy mapują się na `landing-display`, nagłówek sekcji i tytuł
              bloku, więc zmiana szablonu przestawia je razem ze stroną. */}
          <PanelSelect
            id={`${id}-level`}
            value={String(element.level)}
            onValueChange={(value) => patch({ level: Number(value) as 1 | 2 | 3 } as Partial<CanvasElement>)}
            options={HEADING_LEVELS.map((value) => ({
              value: String(value),
              label: t(`canvas.levels.${value}`),
            }))}
          />
        </Field>
      ) : null}

      {element.kind === "heading" || element.kind === "text" ? (
        <Field label={t("canvas.color")} htmlFor={`${id}-color`}>
          {/* Kolor z TOKENÓW motywu (ADR-086) — dowolny odcień zamroziłby jedną
              wartość na zawsze i rozjechał kontrast po zmianie motywu. */}
          <PanelSelect
            id={`${id}-color`}
            value={element.color ?? "default"}
            onValueChange={(value) =>
              patch({ color: value as (typeof ELEMENT_COLORS)[number] } as Partial<CanvasElement>)
            }
            options={ELEMENT_COLORS.map((value) => ({ value, label: t(`canvas.colors.${value}`) }))}
          />
        </Field>
      ) : null}

      {element.kind === "text" ? (
        <Field label={t("canvas.variant")} htmlFor={`${id}-variant`}>
          <PanelSelect
            id={`${id}-variant`}
            value={element.variant}
            onValueChange={(value) =>
              patch({ variant: value as (typeof TEXT_VARIANTS)[number] } as Partial<CanvasElement>)
            }
            options={TEXT_VARIANTS.map((value) => ({ value, label: t(`canvas.variants.${value}`) }))}
          />
        </Field>
      ) : null}

      {element.kind === "heading" || element.kind === "text" || element.kind === "button" ? (
        <Field label={t("canvas.align")} htmlFor={`${id}-align`}>
          <PanelSelect
            id={`${id}-align`}
            value={element.align}
            onValueChange={(value) =>
              patch({ align: value as (typeof ELEMENT_ALIGNMENTS)[number] } as Partial<CanvasElement>)
            }
            options={ELEMENT_ALIGNMENTS.map((value) => ({
              value,
              label: t(`canvas.alignments.${value}`),
            }))}
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * ZAPIS WIĄZANIA W ELEMENCIE — bez mutacji wejścia.
 *
 * Mapa `bindings` ZNIKA, gdy zostanie pusta: element bez wiązań ma być
 * dokładnie tym, czym był przed fazą 3, także w bajtach zapisanej treści.
 * Pusty obiekt `{}` przeszedłby schemat i wyglądałby w bazie jak „coś tu było",
 * a różnicy nie widać ani w kreatorze, ani w sklepie.
 */
export function withBinding(
  element: CanvasElement,
  attribute: string,
  binding: ElementBinding | undefined,
): CanvasElement {
  const current = { ...((element as { bindings?: Record<string, unknown> }).bindings ?? {}) };
  if (binding) current[attribute] = binding;
  else delete current[attribute];
  const bindings = Object.keys(current).length > 0 ? current : undefined;
  return { ...element, bindings } as CanvasElement;
}

/**
 * ŹRÓDŁO WARTOŚCI JEDNEGO ATRYBUTU (faza 3, ADR-163).
 *
 * ==================== DLACZEGO LISTA PÓL JEST ZAWĘŻONA TYPEM ====================
 *
 * Operator wybiera pole sprzętu z listy, na której stoją WYŁĄCZNIE pola
 * oddające wartość w typie, którego ten atrybut oczekuje — cena nie pojawia się
 * przy źródle zdjęcia, a zdjęcie przy nagłówku. To nie jest wygoda: to jest
 * lustro schematu (`bindingSchemaFor` w rdzeniu), który wiązania niezgodnego
 * typem po prostu nie parsuje. Interfejs nie ma prawa proponować czegoś, czego
 * serwer odmówi — pusty komunikat walidacji przy zapisie strony byłby dla
 * operatora zagadką.
 *
 * ==================== DLACZEGO WARTOŚĆ ZASTĘPCZA BYWA NIEDOSTĘPNA ====================
 *
 * Bo pole, które w katalogu jest ZAWSZE wypełnione, nie ma stanu pustego —
 * a napis „na wszelki wypadek" wpisany pod cenę byłby drugim źródłem prawdy
 * o cenie, czyli dokładnie tą klasą błędu, którą ta faza zamyka.
 */
function AttributeBinding({
  attribute,
  valueKind,
  binding,
  catalogProducts,
  onChange,
}: {
  attribute: string;
  valueKind: BindingValueKind;
  binding: ElementBinding | undefined;
  catalogProducts: readonly StructuredPickEntry[];
  onChange: (binding: ElementBinding | undefined) => void;
}) {
  const t = useTranslations("site");
  const id = useId();
  const fields = productBindingFieldsOf(valueKind);
  const optionalField = binding ? PRODUCT_BINDING_FIELDS[binding.field].optional : false;

  /*
   * BEZ ANI JEDNEJ POZYCJI W KATALOGU nie ma czego wskazać — i to jest zdanie
   * ZAMIAST kontrolki, a nie pusta lista. Pusta lista wygląda jak awaria
   * szuflady, a operator ma się dowiedzieć, gdzie sprzęt założyć (ta sama
   * zasada, co `fieldEmpty` w mini-CMS-ie, ADR-154).
   */
  if (catalogProducts.length === 0 && !binding) {
    return (
      <div data-element-binding={attribute} className="border-border flex flex-col gap-2 border-t pt-5">
        <p className="text-sm font-medium">{t(`canvas.bindings.attributes.${attribute}`)}</p>
        <p data-binding-empty className="text-muted-foreground text-[13px] leading-[18px]">
          {t("canvas.bindings.noProducts")}
        </p>
      </div>
    );
  }

  const firstProduct = catalogProducts[0]?.value;

  return (
    <div data-element-binding={attribute} className="border-border flex flex-col gap-3 border-t pt-5">
      <p className="text-sm font-medium">{t(`canvas.bindings.attributes.${attribute}`)}</p>

      <Field label={t("canvas.bindings.source")} htmlFor={`${id}-source`}>
        <PanelSelect
          id={`${id}-source`}
          value={binding ? "product" : "static"}
          onValueChange={(value) => {
            if (value === "static") {
              onChange(undefined);
              return;
            }
            if (binding || !firstProduct) return;
            /*
              ŚWIEŻE WIĄZANIE CELUJE W PIERWSZĄ POZYCJĘ I PIERWSZE POLE ZGODNE
              TYPEM — czyli w stan, który od razu coś pokazuje. Wiązanie
              „puste" (bez pozycji) nie przeszłoby schematu, więc szuflada
              musiałaby trzymać własny stan pośredni i pilnować, żeby nie
              zapisał się do treści.
            */
            onChange({
              record: { kind: "product", productId: firstProduct },
              field: fields[0] as ProductBindingField,
              whenEmpty: "hide",
            });
          }}
          options={[
            { value: "static", label: t("canvas.bindings.sources.static") },
            { value: "product", label: t("canvas.bindings.sources.product") },
          ]}
        />
      </Field>

      {binding ? (
        <>
          <Field label={t("canvas.bindings.product")} htmlFor={`${id}-product`}>
            <PanelSelect
              id={`${id}-product`}
              value={binding.record.kind === "product" ? binding.record.productId : ""}
              onValueChange={(value) =>
                onChange({ ...binding, record: { kind: "product", productId: value } })
              }
              options={catalogProducts.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>

          <Field label={t("canvas.bindings.field")} htmlFor={`${id}-field`}>
            <PanelSelect
              id={`${id}-field`}
              value={binding.field}
              onValueChange={(value) => {
                const field = value as ProductBindingField;
                /*
                  ZMIANA POLA ZDEJMUJE WARTOŚĆ ZASTĘPCZĄ, gdy nowe pole nie ma
                  stanu pustego. Bez tego przełączenie „opis" → „cena"
                  zostawiałoby w treści napis, którego schemat nie przyjmie —
                  a operator zobaczyłby błąd zapisu strony bez związku z tym,
                  co przed chwilą kliknął.
                */
                const keeps = PRODUCT_BINDING_FIELDS[field].optional;
                onChange(
                  keeps
                    ? { ...binding, field }
                    : { record: binding.record, field, whenEmpty: "hide" },
                );
              }}
              options={fields.map((field) => ({
                value: field,
                label: t(`canvas.bindings.fields.${field}`),
              }))}
            />
          </Field>

          {/*
            ZACHOWANIE PRZY PUSTCE pokazuje się WYŁĄCZNIE dla pól, które w
            katalogu bywają puste — patrz nagłówek komponentu.
          */}
          {valueKind === "text" && optionalField ? (
            <>
              <Field label={t("canvas.bindings.whenEmpty")} htmlFor={`${id}-empty`}>
                <PanelSelect
                  id={`${id}-empty`}
                  value={binding.whenEmpty}
                  onValueChange={(value) =>
                    onChange(
                      value === "fallback"
                        ? { ...binding, whenEmpty: "fallback", fallback: binding.fallback ?? "—" }
                        : { record: binding.record, field: binding.field, whenEmpty: "hide" },
                    )
                  }
                  options={BINDING_EMPTY_MODES.map((mode) => ({
                    value: mode,
                    label: t(`canvas.bindings.emptyModes.${mode}`),
                  }))}
                />
              </Field>
              {binding.whenEmpty === "fallback" ? (
                <Field label={t("canvas.bindings.fallback")} htmlFor={`${id}-fallback`}>
                  <Input
                    id={`${id}-fallback`}
                    value={binding.fallback ?? ""}
                    onChange={(event) => {
                      // Pusty napis nie przejdzie schematu przy tym zachowaniu —
                      // nie zapisujemy go, zamiast pokazywać błąd przy każdym
                      // skasowanym znaku (ta sama reguła, co przy treści).
                      if (event.target.value.trim() === "") return;
                      onChange({ ...binding, fallback: event.target.value });
                    }}
                  />
                </Field>
              ) : null}
            </>
          ) : null}

          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("canvas.bindings.note")}
          </p>
        </>
      ) : null}
    </div>
  );
}

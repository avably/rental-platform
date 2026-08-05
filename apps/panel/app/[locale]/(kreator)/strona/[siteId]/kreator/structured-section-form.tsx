"use client";

/**
 * MINI-CMS SEKCJI STRUKTURALNEJ (E1, ADR-094; typ medialny — E3) — framework,
 * nie formularz konkretnego typu.
 *
 * ==================== CO TU JEST FRAMEWORKIEM ====================
 *
 * Ten plik nie zna słowa „pytanie" ani słowa „galeria". Wie tylko, że sekcja
 * strukturalna ma: WARIANT UKŁADU, PAS motywu, opcjonalny nagłówek, LISTĘ
 * WPISÓW o polach opisanych w rejestrze (`itemFields`), zestaw PRZEŁĄCZNIKÓW
 * (`toggles`) i zestaw WYBORÓW wyglądu (`choices`). Wszystko, co odróżnia FAQ
 * od galerii, siedzi w `STRUCTURED_SECTIONS` (@avably/core/site) — więc kolejny
 * typ dostaje ten ekran bez ani jednej linii tutaj. Etykiety idą z i18n po
 * kluczu `structured.<typ>.…`, żeby dane rejestru zostały danymi.
 *
 * ==================== PIĘĆ DECYZJI, KTÓRE WIDAĆ ====================
 *
 *   1. PRZEŁĄCZNIK UKŁADU NIE DOTYKA DANYCH. Przechodzi przez
 *      `withStructuredLayout`, którego jedyne zadanie to zmienić JEDNO pole —
 *      kontrakt bezstratności (`layout A → B → A` = ta sama treść) jest
 *      zamknięty w rdzeniu i ma tam własny test.
 *   2. USUNIĘCIE WPISU PYTA. Wpisu nie da się cofnąć jednym klawiszem (historia
 *      kreatora cofa, ale operator o tym nie wie w chwili kliknięcia w kosz),
 *      a skasowana praca to skasowana praca.
 *   3. KOLEJNOŚĆ MA DWIE DROGI: uchwyt do przeciągania i strzałki. Samo
 *      przeciąganie zamyka tę funkcję przed klawiaturą (WCAG 2.5.7), a same
 *      strzałki są wolne przy dłuższej liście.
 *   4. SZUFLADA TYPU MEDIALNEGO JEST DWUDZIELNA (E3, `editor: "split"`).
 *      Zarządzanie zdjęciami i wygląd galerii to dwie różne prace — jedna
 *      ściana pól, w której suwak odstępu stoi między dwunastym a trzynastym
 *      zdjęciem, przestaje być czytelna przy pierwszej realnej galerii.
 *      Typ tekstowy (FAQ) zostaje jednokolumnowy: dzielenie czterech pól na
 *      dwie zakładki dokładałoby klik bez żadnej korzyści.
 *   5. PUSTKA ZNACZY TO, CO DEKLARUJE REJESTR (`empty`). Pusty opis
 *      alternatywny jest DECYZJĄ („zdjęcie dekoracyjne", `alt=""`), pusty
 *      podpis ZDEJMUJE pole opcjonalne, a pusta odpowiedź FAQ nie zapisuje się
 *      wcale. Rozgałęzienie idzie po deklaracji, nie po nazwie pola.
 *
 * Zapis idzie SZKICEM edytora (historia + autozapis), jak płótno — bez własnego
 * przycisku „Zapisz" i bez drugiego wskaźnika stanu.
 */
import {
  appendStructuredItem,
  moveStructuredItem,
  patchStructuredField,
  patchStructuredItem,
  removeStructuredItem,
  structuredNewItemFor,
  structuredSpecOf,
  withStructuredLayout,
  SECTION_BACKGROUNDS,
  type ImageSource,
  type StructuredFieldSpec,
  type StructuredSectionContent,
  type StructuredSectionType,
} from "@avably/core/site";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FileField,
  Input,
  Label,
  Textarea,
} from "@avably/ui";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, MapPin, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  finalizeSiteImageUploadAction,
  prepareSiteImageUploadAction,
} from "@/app/[locale]/(panel)/strona/upload-actions";
import {
  runSiteImageUpload,
  uploadSiteImageToSignedUrl,
} from "@/app/[locale]/(panel)/strona/upload-flow";
import { PanelSelect } from "@/components/fields/panel-select";
import { siteImagePublicBase } from "@/lib/site-image-base";

type Update = (content: StructuredSectionContent) => StructuredSectionContent;

/** Wpisy treści — każdy typ strukturalny jest listowy (kontrakt rejestru). */
function itemsOf(content: StructuredSectionContent): Record<string, unknown>[] {
  return (content as unknown as { items: Record<string, unknown>[] }).items;
}

/** Zakładki szuflady dwudzielnej. Nazwy niosą i18n per typ. */
type FormTab = "items" | "appearance";

/**
 * CO ZAPISAĆ ZA PUSTE POLE — JEDNA reguła dla pól wpisu i pól sekcji (E4).
 *
 * `null` znaczy „nie zapisuj nic" (E1: pytanie bez treści nie jest pytaniem,
 * a błąd walidacji przy każdym skasowanym znaku jest gorszy niż brak zapisu).
 * Reguła stoi w jednym miejscu, bo jest jedna — dwie kopie rozjechałyby się
 * przy pierwszym typie, który dostanie i pole wpisu, i pole sekcji.
 */
function valueToWrite(field: StructuredFieldSpec, raw: string): { value: string | undefined } | null {
  if (raw.trim() !== "") return { value: raw };
  if (field.empty === "value") return { value: "" };
  if (field.empty === "unset") return { value: undefined };
  return null;
}

/** Zapis pola CAŁEJ SEKCJI zgodnie z deklaracją pustki. */
function writeField(
  content: StructuredSectionContent,
  field: StructuredFieldSpec,
  raw: string,
): StructuredSectionContent {
  const decision = valueToWrite(field, raw);
  return decision ? patchStructuredField(content, field.key, decision.value) : content;
}

export function StructuredSectionForm({
  siteId,
  content,
  importSources,
  onChange,
  onConvertHint,
}: {
  siteId: string;
  content: StructuredSectionContent;
  /**
   * WPISY DO SKOPIOWANIA Z INNYCH MODUŁÓW PANELU (E5, ADR-096), po nazwie
   * źródła z rejestru (`itemsImport`). Framework nie wie, skąd się biorą ani co
   * znaczą — dostaje je już w kształcie wpisu tego typu, bo mapowanie wiersza
   * bazy na treść sekcji jest wiedzą TRASY, a nie szuflady.
   *
   * Klucz zamiast gołej tablicy, żeby drugi typ z importem (cennik z katalogu?)
   * nie dostał przypadkiem cudzych danych — host podaje komplet źródeł, a
   * rejestr rozstrzyga, które z nich należy do tego typu.
   */
  importSources?: Record<string, readonly unknown[]>;
  onChange: (update: Update) => void;
  /** Miejsce na komunikat/akcję spoza mini-CMS (np. konwersja) — opcjonalne. */
  onConvertHint?: React.ReactNode;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const id = useId();
  const type = content.type as StructuredSectionType;
  const spec = structuredSpecOf(type);
  const items = itemsOf(content);
  const [tab, setTab] = useState<FormTab>("items");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /*
   * Identyfikator wpisu dla przeciągania. Wpisy NIE MAJĄ własnego id w treści
   * (i nie powinny — to dane najemcy, nie encje), więc kluczem jest POZYCJA.
   * Wystarcza, bo lista przebudowuje się przy każdej zmianie kolejności,
   * a `dnd-kit` potrzebuje stabilności wyłącznie na czas jednego gestu.
   */
  const ids = items.map((_, index) => `${id}-item-${index}`);

  function handleDragEnd(event: DragEndEvent) {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    onChange((current) => moveStructuredItem(current, from, to));
  }

  /** Świeży wpis albo `undefined` — typ medialny rodzi wpisy z wgrania pliku. */
  const freshItem = structuredNewItemFor(type, locale);
  /** Pole obrazowe wpisu (jest ich najwyżej jedno) — wejście multi-uploadu. */
  const mediaField = spec.itemFields.find((field) => field.kind === "image");

  const wyglad = (
    <div className="flex flex-col gap-5">
      {/* WARIANT UKŁADU — zmiana wyglądu, która nie rusza ani jednego wpisu. */}
      <Field label={t("structured.layout")} htmlFor={`${id}-layout`}>
        <PanelSelect
          id={`${id}-layout`}
          value={content.layout}
          onValueChange={(value) => onChange((current) => withStructuredLayout(current, value))}
          options={spec.layouts.map((layout) => ({
            value: layout,
            label: t(`structured.${type}.layouts.${layout}`),
          }))}
        />
      </Field>

      <Field label={t("canvas.background")} htmlFor={`${id}-bg`}>
        <PanelSelect
          id={`${id}-bg`}
          value={content.background}
          onValueChange={(value) =>
            onChange((current) => ({ ...current, background: value }) as StructuredSectionContent)
          }
          options={SECTION_BACKGROUNDS.map((value) => ({
            value,
            label: t(`canvas.backgrounds.${value}`),
          }))}
        />
      </Field>

      <Field label={t("structured.heading")} htmlFor={`${id}-heading`}>
        <Input
          id={`${id}-heading`}
          value={content.heading ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange(
              (current) =>
                ({
                  ...current,
                  // Nagłówek jest OPCJONALNY — pusty znaczy „bez nagłówka",
                  // a nie „pusty napis", którego schemat i tak by nie przyjął.
                  heading: value.trim() === "" ? undefined : value,
                }) as StructuredSectionContent,
            );
          }}
        />
      </Field>

      {/*
        POLA CAŁEJ SEKCJI (E4, `fields` w rejestrze) — np. odnośnik do polityki
        prywatności pod formularzem kontaktu. Stoją przy nagłówku, bo są tym
        samym rodzajem ustawienia: dotyczą SEKCJI, a nie pojedynczego wpisu.
        Pustka znaczy to, co deklaruje rejestr (`empty`) — ta sama reguła, co
        w polach wpisu, i ta sama funkcja, która ją stosuje.
      */}
      {(spec.fields ?? []).map((field) => (
        <Field
          key={field.key}
          label={t(`structured.${type}.fields.${field.key}`)}
          htmlFor={`${id}-${field.key}`}
        >
          <Input
            id={`${id}-${field.key}`}
            data-cms-section-field={field.key}
            value={
              typeof (content as unknown as Record<string, unknown>)[field.key] === "string"
                ? ((content as unknown as Record<string, unknown>)[field.key] as string)
                : ""
            }
            onChange={(event) => {
              const raw = event.target.value;
              onChange((current) => writeField(current, field, raw));
            }}
          />
        </Field>
      ))}

      {/*
        WYBORY WYGLĄDU pokazujemy WYŁĄCZNIE przy układach, w których coś znaczą
        (`choice.layouts`). Kontrolka bez skutku — liczba kafli w rzędzie przy
        karuzeli — uczy operatora, że ustawienia sekcji bywają ozdobą.
      */}
      {spec.choices
        .filter((choice) => !choice.layouts || choice.layouts.includes(content.layout))
        .map((choice) => (
          <Field
            key={choice.key}
            label={t(`structured.${type}.choices.${choice.key}`)}
            htmlFor={`${id}-${choice.key}`}
          >
            <PanelSelect
              id={`${id}-${choice.key}`}
              value={String((content as unknown as Record<string, unknown>)[choice.key])}
              onValueChange={(picked) => {
                // Wartość wraca do treści w SWOIM typie (liczba zostaje liczbą) —
                // rejestr niesie oryginały, więc nie zgadujemy po kształcie napisu.
                const value = choice.values.find((candidate) => String(candidate) === picked);
                if (value === undefined) return;
                onChange(
                  (current) =>
                    ({ ...current, [choice.key]: value }) as unknown as StructuredSectionContent,
                );
              }}
              options={choice.values.map((value) => ({
                value: String(value),
                label: t(`structured.${type}.choiceValues.${choice.key}.${value}`),
              }))}
            />
          </Field>
        ))}

      {spec.toggles.map((toggle) => (
        <label
          key={toggle.key}
          data-cms-toggle={toggle.key}
          className="flex items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            className="size-4"
            checked={Boolean((content as unknown as Record<string, unknown>)[toggle.key])}
            onChange={(event) =>
              onChange(
                (current) =>
                  ({ ...current, [toggle.key]: event.target.checked }) as StructuredSectionContent,
              )
            }
          />
          {t(`structured.${type}.toggles.${toggle.key}`)}
        </label>
      ))}
    </div>
  );

  const lista = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t(`structured.${type}.itemsTitle`)}</p>
        <span data-cms-count className="text-muted-foreground text-xs">
          {items.length} / {spec.maxItems}
        </span>
      </div>

      {mediaField ? (
        <MediaUpload
          siteId={siteId}
          type={type}
          field={mediaField}
          full={items.length >= spec.maxItems}
          onAdd={(sources) =>
            onChange((current) =>
              sources.reduce(
                (draft, source) =>
                  appendStructuredItem(draft, { [mediaField.key]: source, alt: "" }),
                current,
              ),
            )
          }
        />
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex list-none flex-col gap-3 p-0">
            {items.map((item, index) => (
              <ItemRow
                key={ids[index]}
                sortableId={ids[index]!}
                index={index}
                total={items.length}
                type={type}
                item={item}
                canRemove={items.length > spec.minItems}
                onPatch={(key, value) =>
                  onChange((current) => patchStructuredItem(current, index, key, value))
                }
                onMove={(direction) =>
                  onChange((current) => moveStructuredItem(current, index, index + direction))
                }
                onRemove={() => onChange((current) => removeStructuredItem(current, index))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/*
        Przycisk „dodaj wpis" istnieje WYŁĄCZNIE tam, gdzie rejestr umie podać
        świeży wpis. Przy typie medialnym pusty kafel bez zdjęcia nie przeszedłby
        schematu, więc przycisk obiecywałby operację kończącą się błędem.
      */}
      {freshItem !== undefined ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-cms-add
          disabled={items.length >= spec.maxItems}
          onClick={() => onChange((current) => appendStructuredItem(current, freshItem))}
        >
          <Plus className="size-4" aria-hidden />
          {t(`structured.${type}.addItem`)}
        </Button>
      ) : null}

      {/*
        KOPIOWANIE WPISÓW Z INNEGO MODUŁU (E5) — przycisk istnieje wyłącznie
        tam, gdzie REJESTR wskazał źródło (`itemsImport`), tak samo jak przycisk
        „dodaj wpis" istnieje tam, gdzie rejestr umie podać świeży wpis.
      */}
      {spec.itemsImport ? (
        <ImportItems
          type={type}
          entries={importSources?.[spec.itemsImport] ?? []}
          items={items}
          room={spec.maxItems - items.length}
          onImport={(fresh) =>
            onChange((current) =>
              fresh.reduce<StructuredSectionContent>(
                (draft, entry) => appendStructuredItem(draft, entry),
                current,
              ),
            )
          }
        />
      ) : null}
    </div>
  );

  if (spec.editor === "single") {
    return (
      <div data-cms-form={type} className="flex flex-col gap-5">
        {wyglad}
        <div className="border-border border-t pt-5">{lista}</div>
        {onConvertHint}
      </div>
    );
  }

  return (
    <div data-cms-form={type} className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label={t(`structured.${type}.itemsTitle`)}
        data-cms-tabs
        className="border-border flex gap-1 rounded-md border p-1"
      >
        {(["items", "appearance"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            data-cms-tab={value}
            onClick={() => setTab(value)}
            className={`focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex-1 cursor-pointer rounded-sm border border-transparent px-3 py-1.5 text-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
              tab === value
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`structured.${type}.tabs.${value}`)}
          </button>
        ))}
      </div>

      {tab === "items" ? lista : wyglad}
      {onConvertHint}
    </div>
  );
}

/**
 * ODCISK WPISU — do rozpoznania, czy taki sam już w sekcji jest.
 *
 * Liczony z DANYCH, bez wiedzy o typie: klucze sortujemy (jsonb w bazie i tak
 * nie zachowuje ich kolejności, więc porównanie po surowym `JSON.stringify`
 * rozjeżdżałoby się po pierwszym przeładowaniu strony), a puste wartości
 * pomijamy — pole zdjęte i pole puste znaczą tu to samo „nie ma".
 */
function entryFingerprint(entry: unknown): string {
  if (typeof entry !== "object" || entry === null) return JSON.stringify(entry);
  const pairs = Object.entries(entry as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(pairs);
}

/**
 * „WSTAW Z PUNKTÓW ODBIORU" (E5, ADR-096) — KOPIA, NIE SPRZĘŻENIE.
 *
 * ==================== DLACZEGO KOPIA ====================
 *
 * Kusi wyświetlać punkty odbioru na stronie na żywo („zmień w Dostawach, zmieni
 * się na stronie"). Odpada z dwóch powodów, i oba są o tym, czyja to jest
 * strona: (1) publikacja przestałaby być momentem, w którym operator decyduje,
 * co widzi klient — zmiana ustawienia logistycznego przestawiałaby OPUBLIKOWANĄ
 * treść bez publikacji; (2) punkt odbioru ma nazwę roboczą („magazyn 2"), której
 * najemca nie chce na stronie, a nie da się jej zmienić, nie zmieniając nazwy
 * w module dostaw. Po skopiowaniu treść należy do sekcji i tam się ją edytuje.
 *
 * ==================== DLACZEGO ODSIEWAMY POWTÓRKI ====================
 *
 * Drugie kliknięcie ma nie dokładać tych samych punktów jeszcze raz — a że wpis
 * po skopiowaniu wolno edytować, odsiew działa DOPÓKI wpis jest kopią. Punkt
 * z ręcznie zmienioną nazwą wejdzie ponownie i to jest w porządku: sekcja jest
 * właścicielem swojej treści, więc dwa podobne wpisy są decyzją operatora, a nie
 * błędem, który mielibyśmy zgadywać.
 */
function ImportItems({
  type,
  entries,
  items,
  room,
  onImport,
}: {
  type: StructuredSectionType;
  entries: readonly unknown[];
  items: Record<string, unknown>[];
  room: number;
  onImport: (fresh: unknown[]) => void;
}) {
  const t = useTranslations("site");
  const hintId = useId();

  const known = new Set(items.map(entryFingerprint));
  const fresh = entries.filter((entry) => !known.has(entryFingerprint(entry)));
  const insertable = fresh.slice(0, Math.max(room, 0));

  /*
   * POWÓD WYŁĄCZENIA JEST TRZECH RODZAJÓW i każdy prowadzi gdzie indziej:
   * „nie masz punktów" odsyła do modułu dostaw, „wszystkie już są" mówi, że
   * praca jest zrobiona, a „sekcja pełna" — że trzeba coś usunąć. Jeden wspólny
   * komunikat („nie można") kazałby operatorowi zgadywać, które z trzech.
   */
  const reason =
    insertable.length > 0
      ? null
      : entries.length === 0
        ? t(`structured.${type}.import.empty`)
        : room <= 0
          ? t(`structured.${type}.import.full`)
          : t(`structured.${type}.import.nothingNew`);

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-cms-import
        disabled={reason !== null}
        aria-describedby={reason ? hintId : undefined}
        onClick={() => onImport(insertable)}
      >
        <MapPin className="size-4" aria-hidden />
        {t(`structured.${type}.import.action`)}
      </Button>
      {reason ? (
        <p id={hintId} data-cms-import-reason className="text-muted-foreground text-xs">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * MULTI-UPLOAD ISTNIEJĄCYM TOREM BILETÓW (ADR-082).
 *
 * Nie budujemy drugiego kanału: każdy plik jedzie tą samą trójką co zdjęcie
 * elementu płótna (przygotowanie biletu → wysyłka bajtów pod podpisany adres →
 * finalizacja z kontrolą magicznych bajtów). Pliki idą PO KOLEI, a nie równolegle:
 * bilet jest wydawany na jedną ścieżkę, a szereg równoległych wysyłek zamieniłby
 * jeden czytelny komunikat błędu w wyścig kilku.
 *
 * ŚWIEŻY KAFEL DOSTAJE PUSTY OPIS ALTERNATYWNY, i to jest decyzja: opis
 * zbudowany z nazwy pliku („IMG_4821") brzmi w czytniku ekranu gorzej niż jego
 * brak, a `alt=""` znaczy dokładnie „zdjęcie dekoracyjne, pomiń". Pole obok
 * mówi wprost, co wpisać i co znaczy pustka.
 */
function MediaUpload({
  siteId,
  type,
  field,
  full,
  onAdd,
}: {
  siteId: string;
  type: StructuredSectionType;
  field: StructuredFieldSpec;
  full: boolean;
  onAdd: (sources: ImageSource[]) => void;
}) {
  const t = useTranslations("site");
  const tErr = useTranslations("site.images.errors");
  const fieldId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    const chosen = Array.from(files ?? []);
    if (chosen.length === 0) return;
    setError(null);
    setBusy(true);

    const sources: ImageSource[] = [];
    let problem: string | null = null;
    for (const file of chosen) {
      const outcome = await runSiteImageUpload(file, {
        prepare: (input) => prepareSiteImageUploadAction(siteId, input),
        upload: uploadSiteImageToSignedUrl,
        finalize: finalizeSiteImageUploadAction,
        message: (kind) => tErr(kind),
      });
      if (outcome.ok) sources.push({ kind: "storage", path: outcome.path });
      // Pierwszy błąd zostaje na ekranie, ale reszta plików JEDZIE DALEJ:
      // jeden plik w złym formacie nie może unieważnić dziewięciu poprawnych.
      else problem ??= outcome.error;
    }

    setBusy(false);
    setError(problem);
    if (sources.length > 0) onAdd(sources);
  }

  return (
    <div data-cms-upload={field.key} className="flex flex-col gap-2">
      {/* Etykieta jest DOSTĘPNĄ NAZWĄ pola wyboru plików — bez niej kontrolka
          jest dla czytnika ekranu bezimiennym „wybierz plik". */}
      <Label htmlFor={fieldId}>{t("structured.upload.label")}</Label>
      <FileField
        id={fieldId}
        multiple
        prompt={busy ? t("structured.upload.busy") : t("structured.upload.prompt")}
        hint={t("structured.upload.hint")}
        removeLabel={t("structured.upload.remove")}
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={busy || full}
        error={error ?? undefined}
        onChange={(event) => {
          void handleFiles(event.currentTarget.files).finally(() => {
            // Zerowanie pola: bez tego ponowny wybór TEGO SAMEGO pliku nie
            // wywołałby zdarzenia zmiany i nic by się nie stało.
            event.target.value = "";
          });
        }}
      />
      {full ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t(`structured.${type}.full`)}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/**
 * JEDEN WPIS LISTY. Pola rysują się z rejestru (`itemFields`), więc wiersz nie
 * zna nazw pól ani ich liczby — ta sama komórka obsłuży „pytanie/odpowiedź"
 * i „zdjęcie/opis/podpis/odnośnik".
 */
function ItemRow({
  sortableId,
  index,
  total,
  type,
  item,
  canRemove,
  onPatch,
  onMove,
  onRemove,
}: {
  sortableId: string;
  index: number;
  total: number;
  type: StructuredSectionType;
  item: Record<string, unknown>;
  canRemove: boolean;
  onPatch: (key: string, value: string | undefined) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("site");
  const id = useId();
  const spec = structuredSpecOf(type);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });

  /**
   * Zapis wartości pola zgodnie z DEKLARACJĄ pustki w rejestrze — patrz decyzja
   * 5 w nagłówku pliku. Regułę niesie `valueToWrite`, wspólna z polami sekcji.
   */
  function write(field: StructuredFieldSpec, raw: string) {
    const decision = valueToWrite(field, raw);
    if (decision) onPatch(field.key, decision.value);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-cms-item={index}
      className={`border-border bg-card flex flex-col gap-3 rounded-md border p-3${
        isDragging ? " opacity-80" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-cms-drag={index}
          aria-label={t("structured.dragHandle")}
          className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 cursor-grab touch-none items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span className="text-muted-foreground text-xs">{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={t("structured.moveUp")}
            marker={`up-${index}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            icon={<ArrowUp className="size-4" aria-hidden />}
          />
          <IconButton
            label={t("structured.moveDown")}
            marker={`down-${index}`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            icon={<ArrowDown className="size-4" aria-hidden />}
          />
          <RemoveItemDialog type={type} index={index} disabled={!canRemove} onConfirm={onRemove} />
        </div>
      </div>

      {spec.itemFields.map((field) => {
        if (field.kind === "image") {
          return <ItemThumbnail key={field.key} source={item[field.key] as ImageSource | undefined} />;
        }
        const value = typeof item[field.key] === "string" ? (item[field.key] as string) : "";
        const label = t(`structured.${type}.fields.${field.key}`);
        if (field.kind === "choice") {
          /*
           * LISTA O ZAMKNIĘTYM ZBIORZE (E4). Wartości biorą się z REJESTRU, więc
           * kontrolka nie zna ani jednego rodzaju wpisu z nazwy — dopisanie
           * rodzaju do rejestru pojawia się tu samo. Wartość jedzie do treści
           * bez konwersji: to dana słownikowa, nie liczba.
           */
          return (
            <Field key={field.key} label={label} htmlFor={`${id}-${field.key}`}>
              <PanelSelect
                id={`${id}-${field.key}`}
                value={value}
                onValueChange={(picked) => {
                  if (!field.values?.includes(picked)) return;
                  onPatch(field.key, picked);
                }}
                options={(field.values ?? []).map((option) => ({
                  value: option,
                  label: t(`structured.${type}.fieldValues.${field.key}.${option}`),
                }))}
              />
            </Field>
          );
        }
        // Podpowiedź istnieje tylko tam, gdzie rejestr mówi, że pustka coś
        // ZNACZY — bez niej `alt=""` wyglądałoby na pole zapomniane.
        const hint = field.empty === "value" ? t(`structured.${type}.hints.${field.key}`) : undefined;
        return field.kind === "multiline" ? (
          <Field key={field.key} label={label} hint={hint} htmlFor={`${id}-${field.key}`}>
            <Textarea
              id={`${id}-${field.key}`}
              data-cms-field={field.key}
              rows={field.rows ?? 3}
              value={value}
              onChange={(event) => write(field, event.target.value)}
            />
          </Field>
        ) : (
          <Field key={field.key} label={label} hint={hint} htmlFor={`${id}-${field.key}`}>
            <Input
              id={`${id}-${field.key}`}
              data-cms-field={field.key}
              value={value}
              onChange={(event) => write(field, event.target.value)}
            />
          </Field>
        );
      })}
    </li>
  );
}

/**
 * MINIATURA WPISU MEDIALNEGO. Zdjęcia się nie „wpisuje", więc w tym miejscu
 * stoi podgląd, a nie pole ze ścieżką do Storage — ścieżka jest szczegółem
 * technicznym, którego operator nie ma po co widzieć ani móc zepsuć.
 *
 * `alt=""` jest tu poprawne: miniatura powtarza to, co opisuje pole obok,
 * a wpis ma w liście własny numer.
 */
function ItemThumbnail({ source }: { source?: ImageSource }) {
  const t = useTranslations("site");
  const src =
    source?.kind === "unsplash"
      ? source.url
      : source?.kind === "storage"
        ? `${siteImagePublicBase().replace(/\/+$/, "")}/${source.path.replace(/^\/+/, "")}`
        : null;

  if (!src) {
    return (
      <p data-cms-thumb="none" className="text-muted-foreground text-xs">
        {t("structured.upload.missing")}
      </p>
    );
  }
  return (
    <img
      data-cms-thumb={source?.kind}
      src={src}
      alt=""
      className="border-border h-24 w-full rounded-md border object-cover"
    />
  );
}

function IconButton({
  label,
  marker,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  marker: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-cms-move={marker}
      disabled={disabled}
      onClick={onClick}
      className={`text-muted-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:text-foreground cursor-pointer"
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * USUNIĘCIE WPISU PYTA (decyzja 2 z nagłówka pliku). Ostatniego wpisu usunąć
 * się nie da — sekcja bez ani jednej pozycji to atrapa, którą ADR-094 usuwa
 * z produktu; przycisk zostaje w drzewie, ale wyłączony, żeby reguła była
 * widoczna zamiast zgadywana.
 */
function RemoveItemDialog({
  type,
  index,
  disabled,
  onConfirm,
}: {
  type: StructuredSectionType;
  index: number;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("structured.removeItem")}
          title={t("structured.removeItem")}
          data-cms-remove={index}
          disabled={disabled}
          className={`text-muted-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
            disabled ? "cursor-not-allowed opacity-50" : "hover:text-destructive cursor-pointer"
          }`}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("structured.removeTitle")}</DialogTitle>
          <DialogDescription>{t(`structured.${type}.removeBody`)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("structured.removeCancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" data-cms-remove-confirm onClick={onConfirm}>
              {t("structured.removeConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

/**
 * SKORUPA KREATORA STRON (K1, ADR-083) — pełny ekran: górny pasek, lewa paleta,
 * płótno, prawa szuflada ustawień sekcji.
 *
 * Kreator stoi POZA powłoką panelu świadomie (grupa `(kreator)`): sidebar i
 * belka odbierałyby płótnu tę część szerokości, w której buduje się stronę, a
 * druga nawigacja obok paska kreatora myliłaby drogę powrotną. Powrót jest
 * JEDEN — „← Panel" w pasku.
 *
 * MUTACJE MAJĄ JEDEN KANAŁ (`run`): jedna tranzycja, jeden wskaźnik stanu
 * zapisu, jeden komunikat błędu. Płótno, paleta i publikacja nie trzymają
 * własnych flag oczekiwania, bo trzy niezależne „Zapisywanie…" na jednym pasku
 * mówiłyby operatorowi mniej niż jedno prawdziwe.
 *
 * ================== CO ZMIENIŁ K2 (ADR-084) ==================
 *
 * COFNIJ/PONÓW przestało być szkieletem: historia operacji PŁÓTNA (geometria,
 * warstwa, kopia i usunięcie elementu, wysokość i tło sekcji) mieszka w
 * `useCanvasEditor` i jest pamięciowa — żyje tyle, co otwarty kreator.
 *
 * AUTOZAPIS geometrii idzie tym samym kanałem, ale BEZ `router.refresh()`
 * (`quiet`): odświeżenie przyniosłoby dokładnie to, co przed chwilą wysłaliśmy,
 * a po drodze podmieniłoby propsy w środku kolejnego przeciągnięcia. Zmiany
 * STRUKTURY (dodanie, usunięcie, kolejność, publikacja) odświeżają jak dotąd,
 * bo tam płótno musi zobaczyć nową listę sekcji.
 *
 * ================== CO ZMIENIŁ K2c (ADR-087) ==================
 *
 * Zapis `quiet` wyszedł też POZA tranzycję — jego `pending` szarzył całe płótno
 * co 700 ms w środku pracy. Blokada zostaje przy operacjach struktury; edycja
 * płótna ma iść bez przerwy między jednym gestem a drugim.
 */
import {
  canvasMetrics,
  clampGeometry,
  createElement,
  defaultSizeOf,
  freeSpotFor,
  insertableSlots,
  isPinnedLastType,
  presetContentFor,
  sectionCanvasFrom,
  type PaletteElementKind,
  type SectionCanvas,
  type SectionType,
  snapMove,
  unitsFromPx,
  type ResolvedSiteStyle,
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
  TooltipProvider,
  type StorefrontProduct,
} from "@avably/ui";
import { ArrowLeft, Monitor, Redo2, Smartphone, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import {
  deleteSection,
  duplicateSection,
  publishSite,
  reorderSections,
  restoreSection,
  toggleSection,
  applyStarterTemplate,
  updateSiteStyle,
  upsertSection,
} from "@/lib/actions/site";

import { BuilderCanvas, type BuilderViewport, type ElementSelection } from "./builder-canvas";
import { BuilderPalette } from "./builder-palette";
import { TemplateGallery } from "./template-gallery";
import { ImagePicker } from "./image-picker";
import { insertIndexAtPointer, orderWithInsertedAt, type SectionBand } from "./insert-position";
import { SectionSettingsDrawer } from "./section-settings-drawer";
import { newElementId, replaceElement, useCanvasEditor } from "./use-canvas-editor";

type ActionResult = { ok: true } | { ok: false; error: string };
type SaveState = "idle" | "saving" | "saved";

export function SiteBuilder({
  siteId,
  siteName,
  style,
  sections,
  products,
}: {
  siteId: string;
  /**
   * Nazwa WERSJI, którą operator ma otwartą (0048, ADR-093). Przy wielu
   * wersjach płótno bez etykiety nie odpowiada na pytanie „którą stronę
   * właśnie edytuję" — a to jest pytanie, które przy przełączaniu wersji
   * pada najczęściej.
   */
  siteName: string;
  /** Styl SZKICU (motyw + akcent + para krojów) — jedyne wejście wyglądu (ADR-090). */
  style: ResolvedSiteStyle;
  sections: EditorSection[];
  products: StorefrontProduct[];
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<BuilderViewport>("desktop");
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [picking, setPicking] = useState<ElementSelection | null>(null);
  /**
   * Miejsce, w które wejdzie sekcja przeciągana właśnie z palety (K6, ADR-092),
   * albo `null`, gdy nic nie jest przeciągane. Stan żyje w SKORUPIE, bo to ona
   * widzi jednocześnie paletę (źródło) i płótno (cel).
   */
  const [sectionDropIndex, setSectionDropIndex] = useState<number | null>(null);
  /** Sekcja, która przyjmie przeciągany właśnie ELEMENT (K6, ADR-092). */
  const [elementDropSectionId, setElementDropSectionId] = useState<string | null>(null);
  /**
   * GALERIA SZABLONÓW (K5 v2, ADR-090). Otwarta z automatu przy PIERWSZEJ
   * wizycie, czyli wtedy, gdy strona nie ma ani jednej sekcji: pusty kreator
   * jest gorszą odpowiedzią na „nie wiem, od czego zacząć" niż sześć gotowych
   * stron. Później wraca przyciskiem „zacznij od nowa".
   */
  const [galleryOpen, setGalleryOpen] = useState(sections.length === 0);

  /**
   * Jedyna droga mutacji w kreatorze. Sukces odświeża RSC (`router.refresh`),
   * więc płótno pokazuje zapisany szkic BEZ przeładowania trasy; porażka cofa
   * zmianę optymistyczną i zostawia komunikat. `quiet` zdejmuje odświeżenie —
   * patrz nagłówek pliku (autozapis geometrii).
   */
  const run = useCallback(
    (
      action: () => Promise<ActionResult>,
      onFail?: () => void,
      options?: { quiet?: boolean; blocking?: boolean },
    ) => {
      setError(null);
      setSaveState("saving");

      const settle = (result: ActionResult, refresh: boolean) => {
        if (result.ok) {
          setSaveState("saved");
          if (refresh) router.refresh();
        } else {
          setSaveState("idle");
          setError(result.error);
          onFail?.();
        }
      };

      /*
       * ŻADEN ZAPIS NIE BLOKUJE PŁÓTNA — POZA PUBLIKACJĄ (pinezka właściciela
       * 2026-08-03, druga tura po K2c/ADR-087).
       *
       * K2c wyprowadziło z tranzycji zapisy `quiet` (geometria), ale zmiany
       * STRUKTURY — włączenie sekcji, duplikat, usunięcie, przywrócenie,
       * kolejność, wybór szablonu, a od K5 także KAŻDE kliknięcie w panelu
       * „Styl strony" — dalej szły `startTransition`. Jego `pending` jedzie do
       * `busy` płótna i wyłącza wszystko: uchwyty, paski sekcji, ramki
       * elementów. Operator klikał akcent i przez cały odczyt RSC (lokalnie
       * kilkaset ms, na produkcji więcej) miał martwy kreator — dokładnie to,
       * co zgłosił: „za każdym razem po kliknięciu się zapisuje, muszę czekać".
       *
       * Odtąd blokada zostaje WYŁĄCZNIE przy publikacji, bo tam wstrzymanie ma
       * sens merytoryczny: publikacja przenosi komplet stanu widocznego (ADR-091)
       * i druga w locie znaczyłaby dwie prawdy o tym, co jest opublikowane.
       * Reszta idzie w tle, ze wspólnym wskaźnikiem „Zapisywanie…/Zapisano" —
       * on INFORMUJE, a nie zatrzymuje.
       *
       * Czego to NIE psuje: kolejność sekcji zapisuje się KOMPLETEM pozycji
       * (`reorderPlan`), więc dwie operacje w locie kończą się stanem ostatniej,
       * a nie stanem połowicznym; serwer i tak przelicza pozycje od zera.
       */
      if (options?.blocking) {
        startTransition(async () => {
          settle(await action(), true);
        });
        return;
      }

      void action().then((result) => settle(result, !options?.quiet));
    },
    [router],
  );

  const editor = useCanvasEditor({
    sections,
    persist: useCallback(
      (section: EditorSection, canvas: SectionCanvas) => {
        run(
          () =>
            upsertSection({
              siteId,
              sectionId: section.id,
              type: section.type,
              content: canvas,
            } as Parameters<typeof upsertSection>[0]),
          undefined,
          { quiet: true },
        );
      },
      [run, siteId],
    ),
  });

  /**
   * Dodanie sekcji NA POZYCJI: `upsertSection` dopisuje na końcu (nie zna
   * pojęcia „między"), więc miejsce powstaje dopiero drugim krokiem —
   * `reorderSections` z KOMPLETEM pozycji, tą samą akcją co przeciąganie.
   *
   * Nowa sekcja rodzi się OD RAZU jako płótno v2 (K2): preset treści przechodzi
   * przez tę samą konwersję, którą kiedyś przejdą sekcje zapisane przed K2.
   */
  function addSection(type: SectionType, index: number, orderedIds: string[]) {
    run(async () => {
      const added = await upsertSection({
        siteId,
        type,
        content: sectionCanvasFrom(type, presetContentFor(type, locale)),
      } as Parameters<typeof upsertSection>[0]);
      if (!added.ok) return added;
      return reorderSections(siteId, orderWithInsertedAt(orderedIds, added.sectionId, index));
    });
  }

  /**
   * PRZECIĄGNIĘCIE SEKCJI Z PALETY NA KONKRETNE MIEJSCE (K6, ADR-092).
   *
   * Do K6 paleta nie znała pojęcia „gdzie": kafel dokładał sekcję na KOŃCU,
   * a wstawienie w środku miało osobną drogę („+" między sekcjami). Operator
   * po przejściu kreatora na produkcji zgłosił to wprost — przeciąganie jest
   * pierwszym odruchem, a jego brak każe budować stronę w dwóch krokach.
   *
   * Miara siedzi w SKORUPIE z tego samego powodu, co przy elementach (K3):
   * paleta jest RODZEŃSTWEM płótna, więc jej gest nie sięga płótna, a płótno
   * nie widzi kafla. Skorupa widzi oba.
   *
   * Pomiar idzie po DOM-ie, nie po propsach: płótno trzyma własny, optymistyczny
   * stan kolejności (K1), więc lista z propsów potrafi być o jeden ruch do tyłu.
   * Kolejność zmierzona z drzewa jest tą, którą operator MA PRZED OCZAMI — a
   * podświetlony slot ma obiecywać dokładnie to, co widać.
   */
  function canvasBands(): { bands: SectionBand[]; ids: string[] } {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-builder-canvas] [data-canvas-section]"),
    );
    const bands: SectionBand[] = [];
    const ids: string[] = [];
    nodes.forEach((node) => {
      const id = node.getAttribute("data-canvas-section");
      if (!id) return;
      const rect = node.getBoundingClientRect();
      bands.push({ index: ids.length, top: rect.top, bottom: rect.bottom });
      ids.push(id);
    });
    return { bands, ids };
  }

  /** Ile miejsc wstawienia ma strona — sekcja przypięta odbiera miejsce POD sobą. */
  function slotsFor(ids: readonly string[]): number {
    const known = ids
      .map((id) => sections.find((section) => section.id === id))
      .filter((section): section is EditorSection => Boolean(section))
      .map((section) => ({ id: section.id, type: section.type }));
    return insertableSlots(known);
  }

  /**
   * Miejsce wstawienia pod kursorem — albo `null`, gdy kursor stoi POZA
   * płótnem. Rozróżnienie jest istotne: puszczenie kafla nad paletą ma nie
   * dodać niczego, a nie dodać na końcu strony.
   */
  function sectionDropIndexAt(pointer: { x: number; y: number }): number | null {
    const overCanvas = document
      .elementsFromPoint(pointer.x, pointer.y)
      .some((node) => node instanceof HTMLElement && node.hasAttribute("data-builder-canvas"));
    if (!overCanvas) return null;
    const { bands, ids } = canvasBands();
    return insertIndexAtPointer(bands, pointer.y, slotsFor(ids));
  }

  /**
   * Sekcja pod kursorem przy przeciąganiu ELEMENTU. Ta sama miara, której
   * używa `dropElementAt` przy puszczeniu — wskazanie i wynik muszą pochodzić
   * z jednego pomiaru, inaczej obrys obiecuje sekcję, a element ląduje obok.
   */
  function elementDropTargetAt(pointer: { x: number; y: number }): string | null {
    const grid = document
      .elementsFromPoint(pointer.x, pointer.y)
      .find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-canvas-grid"));
    const sectionId = grid?.closest<HTMLElement>("[data-canvas-section]")?.getAttribute("data-canvas-section");
    if (!sectionId) return null;
    // Sekcja usunięta w szkicu elementów nie przyjmuje (K5a) — nie obiecujemy
    // celu, którego upuszczenie i tak odrzuci.
    if (sections.find((section) => section.id === sectionId)?.deletedInDraft) return null;
    return sectionId;
  }

  const sectionDrag = {
    onDragMove: (pointer: { x: number; y: number }) => setSectionDropIndex(sectionDropIndexAt(pointer)),
    onDragEnd: () => setSectionDropIndex(null),
    onDrop: (type: SectionType, pointer: { x: number; y: number }) => {
      const index = sectionDropIndexAt(pointer);
      setSectionDropIndex(null);
      if (index === null) return;
      addSection(type, index, canvasBands().ids);
    },
  };

  /**
   * Typy, których na tej stronie nie da się dołożyć. Dziś dokładnie jeden
   * przypadek: stopka, gdy strona ma już ŻYWĄ stopkę (unikat częściowy w 0047).
   * Nagrobek się nie liczy — po jego usunięciu w szkicu nowa stopka wejdzie.
   */
  const unavailableTypes = sections.some(
    (section) => isPinnedLastType(section.type) && !section.deletedInDraft,
  )
    ? (["footer"] as const)
    : [];

  /**
   * Dodanie elementu KLIKNIĘCIEM kafla palety (K3). Trafia do sekcji, w której
   * operator ostatnio coś zaznaczył — a gdy nic nie zaznaczył, do PIERWSZEJ
   * sekcji strony. Zgadywanie „gdzieś" byłoby gorsze niż jedna przewidywalna
   * zasada, którą widać po wyniku.
   */
  function addElement(kind: PaletteElementKind) {
    // Sekcja usunięta w szkicu nie przyjmuje elementów (K5a, ADR-091) — zniknie
    // przy najbliższej publikacji, więc byłby to zapis do kosza.
    const editable = sections.filter((section) => !section.deletedInDraft);
    const target = selection?.sectionId ?? editable[0]?.id;
    if (!target || editable.every((section) => section.id !== target)) return;
    const canvas = editor.canvasOf(target);
    if (!canvas) return;
    const id = newElementId();
    editor.mutate(target, (current) => ({
      ...current,
      elements: [
        ...current.elements,
        createElement(kind, id, freeSpotFor(kind, current.elements, current.rows, locale), locale),
      ],
    }));
    setSelection({ sectionId: target, elementId: id });
  }

  /**
   * UPUSZCZENIE KAFLA PALETY NA PŁÓTNO (K3, ADR-086).
   *
   * Logika siedzi w SKORUPIE, nie w płótnie, bo paleta jest jej rodzeństwem —
   * `DndContext` płótna obejmuje wyłącznie kolejność sekcji, więc kafel i tak
   * nie mógłby być w nim źródłem przeciągania. Miejsce liczymy z pozycji
   * wskaźnika względem PŁÓTNA sekcji, pod którą wypadł kursor, JEDNĄ KWADRATOWĄ
   * miarą siatki (`canvasMetrics`) w obu osiach — stała wysokość jednostki
   * kładłaby element gdzie indziej, niż pokazywał kursor, na każdej szerokości
   * płótna innej niż projektowa (ADR-087, decyzja 3).
   */
  function dropElementAt(kind: PaletteElementKind, pointer: { x: number; y: number }): boolean {
    const grid = document
      .elementsFromPoint(pointer.x, pointer.y)
      .find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-canvas-grid"));
    const sectionId = grid?.closest<HTMLElement>("[data-canvas-section]")?.getAttribute("data-canvas-section");
    const canvas = sectionId ? editor.canvasOf(sectionId) : undefined;
    if (!grid || !sectionId || !canvas) return false;
    // Upuszczenie na sekcję usuniętą w szkicu nie ma skutku (K5a, ADR-091).
    if (sections.find((section) => section.id === sectionId)?.deletedInDraft) return false;

    /*
     * W WIDOKU TELEFONU upuszczenie NIE wskazuje miejsca (K4, ADR-088).
     * Współrzędne pod kursorem opisują wtedy układ MOBILNY, a nowy element musi
     * dostać geometrię DESKTOPOWĄ — to ona jest źródłem, z którego wyprowadza
     * się telefon. Przeliczenie jednego na drugie byłoby zgadywaniem; element
     * ląduje więc pod treścią wskazanej sekcji, dokładnie tak, jak po
     * kliknięciu kafla, i od razu widać go na obu breakpointach.
     */
    if (viewport === "mobile") {
      const id = newElementId();
      editor.mutate(sectionId, (current) => ({
        ...current,
        elements: [
          ...current.elements,
          createElement(kind, id, freeSpotFor(kind, current.elements, current.rows, locale), locale),
        ],
      }));
      setSelection({ sectionId, elementId: id });
      return true;
    }

    const box = grid.getBoundingClientRect();
    const metrics = canvasMetrics(grid.clientWidth, canvas.rows);
    const size = defaultSizeOf(kind, locale);
    // Kafel „chwyta się" środkiem — bez odjęcia połowy pudełka element
    // wyskakiwałby w prawo i w dół od kursora.
    const raw = {
      x: unitsFromPx(pointer.x - box.left, metrics) - size.w / 2,
      y: unitsFromPx(pointer.y - box.top, metrics) - size.h / 2,
      w: size.w,
      h: size.h,
      z: canvas.elements.length,
    };
    // Przyciąganie do siatki i sąsiadów — te same czyste funkcje, co gest.
    const snapped = snapMove(clampGeometry(raw, canvas.rows), 0, 0, {
      rows: canvas.rows,
      neighbours: canvas.elements.map((element) => element.layout.desktop),
      snap: true,
    });

    const id = newElementId();
    editor.mutate(sectionId, (current) => ({
      ...current,
      elements: [...current.elements, createElement(kind, id, snapped.geometry, locale)],
    }));
    setSelection({ sectionId, elementId: id });
    return true;
  }

  const openSection = sections.find((section) => section.id === settingsId) ?? null;

  return (
    // Kreator ma WŁASNEGO dostawcę tooltipów: trasa stoi poza powłoką panelu
    // (grupa `(kreator)`, ADR-083), więc nie dziedziczy tego z belki — a od K3
    // tooltipy niosą znaczenie ikon w paskach akcji i w pasku formatowania.
    <TooltipProvider>
    <div data-site-builder className="flex h-screen min-h-screen flex-col">
      <h1 className="sr-only">{t("builder.title")}</h1>

      <header
        data-builder-topbar
        className="border-border bg-card flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2"
      >
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href="/strona" data-builder-back onClick={() => editor.flush()}>
            <ArrowLeft className="size-4" aria-hidden />
            {t("builder.back")}
          </Link>
        </Button>

        <span data-builder-site-name className="truncate text-sm font-medium">
          {siteName}
        </span>

        <div
          role="group"
          aria-label={t("builder.viewportLegend")}
          data-builder-viewport-switch
          className="border-border flex gap-1 rounded-md border p-1"
        >
          <ViewportButton
            active={viewport === "desktop"}
            label={t("builder.viewportDesktop")}
            icon={<Monitor className="size-4" aria-hidden />}
            onClick={() => setViewport("desktop")}
          />
          <ViewportButton
            active={viewport === "mobile"}
            label={t("builder.viewportMobile")}
            icon={<Smartphone className="size-4" aria-hidden />}
            onClick={() => setViewport("mobile")}
          />
        </div>

        {/* Historia płótna (K2) — wyłączona, gdy nie ma czego cofnąć: `disabled`
            mówi to samo maszynowo, co szarość mówi oku (#135). */}
        <div data-builder-history className="border-border flex gap-1 rounded-md border p-1">
          <HistoryButton
            label={t("builder.undo")}
            action="undo"
            disabled={!editor.canUndo || pending}
            icon={<Undo2 className="size-4" aria-hidden />}
            onClick={editor.undo}
          />
          <HistoryButton
            label={t("builder.redo")}
            action="redo"
            disabled={!editor.canRedo || pending}
            icon={<Redo2 className="size-4" aria-hidden />}
            onClick={editor.redo}
          />
        </div>

        <p data-builder-save-state role="status" className="text-muted-foreground ml-auto text-sm">
          {saveState === "saving" ? t("builder.saving") : saveState === "saved" ? t("builder.saved") : null}
        </p>

        {/*
          PODGLĄD SZKICU otwiera się w NOWEJ KARCIE (pinezka właściciela): karta
          kreatora zostaje tam, gdzie była, z niezapisaną historią cofania i
          zaznaczeniem. `target="_blank"` wymaga `rel="noreferrer"` — trasa jest
          nasza, ale nowa karta z dostępem do `window.opener` to nawyk, którego
          nie zostawiamy nawet u siebie.
        */}
        <Button asChild type="button" size="sm" variant="secondary">
          <a
            href={`/${locale}/strona/${siteId}/podglad`}
            target="_blank"
            rel="noreferrer"
            data-builder-preview
            title={t("preview.openHint")}
          >
            {t("preview.open")}
          </a>
        </Button>

        <StartOverButton
          disabled={pending}
          hasSections={sections.length > 0}
          onConfirm={() => setGalleryOpen(true)}
        />

        <Button
          type="button"
          size="sm"
          data-builder-publish
          // JEDYNA operacja, która blokuje kreator — patrz komentarz przy `run`.
          onClick={() => run(() => publishSite(siteId), undefined, { blocking: true })}
          loading={pending}
          disabled={pending}
        >
          {pending ? t("publish.publishing") : t("publish.publish")}
        </Button>
      </header>

      {error ? (
        <p role="alert" className="text-destructive border-border border-b px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {galleryOpen ? (
        <TemplateGallery
          disabled={pending}
          onPick={(starterId) =>
            // Galeria zamyka się WYŁĄCZNIE po udanym zapisie: przy błędzie
            // operator ma zostać tam, gdzie kliknął, i zobaczyć komunikat.
            run(() =>
              applyStarterTemplate({ siteId, starterId, locale }).then((result: ActionResult) => {
                if (result.ok) setGalleryOpen(false);
                return result;
              }),
            )
          }
          // Przy pierwszej wizycie nie ma do czego wracać — bez sekcji kreator
          // pokazałby puste płótno, więc zamknięcie galerii byłoby ślepą uliczką.
          onDismiss={sections.length > 0 ? () => setGalleryOpen(false) : undefined}
        />
      ) : null}

      <div className={galleryOpen ? "hidden" : "flex min-h-0 flex-1"}>
        <BuilderPalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((open) => !open)}
          disabled={pending}
          style={style}
          // Klik kafla dokłada sekcję na końcu treści — czyli PRZED stopką,
          // jeśli strona ją ma. Bez tego kliknięcie i przeciągnięcie kończyłyby
          // się w dwóch różnych miejscach.
          onAddSection={(type) =>
            addSection(
              type,
              slotsFor(sections.map((s) => s.id)),
              sections.map((s) => s.id),
            )
          }
          onAddElement={addElement}
          onDropElement={dropElementAt}
          onDragElementOver={(pointer) => setElementDropSectionId(elementDropTargetAt(pointer))}
          onDragElementEnd={() => setElementDropSectionId(null)}
          onDragSection={sectionDrag}
          unavailableSectionTypes={unavailableTypes}
          onSaveStyle={(next) => run(() => updateSiteStyle(siteId, next))}
        />

        {/* Scena przewija się w OBU osiach (K4, ADR-088): płótno desktopowe ma
            zagwarantowaną szerokość co najmniej 40 rem, żeby renderer nigdy nie
            wpadł w układ mobilny w widoku „komputer" — a w wąskim oknie ta
            gwarancja musi mieć gdzie się zmieścić. */}
        <main data-builder-stage className="bg-muted min-w-0 flex-1 overflow-auto p-4 md:p-6">
          <BuilderCanvas
            style={style}
            sections={sections}
            products={products}
            viewport={viewport}
            busy={pending}
            dropIndex={sectionDropIndex}
            dropSectionId={elementDropSectionId}
            run={run}
            reorderAction={(orderedIds) => reorderSections(siteId, orderedIds)}
            toggleAction={(section) => toggleSection(section.id, !section.enabled)}
            duplicateAction={(sectionId) => duplicateSection(sectionId)}
            deleteAction={(sectionId) => deleteSection(sectionId)}
            restoreAction={(sectionId) => restoreSection(sectionId)}
            onAddSection={addSection}
            onOpenSettings={setSettingsId}
            editor={editor}
            selection={selection}
            onSelect={setSelection}
            onPickImage={setPicking}
            onChanged={() => {
              setSaveState("saved");
              router.refresh();
            }}
          />
        </main>
      </div>

      <ImagePicker
        siteId={siteId}
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(source, alt) => {
          const target = picking;
          if (!target) return;
          editor.mutate(target.sectionId, (canvas) =>
            replaceElement(canvas, target.elementId, (element) =>
              element.kind === "image"
                ? {
                    ...element,
                    source,
                    // Stara ścieżka schodzi razem ze źródłem — zgodność wstecz
                    // jest DROGĄ ODCZYTU, nie miejscem zapisu (ADR-086).
                    imagePath: undefined,
                    alt: alt && alt.trim().length > 0 ? alt : element.alt,
                  }
                : element,
            ),
          );
          setPicking(null);
        }}
      />

      <SectionSettingsDrawer
        siteId={siteId}
        section={openSection}
        canvas={openSection ? editor.canvasOf(openSection.id) : undefined}
        selectedElementId={
          openSection && selection?.sectionId === openSection.id ? selection.elementId : null
        }
        onCanvasChange={(update) => {
          if (openSection) editor.mutate(openSection.id, update);
        }}
        onPickImage={
          openSection && selection?.sectionId === openSection.id
            ? () => setPicking(selection)
            : undefined
        }
        onClose={() => setSettingsId(null)}
        onSaved={() => {
          setSaveState("saved");
          router.refresh();
        }}
      />
    </div>
    </TooltipProvider>
  );
}

function ViewportButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-viewport-option={active ? "active" : "inactive"}
      onClick={onClick}
      className={`focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-8 cursor-pointer items-center justify-center rounded-sm border border-transparent outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function HistoryButton({
  label,
  action,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  action: "undo" | "redo";
  disabled: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      data-builder-history-button={action}
      onClick={onClick}
      className={`text-muted-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-8 items-center justify-center rounded-sm border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:text-foreground cursor-pointer"
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * „ZACZNIJ OD NOWA" (K5 v2, ADR-090) — powrót do galerii szablonów.
 *
 * Dialog MÓWI PRAWDĘ o skutku, i to jest tu cała robota. Do 0045 zastosowanie
 * szablonu kasowało sekcje wierszami, więc zdejmowało je z ŻYWEJ strony
 * natychmiast; dziś usunięcia idą nagrobkami (ADR-091), więc opublikowana
 * strona nie zmienia się ani o piksel do chwili publikacji. Komunikat opisuje
 * dokładnie ten stan — inaczej operator albo bałby się kliknąć, albo
 * dowiedziałby się o skutku od klienta.
 *
 * Rozróżnienie „strona ma sekcje / nie ma" jest istotne: przy pierwszej wizycie
 * nie ma czego zastępować, więc nie ma o co pytać.
 */
function StartOverButton({
  disabled,
  hasSections,
  onConfirm,
}: {
  disabled: boolean;
  hasSections: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  if (!hasSections) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" data-builder-start-over disabled={disabled}>
          {t("starter.startOver")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("starter.confirmTitle")}</DialogTitle>
          <DialogDescription data-start-over-scope="draft-only">
            {t("starter.confirmBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("starter.confirmCancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" onClick={onConfirm} data-start-over-confirm>
              {t("starter.confirmAccept")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


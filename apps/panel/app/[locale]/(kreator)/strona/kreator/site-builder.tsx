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
  presetContentFor,
  sectionCanvasFrom,
  type PaletteElementKind,
  type SectionCanvas,
  type SectionType,
  type SiteTemplate,
  snapMove,
  unitsFromPx,
} from "@avably/core/site";
import { Button, TooltipProvider, type StorefrontProduct } from "@avably/ui";
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
  toggleSection,
  updateTemplate,
  upsertSection,
} from "@/lib/actions/site";

import { BuilderCanvas, type BuilderViewport, type ElementSelection } from "./builder-canvas";
import { BuilderPalette } from "./builder-palette";
import { ImagePicker } from "./image-picker";
import { orderWithInsertedAt } from "./insert-position";
import { SectionSettingsDrawer } from "./section-settings-drawer";
import { newElementId, replaceElement, useCanvasEditor } from "./use-canvas-editor";

type ActionResult = { ok: true } | { ok: false; error: string };
type SaveState = "idle" | "saving" | "saved";

export function SiteBuilder({
  siteId,
  template,
  sections,
  products,
}: {
  siteId: string;
  template: SiteTemplate;
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
   * Jedyna droga mutacji w kreatorze. Sukces odświeża RSC (`router.refresh`),
   * więc płótno pokazuje zapisany szkic BEZ przeładowania trasy; porażka cofa
   * zmianę optymistyczną i zostawia komunikat. `quiet` zdejmuje odświeżenie —
   * patrz nagłówek pliku (autozapis geometrii).
   */
  const run = useCallback(
    (
      action: () => Promise<ActionResult>,
      onFail?: () => void,
      options?: { quiet?: boolean },
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
       * AUTOZAPIS NIE ZAMRAŻA PŁÓTNA (K2c, ADR-087). Zapisy `quiet` (geometria
       * elementów) idą POZA tranzycją, bo `pending` tranzycji szarzy uchwyty
       * i paski narzędzi całego kreatora — a autozapis wpada co 700 ms w środku
       * pracy. Operator dostawał między gestami kursor „zakaz" i wyłączone
       * przyciski, choć nic nie było zablokowane. Wskaźnik „Zapisywanie…/
       * Zapisano" zostaje jeden i wspólny, bo on informuje, a nie blokuje.
       *
       * Zmiany STRUKTURY (kolejność, dodanie, usunięcie, publikacja) zostają
       * w tranzycji: tam blokada jest na miejscu, bo druga taka operacja
       * w locie rozjechałaby listę sekcji.
       */
      if (options?.quiet) {
        void action().then((result) => settle(result, false));
        return;
      }

      startTransition(async () => {
        settle(await action(), true);
      });
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
   * Dodanie elementu KLIKNIĘCIEM kafla palety (K3). Trafia do sekcji, w której
   * operator ostatnio coś zaznaczył — a gdy nic nie zaznaczył, do PIERWSZEJ
   * sekcji strony. Zgadywanie „gdzieś" byłoby gorsze niż jedna przewidywalna
   * zasada, którą widać po wyniku.
   */
  function addElement(kind: PaletteElementKind) {
    const target = selection?.sectionId ?? sections[0]?.id;
    if (!target) return;
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

        <Button
          type="button"
          size="sm"
          data-builder-publish
          onClick={() => run(() => publishSite(siteId))}
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

      <div className="flex min-h-0 flex-1">
        <BuilderPalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((open) => !open)}
          disabled={pending}
          template={template}
          onAddSection={(type) => addSection(type, sections.length, sections.map((s) => s.id))}
          onAddElement={addElement}
          onDropElement={dropElementAt}
          onSaveTemplate={(choice) => run(() => updateTemplate(siteId, choice))}
        />

        {/* Scena przewija się w OBU osiach (K4, ADR-088): płótno desktopowe ma
            zagwarantowaną szerokość co najmniej 40 rem, żeby renderer nigdy nie
            wpadł w układ mobilny w widoku „komputer" — a w wąskim oknie ta
            gwarancja musi mieć gdzie się zmieścić. */}
        <main data-builder-stage className="bg-muted min-w-0 flex-1 overflow-auto p-4 md:p-6">
          <BuilderCanvas
            template={template}
            sections={sections}
            products={products}
            viewport={viewport}
            busy={pending}
            run={run}
            reorderAction={(orderedIds) => reorderSections(siteId, orderedIds)}
            toggleAction={(section) => toggleSection(section.id, !section.enabled)}
            duplicateAction={(sectionId) => duplicateSection(sectionId)}
            deleteAction={(sectionId) => deleteSection(sectionId)}
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

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
 */
import {
  presetContentFor,
  sectionCanvasFrom,
  type SectionCanvas,
  type SectionType,
  type SiteTemplate,
} from "@avably/core/site";
import { Button, type StorefrontProduct } from "@avably/ui";
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
import { orderWithInsertedAt } from "./insert-position";
import { SectionSettingsDrawer } from "./section-settings-drawer";
import { useCanvasEditor } from "./use-canvas-editor";

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
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          setSaveState("saved");
          if (!options?.quiet) router.refresh();
        } else {
          setSaveState("idle");
          setError(result.error);
          onFail?.();
        }
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

  const openSection = sections.find((section) => section.id === settingsId) ?? null;

  return (
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
          onSaveTemplate={(choice) => run(() => updateTemplate(siteId, choice))}
        />

        <main data-builder-stage className="bg-muted min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
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
            onChanged={() => {
              setSaveState("saved");
              router.refresh();
            }}
          />
        </main>
      </div>

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
        onClose={() => setSettingsId(null)}
        onSaved={() => {
          setSaveState("saved");
          router.refresh();
        }}
      />
    </div>
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

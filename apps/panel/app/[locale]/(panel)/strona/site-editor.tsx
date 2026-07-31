"use client";

/**
 * Edytor storefrontu tenanta (Zadanie 2.3b, skóra P8b) — cała interakcja.
 *
 * Układ z mockupu `secondary-site-editor`: DWIE KOLUMNY — po lewej edytor pod
 * wspólną miarą formularza (`data-form-line-measure`, P8a), po prawej PODGLĄD
 * SZKICU NA ŻYWO (kreator A3): ramka z osobnym dokumentem `/podglad-strony`,
 * przeładowywana sygnałem po każdej udanej mutacji szkicu. Na wąskim ekranie
 * kolumny nie idą jedna pod drugą — ramka wysokości pół ekranu odsuwałaby
 * wtedy edytor poza widok — tylko wykluczają się przełącznikiem
 * edycja/podgląd.
 *
 * PUBLIKACJA JEST OSOBNA OD ZAPISU — i to jest treść ekranu, nie szczegół
 * układu: zapis szablonu i zapis każdej sekcji piszą WYŁĄCZNIE do
 * `content_draft`, a stan publiczny zmienia dopiero „Opublikuj stronę”. Stąd
 * karta `data-publish-status` z osobnym chipem osi `site-publish` na samej
 * górze: zanim operator cokolwiek zapisze, widzi, co dziś widzą klienci.
 *
 * Akcje modelu sekcyjnego 2.3a (RPC-style, zwrot `SiteActionResult`) wołane są
 * przez `useTransition`; po sukcesie robią `revalidatePath`, więc serwerowa
 * strona przeładowuje świeży szkic i przekazuje go tu w propsach.
 */
import { SITE_TEMPLATES, presetContentFor, type SectionType, type SiteTemplate } from "@avably/core/site";
import { Button, cn } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import {
  deleteSection,
  duplicateSection,
  publishSite,
  reorderSections,
  toggleSection,
  updateTemplate,
  upsertSection,
} from "@/lib/actions/site";

import { AddSectionDialog } from "./add-section-gallery";
import { type EditorSection } from "./content";
import { SitePreviewFrame } from "./site-preview-frame";
import { SortableSections } from "./sortable-sections";

type ActionResult = { ok: true } | { ok: false; error: string };

export function SiteEditor({
  siteId,
  template,
  sections,
  publishedAtLabel,
}: {
  siteId: string;
  template: SiteTemplate;
  sections: EditorSection[];
  /** Sformatowana data ostatniej publikacji albo null — strona nigdy nie publikowana. */
  publishedAtLabel: string | null;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [templateChoice, setTemplateChoice] = useState<SiteTemplate>(template);
  /**
   * Sygnał odświeżenia podglądu (kreator A3). Ramka to OSOBNY dokument, więc
   * `router.refresh()` — który odświeża drzewo RSC edytora — nie ma jak jej
   * dotknąć. Licznik rośnie po KAŻDEJ udanej mutacji szkicu i to on
   * przeładowuje ramkę; `focus` niesie sekcję, do której podgląd ma przewinąć
   * (tylko zapis treści wie, o którą chodzi — reorder czy zmiana szablonu
   * dotyczą całej strony).
   */
  const [preview, setPreview] = useState<{ signal: number; focus: string | null }>({
    signal: 0,
    focus: null,
  });
  /** Kolumna widoczna na wąskim ekranie — na desktopie stoją obok siebie. */
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");

  function refreshPreview(focusSectionId?: string) {
    setPreview((current) => ({ signal: current.signal + 1, focus: focusSectionId ?? null }));
  }

  /** Woła akcję w tranzycji, pokazuje błąd i odświeża RSC po sukcesie. */
  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    setPublished(false);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onOk?.();
        router.refresh();
        refreshPreview();
      } else {
        setError(result.error);
      }
    });
  }

  /**
   * Dodanie sekcji z galerii: treść startowa z presetu (język operatora).
   * `afterSectionId` = wstawienie TUŻ ZA daną sekcją (akcja „dodaj poniżej") —
   * dodajemy na końcu i przenumerowujemy jednym reorderem; bez niego sekcja
   * ląduje na końcu (domyślnie).
   */
  function addSection(type: SectionType, afterSectionId?: string) {
    run(async () => {
      const added = await upsertSection({
        siteId,
        type,
        content: presetContentFor(type, locale),
      } as Parameters<typeof upsertSection>[0]);
      if (!added.ok) return added;
      if (afterSectionId) {
        const ids = sections.map((s) => s.id);
        const index = ids.indexOf(afterSectionId);
        if (index >= 0) {
          const order = [...ids.slice(0, index + 1), added.sectionId, ...ids.slice(index + 1)];
          return reorderSections(siteId, order);
        }
      }
      return { ok: true };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("subtitle")}</p>

      <ScreenSection
        data-publish-status
        title={t("publish.heading")}
        status={
          // Oś `site-publish` zna WYŁĄCZNIE stan „opublikowana” (tak jest w
          // artefakcie). Strona nigdy nieopublikowana nie dostaje więc chipa
          // udającego stan, którego mapa nie opisuje — dostaje zdanie.
          publishedAtLabel ? <SecondaryStatusChip axis="site-publish" value="published" /> : null
        }
        description={
          publishedAtLabel
            ? t("publish.publishedAt", { date: publishedAtLabel })
            : t("publish.notPublished")
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => run(() => publishSite(siteId), () => setPublished(true))}
            loading={pending}
            disabled={pending}
          >
            {pending ? t("publish.publishing") : t("publish.publish")}
          </Button>
          {published ? (
            <span role="status" className="text-status-positive-fg text-sm">
              {t("publish.published")}
            </span>
          ) : null}
        </div>
      </ScreenSection>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {/*
        Przełącznik kolumn na wąskim ekranie (kreator A3). Na desktopie obie
        kolumny stoją obok siebie i przełącznik znika — `lg:hidden`, żeby nie
        udawał wyboru tam, gdzie wyboru nie ma. Poniżej `lg` podgląd w ramce
        zająłby cały ekran nad edytorem, więc kolumny wykluczają się wzajemnie.
      */}
      <div
        role="group"
        aria-label={t("preview.viewLabel")}
        data-preview-view={mobileView}
        className="flex items-center gap-1 lg:hidden"
      >
        {(["edit", "preview"] as const).map((view) => (
          <Button
            key={view}
            type="button"
            size="sm"
            variant={mobileView === view ? "default" : "secondary"}
            aria-pressed={mobileView === view}
            onClick={() => setMobileView(view)}
          >
            {t(`preview.view_${view}`)}
          </Button>
        ))}
      </div>

      <div data-site-editor-layout className="grid gap-6 lg:grid-cols-2">
        <FormMeasure
          data-site-editor-controls
          className={cn(
            "flex min-w-0 flex-col gap-4",
            mobileView === "preview" && "max-lg:hidden",
          )}
        >
          <ScreenSection data-template-form title={t("template.heading")}>
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-2 text-sm font-medium">{t("template.legend")}</legend>
              {SITE_TEMPLATES.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="template"
                    value={option}
                    checked={templateChoice === option}
                    disabled={pending}
                    onChange={() => setTemplateChoice(option)}
                  />
                  {t(`template.template_${option}`)}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                loading={pending}
                disabled={pending}
                onClick={() => run(() => updateTemplate(siteId, templateChoice))}
              >
                {t("template.save")}
              </Button>
            </div>
          </ScreenSection>

          <ScreenSection
            data-add-section-form
            title={t("sections.heading")}
            description={t("sections.addHint")}
          >
            <AddSectionDialog
              disabled={pending}
              onAdd={(type) => addSection(type)}
              trigger={
                <Button type="button" variant="secondary" loading={pending} disabled={pending}>
                  {t("sections.add")}
                </Button>
              }
            />
          </ScreenSection>

          {sections.length === 0 ? (
            <ScreenSection data-site-sections-empty description={t("sections.empty")} />
          ) : (
            <SortableSections
              siteId={siteId}
              sections={sections}
              reorderAction={(orderedIds) => reorderSections(siteId, orderedIds)}
              toggleAction={(section) => toggleSection(section.id, !section.enabled)}
              duplicateAction={(sectionId) => duplicateSection(sectionId)}
              deleteAction={(sectionId) => deleteSection(sectionId)}
              onAddSection={addSection}
              onChanged={() => {
                router.refresh();
                refreshPreview();
              }}
              onSectionSaved={(sectionId) => {
                router.refresh();
                refreshPreview(sectionId);
              }}
            />
          )}
        </FormMeasure>

        <div className={cn("min-w-0", mobileView === "edit" && "max-lg:hidden")}>
          <SitePreviewFrame signal={preview.signal} focusSectionId={preview.focus} />
        </div>
      </div>
    </div>
  );
}

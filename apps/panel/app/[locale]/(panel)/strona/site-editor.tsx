"use client";

/**
 * Edytor storefrontu tenanta (Zadanie 2.3b, skóra P8b) — cała interakcja.
 *
 * Układ z mockupu `secondary-site-editor`: DWIE KOLUMNY — po lewej edytor pod
 * wspólną miarą formularza (`data-form-line-measure`, P8a), po prawej PODGLĄD
 * SZKICU. Na wąskim ekranie kolumny idą jedna pod drugą, bo miara zostaje ta
 * sama, a podgląd nie ma z czym konkurować o szerokość.
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
import { SECTION_TYPES, SITE_TEMPLATES, type SectionType, type SiteTemplate } from "@avably/core/site";
import { Button, Label, type StorefrontProduct } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import {
  deleteSection,
  publishSite,
  reorderSections,
  toggleSection,
  updateTemplate,
  upsertSection,
} from "@/lib/actions/site";

import { defaultContentFor, type EditorSection } from "./content";
import { SectionContentForm } from "./section-content-form";
import { SitePreview } from "./site-preview";

type ActionResult = { ok: true } | { ok: false; error: string };

export function SiteEditor({
  siteId,
  template,
  sections,
  previewProducts,
  publishedAtLabel,
}: {
  siteId: string;
  template: SiteTemplate;
  sections: EditorSection[];
  previewProducts: StorefrontProduct[];
  /** Sformatowana data ostatniej publikacji albo null — strona nigdy nie publikowana. */
  publishedAtLabel: string | null;
}) {
  const t = useTranslations("site");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [sectionType, setSectionType] = useState<SectionType>("hero");
  const [templateChoice, setTemplateChoice] = useState<SiteTemplate>(template);

  /** Woła akcję w tranzycji, pokazuje błąd i odświeża RSC po sukcesie. */
  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    setPublished(false);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const order = sections.map((s) => s.id);
    [order[index], order[target]] = [order[target]!, order[index]!];
    run(() => reorderSections(siteId, order));
  }

  function addSection(type: SectionType) {
    run(() =>
      upsertSection({ siteId, type, content: defaultContentFor(type) } as Parameters<typeof upsertSection>[0]),
    );
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

      <div data-site-editor-layout className="grid gap-6 lg:grid-cols-2">
        <FormMeasure data-site-editor-controls className="flex min-w-0 flex-col gap-4">
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
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-section-type">{t("sections.addType")}</Label>
                <PanelSelect
                  id="add-section-type"
                  value={sectionType}
                  disabled={pending}
                  onValueChange={(value) => setSectionType(value as SectionType)}
                  options={SECTION_TYPES.map((type) => ({
                    value: type,
                    label: t(`sectionTypes.${type}`),
                  }))}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => addSection(sectionType)}
              >
                {t("sections.add")}
              </Button>
            </div>
          </ScreenSection>

          {sections.length === 0 ? (
            <ScreenSection data-site-sections-empty description={t("sections.empty")} />
          ) : (
            <ol data-site-sections className="flex list-none flex-col gap-4 p-0">
              {sections.map((section, index) => (
                <li
                  key={section.id}
                  data-section-type={section.type}
                  data-section-order={index + 1}
                  className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5"
                >
                  <header className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base leading-[22px] font-semibold">
                      {`${String(index + 1).padStart(2, "0")} · ${t(`sectionTypes.${section.type}`)}`}
                    </h3>
                    <SecondaryStatusChip
                      axis="site-section"
                      value={section.enabled ? "enabled" : "disabled"}
                    />
                  </header>
                  <SectionContentForm
                    siteId={siteId}
                    section={section}
                    actions={
                      <>
                        <RowButton
                          label={t("sections.moveUp")}
                          disabled={pending || index === 0}
                          onClick={() => move(index, -1)}
                        />
                        <RowButton
                          label={t("sections.moveDown")}
                          disabled={pending || index === sections.length - 1}
                          onClick={() => move(index, 1)}
                        />
                        <RowButton
                          label={section.enabled ? t("sections.disable") : t("sections.enable")}
                          disabled={pending}
                          onClick={() => run(() => toggleSection(section.id, !section.enabled))}
                        />
                        <RowButton
                          label={t("sections.remove")}
                          variant="destructive"
                          disabled={pending}
                          onClick={() => run(() => deleteSection(section.id))}
                        />
                      </>
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </FormMeasure>

        <SitePreview sections={sections} template={template} products={previewProducts} />
      </div>
    </div>
  );
}

/** Akcja wiersza sekcji (kolejność, włączenie, usunięcie) — jeden rozmiar dla całego rzędu. */
function RowButton({
  label,
  onClick,
  disabled,
  variant = "secondary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "secondary" | "destructive";
}) {
  return (
    <Button type="button" size="sm" variant={variant} onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
}

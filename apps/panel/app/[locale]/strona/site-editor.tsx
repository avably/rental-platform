"use client";

/**
 * Edytor storefrontu tenanta (Zadanie 2.3b) — cała interakcja + podgląd draftu.
 *
 * Woła akcje modelu sekcyjnego 2.3a (RPC-style, zwrot `SiteActionResult`) przez
 * `useTransition`; po sukcesie akcje robią `revalidatePath`, więc serwerowa
 * strona przeładowuje świeży draft i przekazuje go tu w propsach. PODGLĄD
 * renderuje TE SAME komponenty co storefront (`@avably/ui` SiteRenderer) na
 * włączonych sekcjach draftu — operator widzi zmianę zanim ją opublikuje, a anon
 * dopiero po „Publikuj" (storefront czyta content_published).
 */
import { SECTION_TYPES, SITE_TEMPLATES, type SectionType, type SiteTemplate } from "@avably/core/site";
import { SiteRenderer, type StorefrontProduct } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteSection,
  publishSite,
  reorderSections,
  toggleSection,
  updateTemplate,
  upsertSection,
} from "@/lib/actions/site";

import { defaultContentFor, previewSections, type EditorSection } from "./content";
import { SectionContentForm } from "./section-content-form";

type ActionResult = { ok: true } | { ok: false; error: string };

export function SiteEditor({
  siteId,
  template,
  sections,
  previewProducts,
}: {
  siteId: string;
  template: SiteTemplate;
  sections: EditorSection[];
  previewProducts: StorefrontProduct[];
}) {
  const t = useTranslations("site");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

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
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-gray-600">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(() => publishSite(siteId), () => setPublished(true))}
            disabled={pending}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? t("publish.publishing") : t("publish.publish")}
          </button>
          {published ? (
            <span role="status" className="text-sm text-green-700">
              {t("publish.published")}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Kolumna edycji */}
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-base font-semibold">{t("template.heading")}</h2>
            <div className="flex gap-4">
              {SITE_TEMPLATES.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="template"
                    value={option}
                    checked={template === option}
                    disabled={pending}
                    onChange={() => run(() => updateTemplate(siteId, option))}
                  />
                  {t(`template.template_${option}`)}
                </label>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{t("sections.heading")}</h2>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="add-section-type">
                  {t("sections.addType")}
                </label>
                <select
                  id="add-section-type"
                  className="rounded-md border px-2 py-1 text-sm"
                  defaultValue="freeform"
                  disabled={pending}
                  onChange={(e) => {
                    addSection(e.target.value as SectionType);
                    e.target.value = "freeform";
                  }}
                >
                  {SECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`sectionTypes.${type}`)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-500">{t("sections.addHint")}</span>
              </div>
            </div>

            {sections.length === 0 ? (
              <p className="text-sm text-gray-600">{t("sections.empty")}</p>
            ) : (
              <ol className="flex list-none flex-col gap-4 p-0">
                {sections.map((section, index) => (
                  <li key={section.id} className="flex flex-col gap-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
                          {t(`sectionTypes.${section.type}`)}
                        </span>
                        {!section.enabled ? (
                          <span className="text-xs text-amber-700">{t("sections.disabled")}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <ControlButton label={t("sections.moveUp")} disabled={pending || index === 0} onClick={() => move(index, -1)} />
                        <ControlButton label={t("sections.moveDown")} disabled={pending || index === sections.length - 1} onClick={() => move(index, 1)} />
                        <ControlButton
                          label={section.enabled ? t("sections.disable") : t("sections.enable")}
                          disabled={pending}
                          onClick={() => run(() => toggleSection(section.id, !section.enabled))}
                        />
                        <ControlButton label={t("sections.remove")} disabled={pending} onClick={() => run(() => deleteSection(section.id))} />
                      </div>
                    </div>
                    <SectionContentForm siteId={siteId} section={section} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Kolumna podglądu */}
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("preview.heading")}</h2>
          <p className="text-sm text-gray-600">{t("preview.intro")}</p>
          <div className="overflow-hidden rounded-lg border">
            {previewSections(sections).length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-600">{t("preview.empty")}</p>
            ) : (
              <SiteRenderer sections={previewSections(sections)} template={template} products={previewProducts} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
    >
      {label}
    </button>
  );
}

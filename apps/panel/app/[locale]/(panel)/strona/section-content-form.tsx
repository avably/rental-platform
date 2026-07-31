"use client";

/**
 * Formularz treści JEDNEJ sekcji (Zadanie 2.3b + kreator A2), zależny od typu.
 *
 * Pola żyją w stanie klienta i składają się w obiekt treści o kształcie z
 * `@avably/core/site`; zapis woła `upsertSection`. Pola PUSTE opcjonalne są
 * POMIJANE (schematy core wymagają min. 1 znaku). Sekcje z pozycjami
 * (testimonials/gallery/usp/delivery) trzymają PŁASKĄ tablicę bloków z prostymi
 * kontrolkami dodaj/usuń/kolejność — DND bloków to etap C1, nie tu. Zdjęcia
 * (hero, galeria) idą przez podpisany upload (ImageField → runSiteImageUpload),
 * a do treści trafia WYŁĄCZNIE ścieżka Storage.
 */
import { USP_ICONS, type UspIcon } from "@avably/core/site";
import { Button, FileField, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { upsertSection } from "@/lib/actions/site";
import { siteImagePublicBase } from "@/lib/site-image-base";

import type { EditorSection } from "./content";
import {
  finalizeSiteImageUploadAction,
  prepareSiteImageUploadAction,
} from "./upload-actions";
import { runSiteImageUpload, uploadSiteImageToSignedUrl } from "./upload-flow";

interface FaqRow {
  key: number;
  q: string;
  a: string;
}

/** Wciąga niepusty, przycięty string do obiektu treści pod danym kluczem. */
function put(target: Record<string, unknown>, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed !== "") target[key] = trimmed;
}

/** Domyślny alt zdjęcia z nazwy pliku (bez rozszerzenia) — a11y bez pustki. */
function fileNameToAlt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || name;
}

/** Lista pozycji sekcji ze stabilnym kluczem React + dodaj/usuń/przenieś. */
interface ListApi<T> {
  rows: (T & { key: number })[];
  add: (item: T) => void;
  update: (key: number, patch: Partial<T>) => void;
  remove: (key: number) => void;
  move: (key: number, direction: -1 | 1) => void;
}

function useList<T>(initial: () => T[]): ListApi<T> {
  const [rows, setRows] = useState<(T & { key: number })[]>(() =>
    initial().map((item, index) => ({ ...item, key: index })),
  );
  const nextKey = useRef(rows.length);
  return {
    rows,
    add: (item) => setRows((r) => [...r, { ...item, key: nextKey.current++ }]),
    update: (key, patch) =>
      setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row))),
    remove: (key) => setRows((r) => r.filter((row) => row.key !== key)),
    move: (key, direction) =>
      setRows((r) => {
        const index = r.findIndex((row) => row.key === key);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= r.length) return r;
        const copy = r.slice();
        [copy[index], copy[target]] = [copy[target], copy[index]];
        return copy;
      }),
  };
}

export function SectionContentForm({
  siteId,
  section,
  actions,
  onSaved,
}: {
  siteId: string;
  section: EditorSection;
  actions?: ReactNode;
  /**
   * Udany zapis treści — sygnał dla podglądu na żywo (kreator A3), który
   * przeładowuje ramkę i przewija ją do tej sekcji. Opcjonalny, bo formularz
   * bywa renderowany bez podglądu (testy kontraktu ekranu).
   */
  onSaved?: () => void;
}) {
  const t = useTranslations("site.fields");
  const idPrefix = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const content = section.content as Record<string, unknown>;
  const initial = (key: string): string => {
    const value = content[key];
    return typeof value === "string" ? value : "";
  };
  const items = Array.isArray(content.items) ? (content.items as Record<string, unknown>[]) : [];
  const str = (value: unknown): string => (typeof value === "string" ? value : "");

  const [fields, setFields] = useState<Record<string, string>>(() => ({
    heading: initial("heading"),
    subheading: initial("subheading"),
    note: initial("note"),
    body: initial("body"),
    ctaText: initial("ctaText"),
    ctaHref: initial("ctaHref"),
    address: initial("address"),
    phone: initial("phone"),
    email: initial("email"),
    mapQuery: initial("mapQuery"),
    text: initial("text"),
    buttonLabel: initial("buttonLabel"),
    buttonHref: initial("buttonHref"),
    mapsUrl: initial("mapsUrl"),
    hours: initial("hours"),
  }));
  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const [heroImage, setHeroImage] = useState<string>(() => initial("imagePath"));

  const [faq, setFaq] = useState<FaqRow[]>(() =>
    (section.type === "faq" ? items : []).map((item, index) => ({
      key: index,
      q: str(item.q),
      a: str(item.a),
    })),
  );
  const [faqKey, setFaqKey] = useState(faq.length);

  const testimonials = useList(() =>
    (section.type === "testimonials" ? items : []).map((item) => ({
      quote: str(item.quote),
      author: str(item.author),
      role: str(item.role),
    })),
  );
  const gallery = useList(() =>
    (section.type === "gallery" ? items : []).map((item) => ({
      imagePath: str(item.imagePath),
      alt: str(item.alt),
    })),
  );
  const usp = useList(() =>
    (section.type === "usp" ? items : []).map((item) => ({
      icon: (USP_ICONS as readonly string[]).includes(str(item.icon))
        ? (str(item.icon) as UspIcon)
        : ("truck" as UspIcon),
      title: str(item.title),
      text: str(item.text),
    })),
  );
  const delivery = useList(() =>
    (section.type === "delivery" ? items : []).map((item) => ({
      title: str(item.title),
      text: str(item.text),
    })),
  );

  function buildContent(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    switch (section.type) {
      case "hero":
        put(c, "heading", fields.heading);
        put(c, "subheading", fields.subheading);
        put(c, "ctaText", fields.ctaText);
        put(c, "ctaHref", fields.ctaHref);
        if (heroImage.trim() !== "") c.imagePath = heroImage.trim();
        break;
      case "products":
        put(c, "heading", fields.heading);
        break;
      case "pricing":
        put(c, "heading", fields.heading);
        put(c, "note", fields.note);
        break;
      case "contact":
        put(c, "heading", fields.heading);
        put(c, "address", fields.address);
        put(c, "phone", fields.phone);
        put(c, "email", fields.email);
        put(c, "mapQuery", fields.mapQuery);
        break;
      case "freeform":
        put(c, "heading", fields.heading);
        put(c, "body", fields.body);
        break;
      case "faq":
        put(c, "heading", fields.heading);
        c.items = faq
          .filter((row) => row.q.trim() !== "" || row.a.trim() !== "")
          .map((row) => ({ q: row.q.trim(), a: row.a.trim() }));
        break;
      case "testimonials":
        put(c, "heading", fields.heading);
        c.items = testimonials.rows
          .filter((row) => row.quote.trim() !== "" && row.author.trim() !== "")
          .map((row) => {
            const entry: Record<string, string> = { quote: row.quote.trim(), author: row.author.trim() };
            if (row.role.trim() !== "") entry.role = row.role.trim();
            return entry;
          });
        break;
      case "gallery":
        put(c, "heading", fields.heading);
        c.items = gallery.rows
          .filter((row) => row.imagePath.trim() !== "")
          .map((row) => ({
            imagePath: row.imagePath.trim(),
            alt: row.alt.trim() !== "" ? row.alt.trim() : (row.imagePath.split("/").pop() ?? row.imagePath),
          }));
        break;
      case "usp":
        put(c, "heading", fields.heading);
        c.items = usp.rows
          .filter((row) => row.title.trim() !== "" && row.text.trim() !== "")
          .map((row) => ({ icon: row.icon, title: row.title.trim(), text: row.text.trim() }));
        break;
      case "cta":
        put(c, "heading", fields.heading);
        put(c, "text", fields.text);
        put(c, "buttonLabel", fields.buttonLabel);
        put(c, "buttonHref", fields.buttonHref);
        break;
      case "directions":
        put(c, "address", fields.address);
        put(c, "mapsUrl", fields.mapsUrl);
        put(c, "hours", fields.hours);
        break;
      case "delivery": {
        put(c, "heading", fields.heading);
        put(c, "text", fields.text);
        const rows = delivery.rows
          .filter((row) => row.title.trim() !== "" && row.text.trim() !== "")
          .map((row) => ({ title: row.title.trim(), text: row.text.trim() }));
        if (rows.length > 0) c.items = rows;
        break;
      }
    }
    return c;
  }

  function save() {
    setError(null);
    setSaved(false);
    const built = buildContent();
    startTransition(async () => {
      const result = await upsertSection({
        siteId,
        sectionId: section.id,
        type: section.type,
        content: built,
      } as Parameters<typeof upsertSection>[0]);
      if (result.ok) {
        setSaved(true);
        onSaved?.();
      } else setError(result.error);
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {section.type !== "directions" ? (
        <Field label={t(section.type === "hero" ? "heroHeading" : "heading")} htmlFor={`${idPrefix}-heading`}>
          <Input id={`${idPrefix}-heading`} value={fields.heading} onChange={(e) => set("heading", e.target.value)} />
        </Field>
      ) : null}

      {section.type === "hero" ? (
        <>
          <Field label={t("subheading")} htmlFor={`${idPrefix}-sub`}>
            <Textarea id={`${idPrefix}-sub`} value={fields.subheading} onChange={(e) => set("subheading", e.target.value)} />
          </Field>
          <InlineFields>
            <Field label={t("ctaText")} htmlFor={`${idPrefix}-ctat`}>
              <Input id={`${idPrefix}-ctat`} value={fields.ctaText} onChange={(e) => set("ctaText", e.target.value)} />
            </Field>
            <Field label={t("ctaHref")} htmlFor={`${idPrefix}-ctah`}>
              <Input id={`${idPrefix}-ctah`} value={fields.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} placeholder="/cennik, #kontakt lub https://…" />
            </Field>
          </InlineFields>
          <Field label={t("image")} htmlFor={`${idPrefix}-hero-image`}>
            <ImageField
              siteId={siteId}
              value={heroImage}
              disabled={pending}
              onUploaded={(path) => setHeroImage(path)}
              onClear={() => setHeroImage("")}
            />
          </Field>
        </>
      ) : null}

      {section.type === "pricing" ? (
        <Field label={t("note")} htmlFor={`${idPrefix}-note`}>
          <Textarea id={`${idPrefix}-note`} value={fields.note} onChange={(e) => set("note", e.target.value)} />
        </Field>
      ) : null}

      {section.type === "contact" ? (
        <>
          <InlineFields>
            <Field label={t("email")} htmlFor={`${idPrefix}-email`}>
              <Input id={`${idPrefix}-email`} type="email" value={fields.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label={t("phone")} htmlFor={`${idPrefix}-phone`}>
              <Input id={`${idPrefix}-phone`} value={fields.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </InlineFields>
          <Field label={t("address")} htmlFor={`${idPrefix}-addr`}>
            <Textarea id={`${idPrefix}-addr`} value={fields.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label={t("mapQuery")} htmlFor={`${idPrefix}-map`}>
            <Input id={`${idPrefix}-map`} value={fields.mapQuery} onChange={(e) => set("mapQuery", e.target.value)} />
          </Field>
        </>
      ) : null}

      {section.type === "freeform" ? (
        <Field label={t("body")} htmlFor={`${idPrefix}-body`}>
          <Textarea id={`${idPrefix}-body`} rows={5} value={fields.body} onChange={(e) => set("body", e.target.value)} />
        </Field>
      ) : null}

      {section.type === "cta" ? (
        <>
          <Field label={t("text")} htmlFor={`${idPrefix}-ctatext`}>
            <Textarea id={`${idPrefix}-ctatext`} value={fields.text} onChange={(e) => set("text", e.target.value)} />
          </Field>
          <InlineFields>
            <Field label={t("buttonLabel")} htmlFor={`${idPrefix}-blabel`}>
              <Input id={`${idPrefix}-blabel`} value={fields.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} />
            </Field>
            <Field label={t("buttonHref")} htmlFor={`${idPrefix}-bhref`}>
              <Input id={`${idPrefix}-bhref`} value={fields.buttonHref} onChange={(e) => set("buttonHref", e.target.value)} placeholder="/cennik, #kontakt lub https://…" />
            </Field>
          </InlineFields>
        </>
      ) : null}

      {section.type === "directions" ? (
        <>
          <Field label={t("address")} htmlFor={`${idPrefix}-daddr`}>
            <Textarea id={`${idPrefix}-daddr`} value={fields.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <InlineFields>
            <Field label={t("mapsUrl")} htmlFor={`${idPrefix}-maps`}>
              <Input id={`${idPrefix}-maps`} value={fields.mapsUrl} onChange={(e) => set("mapsUrl", e.target.value)} placeholder="https://…" />
            </Field>
            <Field label={t("hours")} htmlFor={`${idPrefix}-hours`}>
              <Input id={`${idPrefix}-hours`} value={fields.hours} onChange={(e) => set("hours", e.target.value)} />
            </Field>
          </InlineFields>
        </>
      ) : null}

      {section.type === "delivery" ? (
        <>
          <Field label={t("text")} htmlFor={`${idPrefix}-dtext`}>
            <Textarea id={`${idPrefix}-dtext`} rows={3} value={fields.text} onChange={(e) => set("text", e.target.value)} />
          </Field>
          <ListEditor legend={t("deliveryItems")} addLabel={t("deliveryAdd")} list={delivery} disabled={pending} newItem={() => ({ title: "", text: "" })}>
            {(row) => (
              <>
                <Input
                  aria-label={t("blockTitle")}
                  placeholder={t("blockTitle")}
                  value={row.title}
                  onChange={(e) => delivery.update(row.key, { title: e.target.value })}
                />
                <Textarea
                  aria-label={t("text")}
                  placeholder={t("text")}
                  value={row.text}
                  onChange={(e) => delivery.update(row.key, { text: e.target.value })}
                />
              </>
            )}
          </ListEditor>
        </>
      ) : null}

      {section.type === "testimonials" ? (
        <ListEditor legend={t("testimonialsItems")} addLabel={t("testimonialsAdd")} list={testimonials} disabled={pending} newItem={() => ({ quote: "", author: "", role: "" })}>
          {(row) => (
            <>
              <Textarea
                aria-label={t("quote")}
                placeholder={t("quote")}
                value={row.quote}
                onChange={(e) => testimonials.update(row.key, { quote: e.target.value })}
              />
              <InlineFields>
                <Input
                  aria-label={t("author")}
                  placeholder={t("author")}
                  value={row.author}
                  onChange={(e) => testimonials.update(row.key, { author: e.target.value })}
                />
                <Input
                  aria-label={t("role")}
                  placeholder={t("role")}
                  value={row.role}
                  onChange={(e) => testimonials.update(row.key, { role: e.target.value })}
                />
              </InlineFields>
            </>
          )}
        </ListEditor>
      ) : null}

      {section.type === "usp" ? (
        <ListEditor legend={t("uspItems")} addLabel={t("uspAdd")} list={usp} disabled={pending} newItem={() => ({ icon: "truck" as UspIcon, title: "", text: "" })}>
          {(row) => (
            <>
              <UspIconSelect
                value={row.icon}
                disabled={pending}
                onChange={(icon) => usp.update(row.key, { icon })}
              />
              <Input
                aria-label={t("blockTitle")}
                placeholder={t("blockTitle")}
                value={row.title}
                onChange={(e) => usp.update(row.key, { title: e.target.value })}
              />
              <Textarea
                aria-label={t("text")}
                placeholder={t("text")}
                value={row.text}
                onChange={(e) => usp.update(row.key, { text: e.target.value })}
              />
            </>
          )}
        </ListEditor>
      ) : null}

      {section.type === "gallery" ? (
        <ListEditor legend={t("galleryItems")} addLabel={t("galleryAdd")} list={gallery} disabled={pending} newItem={() => ({ imagePath: "", alt: "" })}>
          {(row) => (
            <>
              <ImageField
                siteId={siteId}
                value={row.imagePath}
                disabled={pending}
                onUploaded={(path, file) =>
                  gallery.update(row.key, {
                    imagePath: path,
                    ...(row.alt.trim() === "" ? { alt: fileNameToAlt(file.name) } : {}),
                  })
                }
                onClear={() => gallery.update(row.key, { imagePath: "" })}
              />
              <Input
                aria-label={t("alt")}
                placeholder={t("alt")}
                value={row.alt}
                onChange={(e) => gallery.update(row.key, { alt: e.target.value })}
              />
            </>
          )}
        </ListEditor>
      ) : null}

      {section.type === "faq" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="pb-2 text-sm font-medium">{t("faqItems")}</legend>
          {faq.map((row) => (
            <div key={row.key} data-faq-row className="border-border flex flex-col gap-2 rounded-md border p-3">
              <Input
                aria-label={t("faqQuestion")}
                placeholder={t("faqQuestion")}
                value={row.q}
                onChange={(e) => setFaq((rows) => rows.map((r) => (r.key === row.key ? { ...r, q: e.target.value } : r)))}
              />
              <Textarea
                aria-label={t("faqAnswer")}
                placeholder={t("faqAnswer")}
                value={row.a}
                onChange={(e) => setFaq((rows) => rows.map((r) => (r.key === row.key ? { ...r, a: e.target.value } : r)))}
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="self-end"
                onClick={() => setFaq((rows) => rows.filter((r) => r.key !== row.key))}
              >
                {t("faqRemove")}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => {
              setFaq((rows) => [...rows, { key: faqKey, q: "", a: "" }]);
              setFaqKey((k) => k + 1);
            }}
          >
            {t("faqAdd")}
          </Button>
        </fieldset>
      ) : null}

      <div data-section-actions className="flex flex-wrap items-center gap-2 pt-1">
        {actions}
        <Button type="submit" size="sm" loading={pending} disabled={pending}>
          {pending ? t("saving") : t("saveSection")}
        </Button>
        {saved ? (
          <span role="status" className="text-status-positive-fg text-sm">
            {t("saved")}
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Dwa krótkie pola w jednym wierszu (mockup: `secondary-inline-fields`). */
function InlineFields({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** Wybór ikony USP z allowlisty (etykiety z i18n site.uspIcons). */
function UspIconSelect({
  value,
  onChange,
  disabled,
}: {
  value: UspIcon;
  onChange: (icon: UspIcon) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("site.uspIcons");
  const tf = useTranslations("site.fields");
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{tf("icon")}</Label>
      <PanelSelect
        id={id}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as UspIcon)}
        options={USP_ICONS.map((icon) => ({ value: icon, label: t(icon) }))}
      />
    </div>
  );
}

/**
 * Lista pozycji sekcji: render-prop na pola pozycji + wiersz akcji
 * (wyżej/niżej/usuń) + przycisk dodania. Reorder to proste strzałki — DND
 * bloków przyjdzie w C1 (ADR-082).
 */
function ListEditor<T>({
  legend,
  addLabel,
  list,
  newItem,
  disabled,
  children,
}: {
  legend: string;
  addLabel: string;
  list: ListApi<T>;
  newItem: () => T;
  disabled?: boolean;
  children: (row: T & { key: number }, index: number, total: number) => ReactNode;
}) {
  const t = useTranslations("site.fields");
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="pb-2 text-sm font-medium">{legend}</legend>
      {list.rows.map((row, index) => (
        <div key={row.key} data-list-row className="border-border flex flex-col gap-2 rounded-md border p-3">
          {children(row, index, list.rows.length)}
          <div className="flex flex-wrap gap-2 self-end">
            <Button type="button" size="sm" variant="secondary" disabled={disabled || index === 0} onClick={() => list.move(row.key, -1)}>
              {t("itemMoveUp")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={disabled || index === list.rows.length - 1} onClick={() => list.move(row.key, 1)}>
              {t("itemMoveDown")}
            </Button>
            <Button type="button" size="sm" variant="destructive" disabled={disabled} onClick={() => list.remove(row.key)}>
              {t("itemRemove")}
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" className="self-start" disabled={disabled} onClick={() => list.add(newItem())}>
        {addLabel}
      </Button>
    </fieldset>
  );
}

/**
 * Pole zdjęcia sekcji: FileField → podpisany upload (issue/sign/upload/finish),
 * po sukcesie do treści trafia WYŁĄCZNIE ścieżka Storage. Miniatura z
 * publicznego URL-a; `key={value}` remontuje FileField po uploadzie/usunięciu.
 */
function ImageField({
  siteId,
  value,
  onUploaded,
  onClear,
  disabled,
}: {
  siteId: string;
  value: string;
  onUploaded: (path: string, file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("site.fields");
  const tErr = useTranslations("site.images.errors");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const base = siteImagePublicBase();

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const outcome = await runSiteImageUpload(file, {
      prepare: (input) => prepareSiteImageUploadAction(siteId, input),
      upload: uploadSiteImageToSignedUrl,
      finalize: finalizeSiteImageUploadAction,
      message: (problem) => tErr(problem),
    });
    setUploading(false);
    if (outcome.ok) onUploaded(outcome.path, file);
    else setError(outcome.error);
  }

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- miniatura z publicznego Storage, jak karta produktu */}
          <img src={`${base}/${value}`} alt="" className="border-border size-16 shrink-0 rounded-md border object-cover" />
          <Button type="button" size="sm" variant="secondary" disabled={disabled || uploading} onClick={onClear}>
            {t("imageClear")}
          </Button>
        </div>
      ) : null}
      <FileField
        key={value || "empty"}
        id={fieldId}
        prompt={uploading ? t("imageUploading") : t("imagePrompt")}
        hint={t("imageHint")}
        removeLabel={t("imageFieldRemove")}
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={disabled || uploading}
        error={error ?? undefined}
        onChange={(e) => void handleFile(e.currentTarget.files?.[0] ?? null)}
      />
    </div>
  );
}

"use client";

/**
 * Formularz treści JEDNEJ sekcji (Zadanie 2.3b), zależny od jej typu. Pola żyją
 * w stanie klienta i składają się w obiekt treści o kształcie z
 * `@avably/core/site`; zapis woła akcję `upsertSection` (2.3a) — pola PUSTE
 * opcjonalne są POMIJANE (schematy core wymagają min. 1 znaku, więc „" nie jest
 * poprawną wartością opcjonalną, tylko jej brakiem).
 */
import { Button, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition, type ReactNode } from "react";

import { upsertSection } from "@/lib/actions/site";

import type { EditorSection } from "./content";

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

export function SectionContentForm({
  siteId,
  section,
}: {
  siteId: string;
  section: EditorSection;
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
  }));

  const [faq, setFaq] = useState<FaqRow[]>(() => {
    const items = Array.isArray(content.items) ? (content.items as { q?: string; a?: string }[]) : [];
    return items.map((item, index) => ({ key: index, q: item.q ?? "", a: item.a ?? "" }));
  });
  const [faqKey, setFaqKey] = useState(faq.length);

  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  function buildContent(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    switch (section.type) {
      case "hero":
        put(c, "heading", fields.heading);
        put(c, "subheading", fields.subheading);
        put(c, "ctaText", fields.ctaText);
        put(c, "ctaHref", fields.ctaHref);
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
    }
    return c;
  }

  function save() {
    setError(null);
    setSaved(false);
    const content = buildContent();
    startTransition(async () => {
      const result = await upsertSection({
        siteId,
        sectionId: section.id,
        type: section.type,
        content,
        // Rzut na wejście akcji: kształt treści waliduje Zod w akcji (core/site).
      } as Parameters<typeof upsertSection>[0]);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t(section.type === "hero" ? "heroHeading" : "heading")} htmlFor={`${idPrefix}-heading`}>
        <Input id={`${idPrefix}-heading`} value={fields.heading} onChange={(e) => set("heading", e.target.value)} />
      </Field>

      {section.type === "hero" ? (
        <>
          <Field label={t("subheading")} htmlFor={`${idPrefix}-sub`}>
            <Textarea id={`${idPrefix}-sub`} value={fields.subheading} onChange={(e) => set("subheading", e.target.value)} />
          </Field>
          <Field label={t("ctaText")} htmlFor={`${idPrefix}-ctat`}>
            <Input id={`${idPrefix}-ctat`} value={fields.ctaText} onChange={(e) => set("ctaText", e.target.value)} />
          </Field>
          <Field label={t("ctaHref")} htmlFor={`${idPrefix}-ctah`}>
            <Input id={`${idPrefix}-ctah`} value={fields.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} placeholder="/cennik, #kontakt lub https://…" />
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
          <Field label={t("email")} htmlFor={`${idPrefix}-email`}>
            <Input id={`${idPrefix}-email`} value={fields.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label={t("phone")} htmlFor={`${idPrefix}-phone`}>
            <Input id={`${idPrefix}-phone`} value={fields.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
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

      {section.type === "faq" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t("faqItems")}</legend>
          {faq.map((row) => (
            <div key={row.key} className="flex flex-col gap-2 rounded-md border p-3">
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
                variant="ghost"
                className="self-end"
                onClick={() => setFaq((rows) => rows.filter((r) => r.key !== row.key))}
              >
                {t("faqRemove")}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
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

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-status-positive-fg">
          {t("saved")}
        </p>
      ) : null}

      <Button type="button" onClick={save} disabled={pending} className="self-start">
        {pending ? t("saving") : t("saveSection")}
      </Button>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

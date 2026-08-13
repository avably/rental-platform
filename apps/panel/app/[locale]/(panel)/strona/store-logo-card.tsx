"use client";

/**
 * KARTA „LOGO SKLEPU" (ADR-160) na ekranie stron sklepu.
 *
 * DLACZEGO TU, A NIE W KREATORZE ANI W ORGANIZACJI. Znak jest własnością
 * NAJEMCY, więc nie może mieszkać w kreatorze KONKRETNEJ strony — najemca ma
 * ich wiele, a znak jeden. Ekran organizacji jest z decyzji ADR-059 wyłącznie
 * do odczytu, więc formularz nie ma tam czego szukać. Zostaje ekran, który
 * odpowiada na pytanie „jak wygląda mój sklep" i jest go dokładnie jeden.
 *
 * DWA STANY, KTÓRE MUSZĄ BYĆ WIDOCZNE, bo bez nich karta kłamie:
 *   1. co widzi KLIENT (`logo_published`),
 *   2. że wgrany znak CZEKA na publikację (szkic różny od bliźniaka).
 * To ta sama zasada, którą lista stron stosuje do adresu: zmiana widoczna
 * w panelu nie jest zmianą widoczną w sklepie, dopóki nie padnie publikacja.
 *
 * Brak logo NIE jest błędem — karta zaprasza do wgrania i nie rysuje żadnego
 * ostrzeżenia, a sklep bez znaku wygląda tak, jak wyglądał.
 */
import { Button, Checkbox, FileField, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { siteImagePublicBase } from "@/lib/site-image-base";

import {
  finalizeTenantLogoUploadAction,
  prepareTenantLogoUploadAction,
  publishTenantLogoAction,
  saveTenantLogoAction,
} from "./logo-actions";
import { runTenantLogoUpload, uploadSiteImageToSignedUrl } from "./logo-flow";

export interface StoreLogoState {
  /** Znak w szkicu (`tenants.logo_draft`) — `null` znaczy „brak". */
  draft: { path: string; alt?: string; inFooter: boolean } | null;
  /** Znak, który widzi klient (`tenants.logo_published`). */
  published: { path: string; alt?: string; inFooter: boolean } | null;
}

function sameLogo(a: StoreLogoState["draft"], b: StoreLogoState["published"]): boolean {
  if (a === null || b === null) return a === b;
  return a.path === b.path && (a.alt ?? "") === (b.alt ?? "") && a.inFooter === b.inFooter;
}

export function StoreLogoCard({ state }: { state: StoreLogoState }) {
  const t = useTranslations("site.logo");
  const tErr = useTranslations("site.logo.errors");
  const base = siteImagePublicBase();

  const [draft, setDraft] = useState(state.draft);
  const [published, setPublished] = useState(state.published);
  const [alt, setAlt] = useState(state.draft?.alt ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldId = useId();
  const altId = useId();

  const dirty = !sameLogo(draft, published);
  const busy = pending || uploading;

  function save(next: StoreLogoState["draft"]) {
    setError(null);
    startTransition(async () => {
      const result = await saveTenantLogoAction(next);
      if (result.ok) setDraft(next);
      else setError(result.error);
    });
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const outcome = await runTenantLogoUpload(file, {
      prepare: prepareTenantLogoUploadAction,
      upload: uploadSiteImageToSignedUrl,
      finalize: finalizeTenantLogoUploadAction,
      message: (problem) => tErr(problem),
    });
    setUploading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    save({ path: outcome.path, ...(alt.trim() ? { alt: alt.trim() } : {}), inFooter: draft?.inFooter ?? true });
  }

  function publish() {
    setError(null);
    startTransition(async () => {
      const result = await publishTenantLogoAction();
      if (result.ok) setPublished(draft);
      else setError(result.error);
    });
  }

  return (
    <section
      data-store-logo
      data-store-logo-state={draft ? (dirty ? "pending" : "live") : "empty"}
      className="border-border flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("subtitle")}</p>
      </div>

      {draft ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- miniatura z publicznego Storage, jak zdjęcie sekcji */}
          <img
            data-store-logo-preview
            src={`${base}/${draft.path}`}
            alt=""
            className="border-border size-16 shrink-0 rounded-md border object-contain p-1"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => save(null)}
          >
            {t("remove")}
          </Button>
        </div>
      ) : null}

      <FileField
        key={draft?.path ?? "empty"}
        id={fieldId}
        prompt={uploading ? t("uploading") : draft ? t("replace") : t("prompt")}
        hint={t("hint")}
        removeLabel={t("fieldRemove")}
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={busy}
        error={error ?? undefined}
        onChange={(e) => void handleFile(e.currentTarget.files?.[0] ?? null)}
      />

      {draft ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={altId}>{t("altLabel")}</Label>
            <Input
              id={altId}
              value={alt}
              maxLength={120}
              disabled={busy}
              placeholder={t("altPlaceholder")}
              onChange={(e) => setAlt(e.currentTarget.value)}
              onBlur={() => {
                const next = alt.trim();
                if ((draft.alt ?? "") === next) return;
                save({ ...draft, ...(next ? { alt: next } : { alt: undefined }) });
              }}
            />
            <p className="text-muted-foreground text-[13px] leading-[18px]">{t("altHint")}</p>
          </div>

          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={draft.inFooter}
              disabled={busy}
              onCheckedChange={(value) => save({ ...draft, inFooter: value === true })}
            />
            {t("inFooter")}
          </Label>
        </div>
      ) : null}

      {/*
        JEDNO WGRANIE, DWA MIEJSCA UŻYCIA — i JEDNA publikacja. Zdanie o stanie
        stoi przy przycisku, bo to ono odpowiada na pytanie „dlaczego klient
        jeszcze tego nie widzi".
      */}
      {dirty ? (
        <div className="flex flex-wrap items-center gap-3">
          <p data-store-logo-pending className="text-muted-foreground text-[13px] leading-[18px]">
            {t("pending")}
          </p>
          <Button type="button" size="sm" disabled={busy} onClick={publish}>
            {t("publish")}
          </Button>
        </div>
      ) : draft ? (
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("live")}</p>
      ) : null}

      {error ? (
        <p data-store-logo-error className="text-destructive text-[13px] leading-[18px]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

"use client";

/**
 * PICKER ZDJĘCIA (K3, ADR-086) — dwie karty, dwa światy.
 *
 * „Wgraj" jedzie ISTNIEJĄCYM torem biletów (ADR-082): przygotowanie uploadu,
 * wysyłka bajtów wprost do podpisanego adresu, finalizacja. Nie budujemy tu
 * drugiego toru — zdjęcia sekcji i zdjęcia elementów lądują w tym samym
 * buckecie, z tą samą walidacją formatu i rozmiaru.
 *
 * „Zdjęcia z sieci" pyta nasz serwer (klucz dostawcy nigdy nie schodzi do
 * przeglądarki). Karta ISTNIEJE TYLKO wtedy, gdy klucz jest skonfigurowany —
 * brak klucza to normalny stan wdrożenia, a nie awaria, więc operator widzi
 * wtedy jedną kartę zamiast drugiej, zepsutej. Wybór zdjęcia woła wyzwalacz
 * pobrania u dostawcy (warunek regulaminu), a atrybucja autora jedzie razem
 * z treścią i renderuje się przy zdjęciu.
 */
import type { ImageSource } from "@avably/core/site";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FileField,
  Input,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";

import {
  finalizeSiteImageUploadAction,
  prepareSiteImageUploadAction,
} from "@/app/[locale]/(panel)/strona/upload-actions";
import { runSiteImageUpload, uploadSiteImageToSignedUrl } from "@/app/[locale]/(panel)/strona/upload-flow";
import { confirmPhotoChoice, photoSearchAvailable, searchPhotos } from "@/lib/actions/site-images";
import type { UnsplashPhoto } from "@/lib/unsplash";

type PickerTab = "upload" | "search";

export function ImagePicker({
  siteId,
  open,
  onClose,
  onPick,
}: {
  siteId: string;
  open: boolean;
  onClose: () => void;
  /** Wybrane źródło + proponowany opis alternatywny (operator może go poprawić). */
  onPick: (source: ImageSource, alt?: string) => void;
}) {
  const t = useTranslations("site");
  const [tab, setTab] = useState<PickerTab>("upload");
  const [searchAvailable, setSearchAvailable] = useState(false);

  // Dostępność wyszukiwarki rozstrzyga SERWER (klucz nie schodzi do klienta),
  // więc pytamy o nią przy otwarciu, a nie zgadujemy ze zmiennej publicznej.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void photoSearchAvailable().then((available) => {
      if (!cancelled) setSearchAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent data-image-picker className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("picker.title")}</DialogTitle>
          <DialogDescription>{t("picker.description")}</DialogDescription>
        </DialogHeader>

        {searchAvailable ? (
          <div role="tablist" aria-label={t("picker.title")} className="border-border flex gap-1 rounded-md border p-1">
            {(["upload", "search"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                data-picker-tab={value}
                onClick={() => setTab(value)}
                className={`focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex-1 cursor-pointer rounded-sm border border-transparent px-3 py-1.5 text-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
                  tab === value ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(value === "upload" ? "picker.tabUpload" : "picker.tabSearch")}
              </button>
            ))}
          </div>
        ) : null}

        {tab === "upload" || !searchAvailable ? (
          <UploadCard siteId={siteId} onPick={onPick} />
        ) : (
          <SearchCard onPick={onPick} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadCard({
  siteId,
  onPick,
}: {
  siteId: string;
  onPick: (source: ImageSource, alt?: string) => void;
}) {
  const t = useTranslations("site.fields");
  const tErr = useTranslations("site.images.errors");
  const fieldId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    // TEN SAM tor biletów, co pole zdjęcia sekcji (ADR-082) — nie budujemy
    // drugiego kanału uploadu dla elementów.
    const outcome = await runSiteImageUpload(file, {
      prepare: (input) => prepareSiteImageUploadAction(siteId, input),
      upload: uploadSiteImageToSignedUrl,
      finalize: finalizeSiteImageUploadAction,
      message: (problem) => tErr(problem),
    });
    setUploading(false);
    if (outcome.ok) onPick({ kind: "storage", path: outcome.path }, altFromFileName(file.name));
    else setError(outcome.error);
  }

  return (
    <div data-picker-upload className="flex flex-col gap-3">
      <FileField
        id={fieldId}
        prompt={uploading ? t("imageUploading") : t("imagePrompt")}
        hint={t("imageHint")}
        removeLabel={t("imageFieldRemove")}
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={uploading}
        error={error ?? undefined}
        onChange={(event) => void handleFile(event.currentTarget.files?.[0] ?? null)}
      />
    </div>
  );
}

/** Opis alternatywny z nazwy pliku — a11y bez pustki (wzorzec z formularza sekcji). */
function altFromFileName(name: string): string | undefined {
  const cleaned = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Kody przyczyn, które warstwa serwerowa naprawdę zwraca (lib/unsplash.ts). */
const PICKER_ERRORS = new Set(["disabled", "network", "provider"]);

function SearchCard({ onPick }: { onPick: (source: ImageSource, alt?: string) => void }) {
  const t = useTranslations("site");
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await searchPhotos(query);
      if (!result.ok) {
        // Warstwa serwerowa zwraca KOD przyczyny (`disabled`/`network`/`provider`),
        // a nie zdanie — celowo: komunikat dostawcy potrafiłby nieść szczegóły
        // żądania, a operator i tak potrzebuje zdania w SWOIM języku. Kod
        // spoza słownika degraduje do komunikatu ogólnego, żeby nieznana
        // przyczyna nie wyświetliła się jako surowy identyfikator.
        setError(t(`picker.errors.${PICKER_ERRORS.has(result.error) ? result.error : "unknown"}`));
        setPhotos([]);
        return;
      }
      setPhotos(result.photos);
    });
  }

  function choose(photo: UnsplashPhoto) {
    // WYZWALACZ POBRANIA to warunek regulaminu dostawcy — wołany przy WYBORZE,
    // nie przy wyświetleniu listy. Nie czekamy na niego: wstawienie zdjęcia nie
    // może zależeć od cudzego serwera.
    void confirmPhotoChoice(photo.downloadLocation);
    onPick(
      {
        kind: "unsplash",
        url: photo.url,
        authorName: photo.authorName,
        authorUrl: photo.authorUrl,
        downloadLocation: photo.downloadLocation,
      },
      photo.alt,
    );
  }

  return (
    <div data-picker-search className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          aria-label={t("picker.searchLabel")}
          placeholder={t("picker.searchPlaceholder")}
          value={query}
          disabled={pending}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              run();
            }
          }}
        />
        <Button type="button" size="sm" data-picker-search-run loading={pending} disabled={pending} onClick={run}>
          {t("picker.search")}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <ul className="grid max-h-80 list-none grid-cols-3 gap-2 overflow-y-auto p-0">
        {photos.map((photo) => (
          <li key={photo.id}>
            <button
              type="button"
              data-picker-photo={photo.id}
              onClick={() => choose(photo)}
              className="focus-visible:outline-accent group/photo relative block w-full cursor-pointer overflow-hidden rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2"
            >
              {/* Pakiet panelu nie zna hostów dostawcy w next/image — zwykły <img>. */}
              <img src={photo.thumbUrl} alt={photo.alt} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              {/* ATRYBUCJA jest widoczna JUŻ NA LIŚCIE — operator wie, czyje
                  zdjęcie wybiera, zanim je wstawi. */}
              <span
                data-picker-photo-author
                className="text-background absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-1 text-[11px] leading-4"
              >
                {photo.authorName}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

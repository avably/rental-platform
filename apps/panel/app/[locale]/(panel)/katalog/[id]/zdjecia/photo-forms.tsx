"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@avably/ui";
import { ArrowLeft, ArrowRight, GripVertical, Star, Trash2, Upload, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState, useTransition } from "react";

import { useRouter } from "@/i18n/navigation";
import type { FormState } from "@/lib/form-state";
import type { ProductImageFileProblem } from "@/lib/product-image-file";
import type { PrepareProductImageUploadResult } from "@/lib/product-image-upload";

import {
  runProductImageUpload,
  uploadProductImageToSignedUrl,
} from "./upload-flow";

export interface ImageValues {
  id: string;
  sortOrder: number;
  /** Publiczny URL miniatury (transformacja Supabase — width/quality). */
  thumbnailUrl: string;
  altText: string;
}

type PrepareFn = (input: { mime: string; size: number }) => Promise<PrepareProductImageUploadResult>;
type FinalizeFn = (uploadId: string) => Promise<FormState>;
/** Bound `updateImageAction.bind(null, productId)` — usuwanie zdjęcia. */
type ImageMutation = (prevState: FormState, formData: FormData) => Promise<FormState>;
/** Bound `reorderProductImagesAction.bind(null, productId)` — nowa kolejność. */
type ReorderFn = (orderedIds: string[]) => Promise<FormState>;

// ---------------------------------------------------------------------
// WIELO-UPLOAD (uwaga właściciela #1, ADR-237)
// ---------------------------------------------------------------------

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface QueueItem {
  key: string;
  file: File;
  status: UploadStatus;
  error?: string;
}

/** Ile plików leci naraz — na tyle mało, by nie zalać łącza operatora lady. */
const UPLOAD_CONCURRENCY = 3;

/**
 * Formularz wgrywania WIELU zdjęć naraz: wybór wielu plików z okna, upuszczenie
 * kilku plików, równoległa wysyłka (pula) z osobnym stanem postępu per plik.
 *
 * Ścieżkę jednego pliku niesie `runProductImageUpload` (walidacja → bilet →
 * signed upload → finalize) — ta sama, którą miał pojedynczy formularz; multi
 * tylko woła ją per plik i pilnuje puli, więc reguły bezpieczeństwa (typ,
 * rozmiar, tenant-scope w bilecie) zostają w jednym miejscu.
 *
 * Postęp jest FAZOWY (w kolejce → wgrywanie → gotowe/błąd): `uploadToSignedUrl`
 * z supabase-js nie oddaje zdarzeń bajtowych, więc pasek pokazuje fazę, a nie
 * zmyśloną liczbę procent.
 */
export function MultiUploadImageForm({
  prepare,
  finalize,
  variant = "full",
}: {
  prepare: PrepareFn;
  finalize: FinalizeFn;
  /** `inline` = osadzony na karcie produktu (bez własnej ramki i nagłówka h2). */
  variant?: "full" | "inline";
}) {
  const t = useTranslations("catalog.images");
  const locale = useLocale();
  const router = useRouter();
  const idPrefix = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const stamp = Date.now();
    setItems((prev) => [
      ...prev,
      ...files.map((file, index) => ({
        key: `${stamp}-${index}-${file.name}-${file.size}`,
        file,
        status: "queued" as const,
      })),
    ]);
  }, []);

  function openPicker() {
    if (uploading) return;
    inputRef.current?.click();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const dropped = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    addFiles(dropped);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key));
  }

  function clearFinished() {
    setItems((prev) => prev.filter((item) => item.status !== "done"));
  }

  async function uploadAll() {
    if (uploadingRef.current) return;
    const pending = items.filter((item) => item.status === "queued" || item.status === "error");
    if (pending.length === 0) return;

    uploadingRef.current = true;
    setUploading(true);

    const deps = {
      prepare,
      upload: uploadProductImageToSignedUrl,
      finalize,
      message: (problem: ProductImageFileProblem | "upload") => t(`errors.${problem}`),
    };

    const queue = [...pending];
    const runNext = async (): Promise<void> => {
      const item = queue.shift();
      if (!item) return;
      setItems((prev) =>
        prev.map((row) =>
          row.key === item.key ? { ...row, status: "uploading", error: undefined } : row,
        ),
      );
      let result: FormState;
      try {
        result = await runProductImageUpload(item.file, deps);
      } catch {
        result = { formError: t("errors.upload") };
      }
      setItems((prev) =>
        prev.map((row) =>
          row.key === item.key
            ? result.success
              ? { ...row, status: "done" as const, error: undefined }
              : { ...row, status: "error" as const, error: result.formError }
            : row,
        ),
      );
      await runNext();
    };

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, () => runNext()),
    );

    uploadingRef.current = false;
    setUploading(false);
    // Zdjęcia właśnie doszły do bazy (finalize rewaliduje), ale ten komponent
    // żyje po stronie klienta — bez odświeżenia siatka pod spodem stałaby
    // z poprzednim zestawem. Router refetchuje serwerowe drzewo tej trasy.
    router.refresh();
  }

  const pendingCount = items.filter(
    (item) => item.status === "queued" || item.status === "error",
  ).length;
  const doneCount = items.filter((item) => item.status === "done").length;
  const wrapperClass =
    variant === "full"
      ? "border-border bg-card flex flex-col gap-4 rounded-lg border p-5"
      : "flex flex-col gap-3";

  return (
    <section className={wrapperClass} aria-label={t("multiTitle")}>
      {variant === "full" ? (
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("multiTitle")}</h2>
      ) : null}

      <div
        data-multi-dropzone
        data-dragover={dragOver}
        onClick={openPicker}
        onDragOver={(event) => {
          if (uploading) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="border-input hover:border-foreground focus-within:border-foreground focus-within:outline-accent dark:focus-within:outline-ring data-[dragover=true]:border-foreground data-[dragover=true]:bg-accent/10 relative flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border bg-transparent px-4 py-6 text-center outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] focus-within:outline-solid focus-within:outline-[3px] focus-within:outline-offset-2 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        aria-disabled={uploading || undefined}
      >
        <input
          ref={inputRef}
          id={`${idPrefix}-files`}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif"
          aria-label={t("multiPrompt")}
          className="sr-only"
          disabled={uploading}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            // Ten sam plik da się wybrać ponownie po skasowaniu wartości.
            event.currentTarget.value = "";
          }}
        />
        <Upload className="text-muted-foreground size-6" aria-hidden />
        <span className="text-sm font-medium">{t("multiPrompt")}</span>
        <span className="text-muted-foreground text-[13px] leading-[18px]">{t("multiHint")}</span>
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2" data-multi-queue>
          {items.map((item) => (
            <QueueRow key={item.key} item={item} locale={locale} onRemove={() => removeItem(item.key)} />
          ))}
        </ul>
      ) : null}

      {doneCount > 0 ? (
        <p role="status" className="text-status-positive-fg text-[13px] leading-[18px]">
          {t("uploadSummary", { done: doneCount, total: items.length })}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={uploadAll}
            loading={uploading}
            disabled={uploading || pendingCount === 0}
          >
            {t("uploadSelected")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearFinished} disabled={uploading}>
            {t("clearSelection")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Nazwa i rozmiar pliku w kolejce, ze wskaźnikiem fazy i przyciskiem usunięcia. */
function QueueRow({
  item,
  locale,
  onRemove,
}: {
  item: QueueItem;
  locale: string;
  onRemove: () => void;
}) {
  const t = useTranslations("catalog.images");
  const sizeMb = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    item.file.size / (1024 * 1024),
  );
  const statusLabel =
    item.status === "queued"
      ? t("statusQueued")
      : item.status === "uploading"
        ? t("statusUploading")
        : item.status === "done"
          ? t("statusDone")
          : t("statusFailed");
  const fillClass =
    item.status === "done"
      ? "w-full bg-foreground"
      : item.status === "uploading"
        ? "w-1/2 bg-accent animate-pulse"
        : item.status === "error"
          ? "w-full bg-destructive"
          : "w-0 bg-accent";

  return (
    <li className="border-border bg-card flex items-center gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium">{item.file.name}</span>
          <span className="text-muted-foreground shrink-0 text-[13px] leading-[18px] tabular-nums">
            {sizeMb} MB
          </span>
        </div>
        <div
          className="bg-muted mt-2 h-1 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-label={statusLabel}
        >
          <div
            className={`h-full rounded-full transition-[width] [transition-duration:var(--motion-standard)] ${fillClass}`}
          />
        </div>
        <p
          className={`mt-1 text-[13px] leading-[18px] ${
            item.status === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
          role={item.status === "error" ? "alert" : undefined}
        >
          {item.status === "error" && item.error ? item.error : statusLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("removeFromQueue")}
        className="text-muted-foreground hover:text-foreground focus-visible:outline-accent dark:focus-visible:outline-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------
// KOLEJNOŚĆ ZDJĘĆ PRZECIĄGANIEM (uwaga właściciela #2, ADR-237)
// ---------------------------------------------------------------------

/**
 * Siatka miniatur z przeciąganiem: pierwsza jest główna w sklepie. Zamiast
 * pola „Kolejność" z liczbą — chwyt do przeciągania, przyciski „wcześniej/
 * później" (klawiatura, czytnik ekranu) i odznaka „Główne" na pierwszej.
 *
 * Nowa kolejność leci do serwera CAŁĄ listą identyfikatorów; przy odmowie stan
 * wraca do poprzedniego, żeby ekran nie kłamał o zapisie.
 */
export function PhotoGrid({
  images,
  reorder,
  remove,
}: {
  images: ImageValues[];
  reorder: ReorderFn;
  remove: ImageMutation;
}) {
  const t = useTranslations("catalog.images");
  const router = useRouter();
  const [order, setOrder] = useState<ImageValues[]>(images);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  // Serwer jest źródłem prawdy o ZBIORZE zdjęć: gdy dojdzie nowe albo zniknie
  // usunięte (rewalidacja trasy), przyjmujemy jego listę. Klucz to POSORTOWANY
  // zbiór identyfikatorów, więc samo przestawienie kolejności (ten sam zbiór)
  // nie kasuje optymistycznego stanu w trakcie zapisu. Korektę robimy W RENDERZE
  // (wzorzec React „adjusting state during render"), nie w efekcie — bez
  // kaskady i bez martwej klatki ze starym zbiorem.
  const idSetKey = images
    .map((image) => image.id)
    .sort()
    .join(",");
  const [seenIdSetKey, setSeenIdSetKey] = useState(idSetKey);
  if (seenIdSetKey !== idSetKey) {
    setSeenIdSetKey(idSetKey);
    setOrder(images);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = useCallback(
    (next: ImageValues[], previous: ImageValues[]) => {
      setStatus("idle");
      startTransition(async () => {
        const result = await reorder(next.map((image) => image.id));
        if (result.success) {
          setStatus("saved");
          router.refresh();
        } else {
          setOrder(previous);
          setStatus("error");
        }
      });
    },
    [reorder, router],
  );

  function handleDragEnd(event: DragEndEvent) {
    const from = order.findIndex((image) => image.id === event.active.id);
    const to = event.over ? order.findIndex((image) => image.id === event.over!.id) : -1;
    if (from < 0 || to < 0 || from === to) return;
    const previous = order;
    const next = arrayMove(order, from, to);
    setOrder(next);
    persist(next, previous);
  }

  function move(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= order.length) return;
    const previous = order;
    const next = arrayMove(order, index, to);
    setOrder(next);
    persist(next, previous);
  }

  async function handleDelete(imageId: string) {
    const formData = new FormData();
    formData.set("imageId", imageId);
    formData.set("intent", "delete");
    const previous = order;
    // Optymistyczne zdjęcie kafelka — rewalidacja po akcji i tak przyniesie
    // prawdę; przy odmowie wracamy do poprzedniego stanu.
    setOrder((prev) => prev.filter((image) => image.id !== imageId));
    startTransition(async () => {
      const result = await remove({}, formData);
      if (result.success) {
        router.refresh();
      } else {
        setOrder(previous);
        setStatus("error");
      }
    });
  }

  const ids = order.map((image) => image.id);

  return (
    <div className="flex flex-col gap-3" data-photo-grid>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("reorderHint")}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {order.map((image, index) => (
              <PhotoTile
                key={image.id}
                image={image}
                index={index}
                total={order.length}
                disabled={pending}
                onMove={move}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {status === "saved" ? (
        <p role="status" className="text-status-positive-fg text-[13px] leading-[18px]">
          {t("reordered")}
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="text-destructive text-[13px] leading-[18px]">
          {t("reorderError")}
        </p>
      ) : null}
    </div>
  );
}

function PhotoTile({
  image,
  index,
  total,
  disabled,
  onMove,
  onDelete,
}: {
  image: ImageValues;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (imageId: string) => void;
}) {
  const t = useTranslations("catalog.images");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-photo-tile={index}
      aria-label={t("positionLabel", { position: index + 1 })}
      className={`border-border bg-card flex flex-col gap-2 rounded-md border p-2${
        isDragging ? " opacity-80" : ""
      }`}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura z publicznego bucketu Storage (transformacja Supabase), nie zasób lokalny next/image */}
        <img
          src={image.thumbnailUrl}
          alt={image.altText || t("thumbnailAlt")}
          width={240}
          height={240}
          className="border-border aspect-square w-full rounded-md border object-cover"
        />
        {index === 0 ? (
          <span
            data-photo-main
            className="bg-foreground text-background absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-[14px] font-semibold"
          >
            <Star className="size-3" aria-hidden />
            {t("mainBadge")}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t("dragHandle")}
          data-photo-drag={index}
          className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-8 cursor-grab touch-none items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span className="text-muted-foreground text-xs tabular-nums">{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={t("moveLeft")}
            disabled={disabled || index === 0}
            onClick={() => onMove(index, -1)}
            className="text-muted-foreground hover:text-foreground focus-visible:outline-accent dark:focus-visible:outline-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("moveRight")}
            disabled={disabled || index === total - 1}
            onClick={() => onMove(index, 1)}
            className="text-muted-foreground hover:text-foreground focus-visible:outline-accent dark:focus-visible:outline-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowRight className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("delete")}
            disabled={disabled}
            onClick={() => onDelete(image.id)}
            className="text-muted-foreground hover:text-destructive focus-visible:outline-accent dark:focus-visible:outline-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

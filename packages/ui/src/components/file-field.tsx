"use client";

import { ImageIcon, PaperclipIcon, UploadIcon, XIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

// Pole wgrywania plików Fazy 2 (sekcja „file-field" artefaktu, weto właściciela
// 2026-07-28): koniec z gołym natywnym „Wybierz plik". Nad ukrytym, ale wciąż
// FOKUSOWALNYM i wysyłanym natywnym <input type="file"> stoi ostylowana strefa
// w tokenach systemu. Native input pozostaje JEDYNYM źródłem prawdy o pliku —
// dzięki temu formularz z akcją serwerową (wysyłka faktury) niesie plik w
// FormData bez żadnej dodatkowej logiki. Drag&drop wpisuje plik z powrotem do
// natywnego inputa (DataTransfer w przeglądarce), więc obie ścieżki — wybór z
// okna i upuszczenie — kończą się w tym samym miejscu.
//
// Stany: pusty / hover (podkreślenie obrysu foreground) / drag-over (obrys
// foreground + delikatny nośnik limonki) / wybrany (nazwa, rozmiar, miniatura
// obrazu, usuwanie) / błąd (obrys destructive + komunikat role="alert") /
// disabled = WYGASZENIE KONTRASTU (opacity) + not-allowed, spójnie z konwencją
// z PR #135 (nigdy obrys kreskowany). Zero cieni — kontrakt no-shadow.
//
// Dostępność: pojedynczy fokusowalny, etykietowany <input> (zewnętrzny
// <Label htmlFor>), obrys fokusu malowany przez :focus-within na strefie,
// Enter/Spacja otwiera natywny wybór (zachowanie inputa), błąd w role="alert".

export interface FileFieldProps
  extends Omit<React.ComponentProps<"input">, "type" | "children"> {
  /** id — wiąże zewnętrzny <Label htmlFor>, hint i błąd z ukrytym inputem. */
  id: string;
  /** Tekst zachęty w stanie pustym, np. „Przeciągnij plik albo kliknij…". */
  prompt: string;
  /** Podpis pod polem: dozwolone formaty i limit. Wiązany aria-describedby. */
  hint?: string;
  /** Dostępna etykieta przycisku usuwania wyboru (aria-label). */
  removeLabel: string;
  /** Komunikat błędu — renderowany w role="alert", ustawia aria-invalid. */
  error?: string;
  /** Lokalizacja formatu rozmiaru pliku (separator dziesiętny). */
  locale?: string;
}

/** Rozmiar pliku w jednostce, w której użytkownik widzi go w systemie. */
function formatFileSize(bytes: number, locale?: string): string {
  const mb = bytes / (1024 * 1024);
  const useMb = mb >= 0.1;
  const value = useMb ? mb : bytes / 1024;
  const unit = useMb ? "MB" : "kB";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

/**
 * Wpisuje pliki do natywnego inputa tak, by pozostał źródłem prawdy dla
 * FormData. W przeglądarce buduje FileList przez DataTransfer; w środowisku
 * testowym bez DataTransfer (jsdom) podstawiamy właściwość, żeby handler
 * odczytał currentTarget.files — sama wysyłka i tak jedzie ścieżką DataTransfer.
 */
function setNativeFiles(input: HTMLInputElement, files: File[]): void {
  if (typeof DataTransfer !== "undefined") {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    return;
  }
  Object.defineProperty(input, "files", { configurable: true, value: files });
}

function useMergedRef<T>(
  external: React.Ref<T> | undefined,
  internal: React.RefObject<T | null>,
): React.RefCallback<T> {
  return React.useCallback(
    (node: T | null) => {
      internal.current = node;
      if (typeof external === "function") external(node);
      else if (external) (external as React.RefObject<T | null>).current = node;
    },
    [external, internal],
  );
}

function FileField({
  id,
  className,
  prompt,
  hint,
  removeLabel,
  error,
  locale,
  disabled,
  onChange,
  ref,
  "aria-describedby": ariaDescribedByProp,
  "aria-invalid": ariaInvalidProp,
  ...props
}: FileFieldProps) {
  const innerRef = React.useRef<HTMLInputElement>(null);
  const mergedRef = useMergedRef(ref, innerRef);
  const [selected, setSelected] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [ariaDescribedByProp, hintId, errorId].filter(Boolean).join(" ") || undefined;

  // Miniatura obrazu — obiektowy URL sprzątany przy zmianie/odmontowaniu.
  React.useEffect(() => {
    if (!selected || !selected.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return;
    }
    let url: string | null = null;
    try {
      url = URL.createObjectURL(selected);
    } catch {
      url = null;
    }
    setPreviewUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected]);

  function commit(input: HTMLInputElement) {
    setSelected(input.files?.[0] ?? null);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    commit(event.currentTarget);
    onChange?.(event);
  }

  function openPicker() {
    if (disabled) return;
    innerRef.current?.click();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const input = innerRef.current;
    const dropped = event.dataTransfer?.files;
    if (!input || !dropped || dropped.length === 0) return;
    const files = Array.from(dropped).slice(0, input.multiple ? undefined : 1);
    setNativeFiles(input, files);
    commit(input);
    onChange?.({
      currentTarget: input,
      target: input,
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  }

  function handleRemove(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const input = innerRef.current;
    if (!input) return;
    setNativeFiles(input, []);
    input.value = "";
    commit(input);
    onChange?.({
      currentTarget: input,
      target: input,
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  }

  const hasError = Boolean(error);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        data-slot="file-field"
        data-dragover={dragOver}
        data-error={hasError}
        data-has-file={Boolean(selected)}
        aria-disabled={disabled || undefined}
        onClick={openPicker}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-input bg-transparent px-4 py-6 text-center outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
          "not-aria-disabled:hover:border-foreground",
          "focus-within:border-foreground focus-within:outline-solid focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-accent dark:focus-within:outline-ring",
          "data-[dragover=true]:border-foreground data-[dragover=true]:bg-accent/10",
          "data-[error=true]:border-destructive",
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:pointer-events-none",
        )}
      >
        <input
          ref={mergedRef}
          id={id}
          type="file"
          data-slot="file-field-input"
          className="sr-only"
          disabled={disabled}
          aria-invalid={hasError ? true : ariaInvalidProp}
          aria-describedby={describedBy}
          onChange={handleInputChange}
          // Klik natywnego inputa (w tym programowy input.click() ze strefy)
          // NIE może wracać bąbelkiem do onClick strefy — inaczej otwiera
          // wybór dwa razy.
          onClick={(event) => event.stopPropagation()}
          {...props}
        />

        {selected ? (
          <div className="flex w-full items-center gap-3 text-left">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Podgląd: ${selected.name}`}
                width={48}
                height={48}
                className="border-border size-12 shrink-0 rounded-md border object-cover"
              />
            ) : (
              <span className="border-border bg-secondary text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md border">
                {selected.type.startsWith("image/") ? (
                  <ImageIcon className="size-5" aria-hidden="true" />
                ) : (
                  <PaperclipIcon className="size-5" aria-hidden="true" />
                )}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{selected.name}</span>
              <span className="text-muted-foreground block text-[13px] leading-[18px]">
                {formatFileSize(selected.size, locale)}
              </span>
            </span>
            <button
              type="button"
              onClick={handleRemove}
              disabled={disabled}
              aria-label={removeLabel}
              className="text-muted-foreground hover:text-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-[color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <UploadIcon className="text-muted-foreground size-6" aria-hidden="true" />
            <span className="text-sm font-medium">{prompt}</span>
          </>
        )}
      </div>

      {hint ? (
        <p id={hintId} className="text-muted-foreground text-[13px] leading-[18px]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-destructive text-[13px] leading-[18px] font-medium"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { FileField };

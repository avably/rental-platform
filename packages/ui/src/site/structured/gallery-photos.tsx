"use client";

import type { GalleryStructuredContent } from "@avably/core/site";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { cn } from "../../lib/cn";
import type { SiteRenderLabels } from "../types";
import {
  GalleryImage,
  GalleryTile,
  GalleryTileLink,
  galleryLightboxIndexes,
  galleryOpensLightbox,
} from "./gallery-shared";

/**
 * LISTA KAFLI I POWIĘKSZENIE (E3, aneks ADR-094).
 *
 * ==================== DLACZEGO JEDEN KOMPONENT NA TRZY UKŁADY ====================
 *
 * Układ decyduje o KONTENERZE (siatka, mozaika, pas przewijany) — i tyle.
 * Kafel, reguła „odnośnik wygrywa z powiększeniem", okno powiększenia i jego
 * klawiatura są w każdym z trzech układów identyczne, więc mieszkają tutaj,
 * a układy podają wyłącznie KLASY swojego kontenera. Trzy kopie tego okna
 * znaczyłyby trzy miejsca, w których pułapka fokusu może się rozjechać.
 *
 * ==================== POWIĘKSZENIE WEDŁUG W3C APG ====================
 *
 *   • oknem jest NATYWNY `<dialog>` otwarty przez `showModal()` — pułapka
 *     fokusu, warstwa nad stroną i Escape przychodzą z przeglądarki, a nie
 *     z naszej pętli po elementach fokusowalnych (tamta psuje się przy każdym
 *     nowym rodzaju kontrolki w środku);
 *   • Escape obsługujemy TAKŻE jawnie, bo `showModal` bywa niedostępne
 *     (starsze silniki, środowisko testowe) — okno bez wyjścia jest gorsze niż
 *     okno bez warstwy;
 *   • ←/→ przechodzą między zdjęciami; `aria-live` mówi, które jest widoczne,
 *     bo sama zmiana obrazu jest dla czytnika ekranu niesłyszalna;
 *   • po zamknięciu fokus WRACA na kafel, który okno otworzył. Bez tego
 *     klawiatura ląduje na początku strony i operator traci miejsce w galerii.
 *
 * Powiększenie obejmuje WYŁĄCZNIE kafle bez odnośnika (patrz
 * `galleryOpensLightbox`), więc strzałki chodzą po tym samym zbiorze, który
 * daje się otworzyć — a nie po wszystkich zdjęciach, z których część
 * kliknięciem wychodzi ze strony.
 */
/**
 * OTWARCIE I ZAMKNIĘCIE OKNA Z DEGRADACJĄ — obie drogi SYMETRYCZNIE.
 *
 * `showModal`/`close` to metody, których nie ma w każdym środowisku (starsze
 * silniki, jsdom w testach). Degradacja do atrybutu `open` daje okno bez
 * warstwy i bez natywnej pułapki fokusu — czyli mniej, ale nadal działające.
 * Symetria jest tu warunkiem: otwieranie z zapasową drogą i zamykanie bez niej
 * dałoby okno, którego NIE DA SIĘ zamknąć — awarię gorszą od braku warstwy.
 */
function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function hideDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog?.open) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

export function GalleryPhotos({
  content,
  labels,
  siteImageBase,
  listClassName,
  listStyle,
  itemClassName,
  imageClassName,
  listRef,
  onListScroll,
}: {
  content: GalleryStructuredContent;
  labels: SiteRenderLabels;
  siteImageBase?: string;
  /** Klasy kontenera listy — jedyna rzecz, którą różnią się układy. */
  listClassName: string;
  listStyle?: CSSProperties;
  itemClassName?: string;
  imageClassName: string;
  /** Kontener listy dla układu, który nim przewija (karuzela). */
  listRef?: RefObject<HTMLUListElement | null>;
  onListScroll?: () => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggers = useRef(new Map<number, HTMLButtonElement>());
  /** Kafel, z którego otwarto okno — cel powrotu fokusu po zamknięciu. */
  const openedFrom = useRef<number | null>(null);

  const openable = galleryLightboxIndexes(content);

  const close = useCallback(() => {
    setOpenIndex(null);
    hideDialog(dialogRef.current);
    const back = openedFrom.current;
    openedFrom.current = null;
    if (back !== null) triggers.current.get(back)?.focus();
  }, []);

  const step = useCallback(
    (direction: -1 | 1) => {
      setOpenIndex((current) => {
        if (current === null || openable.length === 0) return current;
        const at = openable.indexOf(current);
        if (at < 0) return current;
        // Zawijanie jest tu właściwe: album ma koniec, ale przeglądanie go nie
        // ma — strzałka wygaszona na ostatnim zdjęciu wygląda na awarię.
        const next = (at + direction + openable.length) % openable.length;
        return openable[next]!;
      });
    },
    [openable],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openIndex === null) {
      hideDialog(dialog);
      return;
    }
    if (dialog.open) return;
    showDialog(dialog);
    // FOKUS WCHODZI DO OKNA JAWNIE. Bez tego kroku klawiatura zostaje na kafelku
    // POD oknem: Escape i strzałki nie dochodzą do okna, więc jedyne wyjście
    // byłoby myszą — a to jest awaria dostępności, nie drobiazg.
    dialog
      .querySelector<HTMLElement>('[data-gallery-lightbox-action="close"]')
      ?.focus();
  }, [openIndex]);

  const open = openIndex === null ? null : content.items[openIndex];
  const position = openIndex === null ? 0 : openable.indexOf(openIndex) + 1;

  return (
    <>
      <ul
        ref={listRef}
        data-gallery-list={content.layout}
        style={listStyle}
        onScroll={onListScroll}
        className={cn("list-none p-0", listClassName)}
      >
        {content.items.map((item, index) => (
          <li key={index} data-gallery-item={index} className={itemClassName}>
            <GalleryTile item={item} siteImageBase={siteImageBase} imageClassName={imageClassName}>
              {(image) =>
                item.link ? (
                  <GalleryTileLink href={item.link}>{image}</GalleryTileLink>
                ) : galleryOpensLightbox(content, item) ? (
                  <button
                    type="button"
                    data-gallery-zoom={index}
                    aria-label={labels.galleryZoom}
                    ref={(node) => {
                      if (node) triggers.current.set(index, node);
                      else triggers.current.delete(index);
                    }}
                    onClick={() => {
                      openedFrom.current = index;
                      setOpenIndex(index);
                    }}
                    className="block w-full cursor-zoom-in border-0 bg-transparent p-0"
                  >
                    {image}
                  </button>
                ) : (
                  image
                )
              }
            </GalleryTile>
          </li>
        ))}
      </ul>

      {content.lightbox && openable.length > 0 ? (
        <dialog
          ref={dialogRef}
          data-gallery-lightbox
          onCancel={(event) => {
            // Domyślne zamknięcie natywnego okna pomija powrót fokusu —
            // przechwytujemy je i zamykamy JEDNĄ drogą.
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
              return;
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              step(1);
              return;
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(-1);
            }
          }}
          className="site-root site-surface site-lightbox"
        >
          {open ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <p data-gallery-position aria-live="polite" className="site-text-muted m-0 text-sm">
                  {labels.galleryPosition
                    .replace("{current}", String(position))
                    .replace("{total}", String(openable.length))}
                </p>
                <div className="ml-auto flex gap-2">
                  <LightboxButton
                    marker="prev"
                    label={labels.galleryPrev}
                    glyph="‹"
                    onClick={() => step(-1)}
                  />
                  <LightboxButton
                    marker="next"
                    label={labels.galleryNext}
                    glyph="›"
                    onClick={() => step(1)}
                  />
                  <LightboxButton marker="close" label={labels.galleryClose} glyph="✕" onClick={close} />
                </div>
              </div>
              {/*
                Sufit wysokości w `rem`, NIE w jednostkach okna: jednostki okna
                są w tym repozytorium zakazane w skali sekcji (ADR-085), a okno
                i tak nie wyjdzie poza ekran — natywny `<dialog>` ma z arkusza
                przeglądarki własne `max-height`, a `.site-lightbox` dokłada
                przewijanie zawartości.
              */}
              <GalleryImage
                item={open}
                siteImageBase={siteImageBase}
                className="max-h-[32rem] w-auto max-w-full object-contain"
              />
              {open.caption ? (
                <p data-gallery-lightbox-caption className="site-text-muted m-0 text-sm">
                  {open.caption}
                </p>
              ) : null}
            </div>
          ) : null}
        </dialog>
      ) : null}
    </>
  );
}

/**
 * Kontrolka okna powiększenia. Znak jest DEKORACJĄ (`aria-hidden`) — znaczenie
 * niesie dostępna nazwa, więc czytnik ekranu mówi „następne zdjęcie", a nie
 * „prawy nawias trójkątny".
 */
function LightboxButton({
  marker,
  label,
  glyph,
  onClick,
}: {
  marker: string;
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-gallery-lightbox-action={marker}
      aria-label={label}
      onClick={onClick}
      className="site-card flex size-9 cursor-pointer items-center justify-center text-lg leading-none"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

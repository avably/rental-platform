"use client";

/**
 * WYSZUKIWANIE W NAGŁÓWKU SKLEPU (F7; od F7b WYŁĄCZNIE IKONA).
 *
 * ==================== JEDNA FORMA, JEDEN FORMULARZ GET ====================
 *
 * Wyzwalacz-ikona na KAŻDEJ trasie i KAŻDEJ szerokości; panel z pełnoszerokim
 * polem rozwija się POD belką. Do F7b od 48 rem kontenera stało w belce pełne
 * pole („search dominuje środek", benchmark F7) — właściciel zdjął je po
 * obejrzeniu produkcji: „search jako tylko ikonka". Wariant „full" wypadł
 * razem z progiem kontenerowym, który go włączał.
 *
 * Formularz to zwykły `<form method="get">` celujący w `/katalog` (ADR-263/F9):
 * wysłanie robi NAWIGACJĘ pod `/katalog?q=…`, więc wyszukiwanie działa bez
 * JavaScriptu, a adres wyników da się wkleić.
 *
 * ==================== `<details>` + MINIMALNY JS ====================
 *
 * Rozwijanie na `<details>` z tych samych powodów, co menu kategorii
 * (ADR-247): trasa sklepu bywa STATYCZNA, a CSP nie ma `unsafe-inline` —
 * natywny element daje przycisk z `aria-expanded`, klawiaturę i stan otwarcia
 * BEZ skryptu, więc serwer i klient nie mają jak się rozjechać na pierwszym
 * renderze. JavaScript tylko DOKŁADA wygodę (progressive enhancement):
 * autofocus po otwarciu, Escape i tap poza panelem zamykają. Bez skryptu
 * wszystko dalej działa — otwarcie/zamknięcie robi `<summary>`, wysłanie form.
 *
 * Panel jest w warstwie `absolute`, żeby otwarcie NIE przesuwało belki
 * (kotwica: wiersz belki z `relative` w `StoreShellHeader` — technika S-01).
 * Rozdział powierzchni robi obrys karty, nie cień (twardy zakaz cieni).
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";
import { StoreGlyph } from "@avably/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { CATALOG_SEARCH_PARAM } from "@/lib/catalog/catalog-search";

export interface StoreHeaderSearchLabels {
  /** Etykieta dostępna pola i wyzwalacza („Szukaj w katalogu"). */
  label: string;
  placeholder: string;
  submit: string;
}

export function StoreHeaderSearch({
  labels,
  defaultQuery,
}: {
  labels: StoreHeaderSearchLabels;
  /**
   * BIEŻĄCA FRAZA WYNIKÓW (F9c) — na `/katalog?q=…` belka jest JEDYNYM polem
   * wyszukiwania (toolbar listingu przestał go dublować), więc to ona pokazuje
   * i pozwala poprawić frazę. Podaje ją wyłącznie trasa katalogu.
   */
  defaultQuery?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  /*
    Zamknięcie przez zdjęcie atrybutu `open` z NATYWNEGO elementu — stan
    otwarcia mieszka w DOM (details), a React tylko go lustruje w `open`,
    żeby wiedzieć, kiedy słuchać dokumentu. Drugi stan „otwarte" w Reakcie
    obok atrybutu rozjechałby się z klikiem w `<summary>`.
  */
  const close = useCallback(() => {
    detailsRef.current?.removeAttribute("open");
    setOpen(false);
  }, []);

  /*
    Nasłuchy dokumentu TYLKO przy otwartym panelu: Escape i tap poza
    panelem zamykają (spec F7 pkt 3). `pointerdown`, nie `click` — klik
    w `<summary>` sam przełącza details i zdążyłby otworzyć go z powrotem.
  */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details && event.target instanceof Node && !details.contains(event.target)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const action = `/${CATALOG_PATH_SEGMENT}`;

  return (
    /*
      Korzeń wypełnia slot belki: wyzwalacz jest kwadratem 44 px w rzędzie
      pozostałych ikon (kategorie ← szukaj → termin → koszyk).
    */
    <div data-store-header-search className="flex shrink-0 items-center">
      <details
        ref={detailsRef}
        data-store-header-search-toggle
        className="group"
        onToggle={(event) => {
          const isOpen = event.currentTarget.open;
          setOpen(isOpen);
          // Autofocus po otwarciu (spec F7 pkt 3) — enhancement, nie warunek.
          if (isOpen) inputRef.current?.focus();
        }}
      >
        {/* Wyzwalacz 44×44 px (S-15) — sama lupa, z etykietą dostępną. */}
        <summary
          aria-label={labels.label}
          className="site-menu-link flex h-11 w-10 cursor-pointer list-none items-center justify-center rounded @min-[40rem]/site:w-11 [&::-webkit-details-marker]:hidden"
        >
          <StoreGlyph name="search" className="h-5 w-5" />
        </summary>
        {/*
          PANEL POD BELKĄ: pełna szerokość wiersza belki (kotwica `relative`
          w `StoreShellHeader` — technika S-01), warstwa nad treścią strony.

          `hidden group-open:block` DUBLUJE natywne chowanie details ŚWIADOMIE:
          Chrome trzyma treść zamkniętego details w `content-visibility` i dalej
          liczy jej layout — sondy geometrii (bramka overflow w shot.mjs)
          widziały wtedy „wystający" przycisk panelu, którego ŻADEN użytkownik
          nie widzi. `display: none` zeruje geometrię zamkniętego panelu, a po
          otwarciu nie zmienia niczego.
        */}
        <div className="site-card absolute left-0 right-0 top-full z-40 mt-2 hidden p-2 group-open:block">
          <form
            data-store-header-search-panel
            role="search"
            method="get"
            action={action}
            className="flex h-11 items-center gap-2"
          >
            <label htmlFor="store-header-search-q-panel" className="sr-only">
              {labels.label}
            </label>
            <input
              id="store-header-search-q-panel"
              ref={inputRef}
              type="search"
              name={CATALOG_SEARCH_PARAM}
              defaultValue={defaultQuery}
              placeholder={labels.placeholder}
              autoComplete="off"
              className="site-field h-11 w-full min-w-0 px-3 text-sm"
            />
            <button
              type="submit"
              className="site-cta flex h-11 shrink-0 cursor-pointer items-center text-sm font-semibold"
            >
              {labels.submit}
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}

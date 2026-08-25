"use client";

/**
 * WYSZUKIWANIE W NAGŁÓWKU SKLEPU (F7) — „search na wierzchu" z mandatu
 * właściciela: pole widoczne na KAŻDEJ trasie, nie tylko w toolbarze listingu.
 *
 * ==================== DWIE FORMY, JEDEN FORMULARZ GET ====================
 *
 * Obie formy są zwykłym `<form method="get">` celującym w `/katalog` — jak
 * pole toolbara (ADR-263/F9): wysłanie robi NAWIGACJĘ pod `/katalog?q=…`,
 * więc wyszukiwanie działa bez JavaScriptu, a adres wyników da się wkleić.
 *
 *   • PEŁNE POLE (kontener ≥ 48 rem, trasy poza kasą): input + przycisk
 *     w środku belki — wyszukiwanie jest głównym narzędziem nawigacji.
 *   • IKONA (kontener < 48 rem ZAWSZE; na kasie i w koszyku KAŻDA szerokość —
 *     redukcja dystrakcji, spec F7 pkt 4): natywny `<details>`, którego panel
 *     rozpina pełnoszerokie pole POD belką.
 *
 * Rozjazd form robi zapytanie KONTENEROWE `@min-[48rem]/site:` (ADR-085),
 * nie viewportowe — obie formy stoją w SSR, widoczna jest zawsze dokładnie
 * jedna. Ta sama technika, co dwa wystąpienia pigułki terminu (aneks ADR-194).
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
import { useCallback, useEffect, useRef, useState } from "react";

import { CATALOG_SEARCH_PARAM } from "@/lib/catalog/catalog-search";

export interface StoreHeaderSearchLabels {
  /** Etykieta dostępna pola i wyzwalacza („Szukaj w katalogu"). */
  label: string;
  placeholder: string;
  submit: string;
}

/** Ikona lupy — czysto dekoracyjna przy etykietowanym wyzwalaczu/przycisku. */
function SearchGlyph({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

export function StoreHeaderSearch({
  labels,
  variant,
}: {
  labels: StoreHeaderSearchLabels;
  /**
   * `full` — pełne pole od 48 rem kontenera, ikona poniżej (trasy handlowe
   * i treściowe); `icon` — ikona na każdej szerokości (kasa i koszyk, F7 pkt 4).
   */
  variant: "full" | "icon";
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
      Korzeń wypełnia slot belki: przy pełnym polu formularz środkuje się
      w wolnym pasie (`mx-auto` na formie), przy ikonie wyzwalacz dosuwa się
      do prawej — obok pigułki terminu i koszyka.
    */
    <div data-store-header-search className="flex min-w-0 flex-1 items-center justify-end">
      {variant === "full" ? (
        /*
          PEŁNE POLE (desktop): 44 px wysokości (h-11 — cel dotykowy S-15),
          elastyczna szerokość z sufitem — pole ma dominować środek belki,
          ale nie rozpychać jej ponad kolumnę treści.
        */
        <form
          data-store-header-search-inline
          role="search"
          method="get"
          action={action}
          className="mx-auto hidden h-11 w-full max-w-xl items-center gap-2 @min-[48rem]/site:flex"
        >
          {/* Etykieta dla czytnika — placeholder nią nie jest (WCAG 3.3.2). */}
          <label htmlFor="store-header-search-q" className="sr-only">
            {labels.label}
          </label>
          <input
            id="store-header-search-q"
            type="search"
            name={CATALOG_SEARCH_PARAM}
            placeholder={labels.placeholder}
            autoComplete="off"
            className="site-field h-11 w-full min-w-0 px-3 text-sm"
          />
          <button
            type="submit"
            className="site-cta flex h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold"
          >
            <SearchGlyph className="h-4 w-4 shrink-0" />
            <span>{labels.submit}</span>
          </button>
        </form>
      ) : null}
      <details
        ref={detailsRef}
        data-store-header-search-toggle
        className={variant === "full" ? "group @min-[48rem]/site:hidden" : "group"}
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
          className="site-menu-link flex h-11 w-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden"
        >
          <SearchGlyph className="h-5 w-5" />
        </summary>
        {/*
          PANEL POD BELKĄ: pełna szerokość wiersza belki (kotwica `relative`
          w `StoreShellHeader` — technika S-01), warstwa nad listwą kategorii.

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

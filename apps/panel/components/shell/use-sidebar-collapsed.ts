"use client";

import { useSyncExternalStore } from "react";

import {
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_EVENT,
  SIDEBAR_STORAGE_KEY,
} from "@/lib/shell/sidebar-collapse";

/**
 * Odczyt i zapis stanu zwinięcia sidebara (uwaga przeglądu 2026-07-23).
 *
 * Stan mieszka na `<html data-sidebar>` (patrz `lib/shell/sidebar-collapse.ts`),
 * a nie w stanie Reacta: ustawia go skrypt startowy PRZED hydracją, żeby pasek
 * nie mrugnął szerokością. Dlatego komponenty CZYTAJĄ prawdę zewnętrzną przez
 * `useSyncExternalStore`, zamiast trzymać własną kopię — dwie kopie tej samej
 * prawdy rozjechałyby się i przycisk mówiłby co innego, niż widać na ekranie
 * (wzorzec `ThemeToggle`).
 *
 * Zdarzenie `avably:sidebar` jest kanałem subskrypcji: przełącznik i nawigacja
 * odświeżają się razem, bez wspólnego providera.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => window.removeEventListener(SIDEBAR_EVENT, onChange);
}

function readCollapsed(): boolean {
  return document.documentElement.dataset[SIDEBAR_ATTRIBUTE] === "collapsed";
}

/**
 * Podczas renderu serwerowego nie ma `document`. Zwracamy „rozwinięty" — to
 * wartość domyślna, a skrypt startowy skoryguje ją PRZED malowaniem, gdy
 * użytkownik wybrał pasek zwinięty.
 */
function readCollapsedOnServer(): boolean {
  return false;
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readCollapsed, readCollapsedOnServer);
}

/** Zapis wyboru: atrybut na `<html>`, trwałość w `localStorage`, sygnał subskrybentom. */
export function setSidebarCollapsed(collapsed: boolean): void {
  const next = collapsed ? "collapsed" : "expanded";
  document.documentElement.dataset[SIDEBAR_ATTRIBUTE] = next;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
  } catch {
    // Prywatny tryb przeglądarki potrafi rzucić przy zapisie — preferencja
    // wyglądu nie jest warta wywracania interfejsu, więc łykamy wyjątek.
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

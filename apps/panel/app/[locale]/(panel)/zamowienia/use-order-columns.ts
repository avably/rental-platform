"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  ORDERS_COLUMNS_EVENT,
  ORDERS_COLUMNS_STORAGE_KEY,
  hiddenColumnsFrom,
  serializeHiddenColumns,
  withColumnVisible,
  type OrderColumnKey,
} from "@/lib/orders/order-columns";

/**
 * Odczyt i zapis wyboru widocznych kolumn listy (U5).
 *
 * Wzorzec `useSidebarCollapsed` (#111): prawda mieszka POZA Reactem — tam
 * w atrybucie `<html>`, tu w `localStorage` — a komponenty czytają ją przez
 * `useSyncExternalStore`, zamiast trzymać własną kopię. Dwie kopie tej samej
 * preferencji rozjechałyby się natychmiast, bo czytają ją DWA niezależne
 * miejsca ekranu: menu „Kolumny" w belce i tabela niżej. Zdarzenie
 * `avably:orders-columns` jest kanałem subskrypcji, więc obie odświeżają się
 * razem, bez wspólnego providera.
 *
 * `storage` dokładamy dla DRUGIEJ KARTY: przeglądarka wysyła je tylko do
 * pozostałych dokumentów, więc jedno i drugie zdarzenie się nie dubluje.
 *
 * Snapshotem jest SUROWY STRING z magazynu, a nie gotowy `Set`: `getSnapshot`
 * musi zwracać wartość stabilną referencyjnie, inaczej React wpada w pętlę
 * renderów. Parsowanie idzie przez `useMemo` na tym stringu.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener(ORDERS_COLUMNS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ORDERS_COLUMNS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readRaw(): string {
  try {
    return localStorage.getItem(ORDERS_COLUMNS_STORAGE_KEY) ?? "";
  } catch {
    // Tryb prywatny potrafi rzucić przy odczycie — brak preferencji znaczy
    // komplet kolumn, czyli dokładnie stan sprzed U5.
    return "";
  }
}

/**
 * Render serwerowy (i pierwsza, hydrowana klatka) nie zna `localStorage`, więc
 * zaczyna od kompletu kolumn. Po hydracji hook przełącza się na wartość
 * zapisaną — ukryta kolumna znika, zamiast nigdy się nie pojawić. Świadomy
 * kompromis: HTML z serwera musi być jeden dla wszystkich urządzeń, a
 * preferencja jest per urządzenie.
 */
function readRawOnServer(): string {
  return "";
}

export function useHiddenOrderColumns(): ReadonlySet<OrderColumnKey> {
  const raw = useSyncExternalStore(subscribe, readRaw, readRawOnServer);
  return useMemo(() => hiddenColumnsFrom(raw), [raw]);
}

/** Zapis wyboru: `localStorage` + sygnał do wszystkich subskrybentów. */
export function setOrderColumnVisible(key: OrderColumnKey, visible: boolean): void {
  const next = withColumnVisible(hiddenColumnsFrom(readRaw()), key, visible);
  try {
    localStorage.setItem(ORDERS_COLUMNS_STORAGE_KEY, serializeHiddenColumns(next));
  } catch {
    // Jak w `setSidebarCollapsed`: preferencja wyglądu nie jest warta
    // wywracania ekranu, gdy magazyn odmawia zapisu.
  }
  window.dispatchEvent(new Event(ORDERS_COLUMNS_EVENT));
}

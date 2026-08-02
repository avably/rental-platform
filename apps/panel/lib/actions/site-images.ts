"use server";

/**
 * WYSZUKIWARKA ZDJĘĆ — WEJŚCIE Z KREATORA (K3, ADR-086).
 *
 * Server Action, a nie route handler: to jest wołanie z JEDNEGO ekranu panelu,
 * uwierzytelnione tą samą bramką co reszta kreatora (`requireMember`), bez
 * własnego kontraktu HTTP do utrzymania. Klucz dostawcy zostaje po tej stronie
 * (patrz `lib/unsplash.ts`), a klient dostaje wyłącznie gotowe wyniki.
 *
 * Bramka członkostwa jest tu z rozmysłem: bez niej mielibyśmy publiczny,
 * darmowy serwer proxy do cudzego API na naszym kluczu i naszym limicie.
 */
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { requireMember } from "@/lib/supabase-server";
import {
  searchUnsplash,
  triggerUnsplashDownload,
  unsplashEnabled,
  type UnsplashPhoto,
} from "@/lib/unsplash";

export type SearchPhotosResult =
  | { ok: true; photos: UnsplashPhoto[] }
  | { ok: false; error: string };

const querySchema = z.string().trim().min(2, "Wpisz co najmniej dwa znaki.").max(120);

/** Czy karta wyszukiwarki ma się w ogóle pokazać (fail-safe bez klucza). */
export async function photoSearchAvailable(): Promise<boolean> {
  return unsplashEnabled();
}

export async function searchPhotos(query: string): Promise<SearchPhotosResult> {
  try {
    await requireMember();
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }

  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe zapytanie." };
  }

  const result = await searchUnsplash(parsed.data);
  if (result.ok) return result;
  return {
    ok: false,
    error:
      result.error === "disabled"
        ? "Wyszukiwarka zdjęć jest niedostępna."
        : "Nie udało się pobrać zdjęć. Spróbuj ponownie.",
  };
}

/**
 * Potwierdzenie WYBORU zdjęcia — woła wyzwalacz pobrania u dostawcy (warunek
 * regulaminu). Zwraca `void`: to zobowiązanie wobec dostawcy, a nie krok, od
 * którego zależy poprawność treści, więc jego wynik nie może blokować operatora.
 */
export async function confirmPhotoChoice(downloadLocation: string): Promise<void> {
  try {
    await requireMember();
  } catch {
    return;
  }
  await triggerUnsplashDownload(downloadLocation);
}

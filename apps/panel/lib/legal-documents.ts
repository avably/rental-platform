/**
 * Dokumenty prawne sklepu najemcy (B4, ADR-129) — WALIDACJA WEJŚCIA I COPY
 * ODMÓW, czyli wszystko z tego ekranu, co da się sprawdzić bez sesji i bazy.
 *
 * Schemat jest LUSTREM CHECK-ów migracji 0063 (`legal_documents`): tytuł
 * 1..120 znaków po przycięciu, treść 1..50 000, język z pary ('pl','en'),
 * rodzaj z pary ('terms','privacy'). Lustro nie zastępuje bazy — bramką
 * pozostaje CHECK i RLS — ale zamienia odmowę bazy w komunikat przy polu,
 * zamiast w zbiorczy błąd formularza po pełnym obiegu.
 *
 * COPY ODMÓW mieszka TUTAJ, a nie w module akcji, z dwóch powodów. Moduł
 * `"use server"` nie może eksportować niczego poza funkcjami asynchronicznymi
 * (kontrakt `server-actions-exports-contract`), a test mapowania odmów musi
 * porównywać się z tą samą wartością, którą zwraca produkcja — inaczej broni
 * literału przepisanego do testu, a nie zachowania.
 */
import { z } from "zod";

export const LEGAL_DOCUMENT_KINDS = ["terms", "privacy"] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export const LEGAL_DOCUMENT_LOCALES = ["pl", "en"] as const;
export type LegalDocumentLocale = (typeof LEGAL_DOCUMENT_LOCALES)[number];

/** Lustro CHECK-ów 0063 — te same liczby stoją w `maxLength` pól formularza. */
export const LEGAL_TITLE_MAX_LENGTH = 120;
export const LEGAL_BODY_MAX_LENGTH = 50_000;

export const legalDocumentKindSchema = z.enum(LEGAL_DOCUMENT_KINDS);

export const legalDocumentDraftSchema = z
  .object({
    kind: legalDocumentKindSchema,
    title: z
      .string()
      .trim()
      .min(1, "Podaj tytuł dokumentu.")
      .max(LEGAL_TITLE_MAX_LENGTH, "Tytuł jest za długi (maks. 120 znaków)."),
    body_draft: z
      .string()
      .trim()
      .min(1, "Podaj treść dokumentu.")
      .max(LEGAL_BODY_MAX_LENGTH, "Treść jest za długa (maks. 50 000 znaków)."),
    locale: z.enum(LEGAL_DOCUMENT_LOCALES),
  })
  .strict();

export type LegalDocumentDraftInput = z.infer<typeof legalDocumentDraftSchema>;

const stringValue = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value : "";

export function legalDocumentDraftInputFromFormData(formData: FormData) {
  return {
    kind: stringValue(formData.get("kind")),
    title: stringValue(formData.get("title")),
    body_draft: stringValue(formData.get("body_draft")),
    locale: stringValue(formData.get("locale")),
  };
}

/**
 * Komunikaty odmów. Rozróżnialne, bo prowadzą do RÓŻNYCH czynności: „nie masz
 * prawa" kończy sprawę, „nie ma czego publikować" mówi, co zrobić najpierw.
 */
export const LEGAL_DOCUMENT_MESSAGES = {
  ownerOnly: "Tylko właściciel organizacji może zmieniać i publikować dokumenty prawne.",
  notFound: "Najpierw zapisz szkic dokumentu — dopiero potem da się go opublikować.",
  rejected: "Dokument został odrzucony przez walidację bazy.",
  saveFailed: "Nie udało się zapisać szkicu dokumentu.",
  publishFailed: "Nie udało się opublikować dokumentu.",
  /**
   * Lustro `terms_body` zawiodło. To NIE jest porażka zapisu głównego: szkic
   * jest w bazie, a niezaktualizowany został wyłącznie tekst umowy w PDF.
   * Komunikat mówi dokładnie tyle i ani słowa więcej — „coś poszło nie tak"
   * kazałoby operatorowi zapisywać drugi raz bez powodu.
   */
  mirrorFailed:
    "Szkic zapisany, ale nie udało się przepisać treści do ustawień umów — PDF umowy nadal używa poprzedniego tekstu.",
} as const;

export type LegalPublishResult =
  | { ok: true; created: boolean; versionLabel: string }
  | { ok: false; error: string };

/**
 * JEDNO ŹRÓDŁO TREŚCI REGULAMINU, KIERUNEK JEDNOSTRONNY (decyzja właściciela).
 *
 * Zapis szkicu `terms` przepisuje treść do `tenant_settings.contract_document
 * .terms_body`, bo generator PDF umowy czyta WYŁĄCZNIE to pole (0026,
 * ADR-061). Bez lustra najemca, który poprawi regulamin na tym ekranie,
 * dostawałby w umowie stary tekst i nie miałby jak się o tym dowiedzieć.
 *
 * KIERUNEK JEST JEDNOSTRONNY ŚWIADOMIE. Przepisanie w drugą stronę
 * (ustawienia umów → szkic dokumentu) nadpisywałoby tekst, który być może
 * czeka na publikację, a przede wszystkim nie rozwiązuje właściwego problemu:
 * PDF ma docelowo czytać OPUBLIKOWANĄ wersję z `legal_document_versions`, a
 * nie kopię w ustawieniach. To osobny PR tego samego epiku — do tego czasu
 * lustro jest najtańszym sposobem, żeby oba miejsca mówiły to samo.
 *
 * Zwraca `null`, gdy wiersza `contract_document` NIE MA albo ma kształt, do
 * którego nie da się dopisać klucza. Wiersza NIE WOLNO tworzyć od zera: CHECK
 * z 0026 wymaga kompletu pięciu kluczy (address, nip, email, terms_version,
 * terms_body), a czterech z nich ten ekran nie zna.
 */
export function withMirroredTermsBody(
  value: unknown,
  body: string,
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  // Brak `terms_body` w istniejącym wierszu znaczy, że to nie jest wiersz
  // umowy w kształcie z 0026 — dopisanie klucza i tak odbiłoby się od CHECK-a.
  if (typeof current.terms_body !== "string") return null;
  return { ...current, terms_body: body };
}

/** Skrót sha256 do okazania w historii — 12 znaków wystarczy do porównania. */
export function shortChecksum(sha256: string): string {
  return sha256.slice(0, 12);
}

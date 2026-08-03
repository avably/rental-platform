/**
 * Walidacja wejść akcji modelu sekcyjnego storefrontu (Zadanie 2.3a, ADR-041).
 * Kształt TREŚCI sekcji pochodzi WYŁĄCZNIE z @avably/core/site — ten moduł
 * dokłada tylko otoczkę akcji (identyfikatory, pozycje, spójność reorderu).
 * Czyste funkcje/schematy — testowalne bez kontekstu Next (test/site-validation.test.ts).
 *
 * Komunikaty po polsku — wzorzec repo (lib/validation.ts).
 */
import { z } from "zod";

import {
  STARTER_TEMPLATES,
  sectionInputSchema,
  siteStyleSchema,
} from "@avably/core/site";

import { uuidSchema } from "./catalog-validation";

/**
 * Wynik akcji modelu sekcyjnego — kontrakt dla edytora 2.3b. Rozmyślnie NIE
 * FormState (te akcje woła edytor programowo, nie useActionState z FormData);
 * `error` jest gotowym komunikatem dla operatora.
 */
export type SiteActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Górna granica pozycji/liczby sekcji — strona to kilkanaście sekcji, nie tysiące. */
export const MAX_SECTIONS = 100;

const positionSchema = z.number().int().min(0).max(1_000_000);

/**
 * Wejście upsertu sekcji. `sectionId` obecne = aktualizacja draftu istniejącej
 * sekcji (typ NIEZMIENNY — zmiana typu to usunięcie + dodanie, inaczej stara
 * treść published innego kształtu wisiałaby pod nowym typem); nieobecne =
 * dodanie nowej sekcji na końcu (albo na podanej pozycji).
 */
export const upsertSectionInputSchema = z
  .object({
    siteId: uuidSchema,
    sectionId: uuidSchema.optional(),
    position: positionSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .and(sectionInputSchema);
export type UpsertSectionInput = z.infer<typeof upsertSectionInputSchema>;

export const reorderSectionsInputSchema = z.object({
  siteId: uuidSchema,
  orderedIds: z
    .array(uuidSchema)
    .min(1, "Kolejność nie może być pusta.")
    .max(MAX_SECTIONS, "Za dużo sekcji."),
});

export const toggleSectionInputSchema = z.object({
  sectionId: uuidSchema,
  enabled: z.boolean(),
});


/**
 * Wejście zapisu STYLU STRONY (K5, ADR-090). Kształt samego stylu pochodzi
 * z @avably/core/site — tu jest tylko otoczka akcji, jak przy sekcjach.
 *
 * Styl jedzie w CAŁOŚCI, a nie jako łatka pojedynczego pola. Scalanie po
 * stronie serwera („zmień sam akcent, resztę zostaw") wymagałoby odczytu przed
 * zapisem, a to jest wyścig: dwie karty kreatora otwarte na tej samej stronie
 * nadpisywałyby sobie nawzajem wybór, i to niedeterministycznie. Panel trzyma
 * pełny stan stylu i odsyła go w komplecie — ostatni zapis wygrywa, ale wygrywa
 * PRZEWIDYWALNIE.
 */
export const updateSiteStyleInputSchema = z.object({
  siteId: uuidSchema,
  style: siteStyleSchema,
});
export type UpdateSiteStyleInput = z.infer<typeof updateSiteStyleInputSchema>;

/**
 * Wejście zastosowania SZABLONU STARTOWEGO (K5, ADR-090) — operacja
 * DESTRUKCYJNA dla szkicu, stąd `confirm` w interfejsie, a nie tutaj: schemat
 * pilnuje kształtu, a nie intencji operatora.
 *
 * `locale` decyduje o języku treści przykładowej i degraduje do PL tak samo jak
 * presety sekcji (`presetContentFor`) — jedna zasada dla całej treści startowej.
 */
export const applyStarterTemplateInputSchema = z.object({
  siteId: uuidSchema,
  starterId: z.enum(STARTER_TEMPLATES),
  locale: z.string().trim().min(2).max(10),
});
export type ApplyStarterTemplateInput = z.infer<typeof applyStarterTemplateInputSchema>;

/**
 * Plan zmiany kolejności: orderedIds musi być PERMUTACJĄ kompletu sekcji
 * strony. Podzbiór (sekcja pominięta) albo obcy id oznaczałyby cichą utratę
 * lub przywłaszczenie pozycji — odmawiamy zamiast zgadywać. Zwraca listę
 * (id → position) do zapisania albo komunikat odmowy.
 */
export function reorderPlan(
  currentIds: readonly string[],
  orderedIds: readonly string[],
): { ok: true; updates: { id: string; position: number }[] } | { ok: false; error: string } {
  if (new Set(orderedIds).size !== orderedIds.length) {
    return { ok: false, error: "Kolejność zawiera zduplikowane sekcje." };
  }
  const current = new Set(currentIds);
  if (orderedIds.length !== current.size || orderedIds.some((id) => !current.has(id))) {
    return {
      ok: false,
      error: "Kolejność nie obejmuje dokładnie wszystkich sekcji strony — odśwież edytor.",
    };
  }
  return { ok: true, updates: orderedIds.map((id, index) => ({ id, position: index })) };
}

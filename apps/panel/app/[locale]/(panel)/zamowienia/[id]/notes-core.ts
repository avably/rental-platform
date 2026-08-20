/**
 * Rdzeń notatek zamówienia — LISTA WPISÓW (ADR-079).
 *
 * Wydzielony z `notes-actions.ts` ("use server"), bo plik z dyrektywą
 * serwerową może eksportować WYŁĄCZNIE akcje (async funkcje wołane z klienta);
 * eksport stałej albo zwykłej funkcji wywraca cały moduł na build-time
 * („no exports at all"). Tu mieszkają więc schematy Zod i funkcje operujące na
 * przekazanym kliencie Supabase — testowalne bez cookies żądania, dokładnie tą
 * samą sesją członka, którą realnie wykonuje akcja (wzorzec deposit-settle.ts).
 *
 * BRAMKĄ JEST RLS TENANTA (0039), nie filtr w zapytaniu. `eq("tenant_id", …)`
 * jest drugą warstwą i wygodą diagnostyczną; polityki odfiltrowałyby cudzy
 * wiersz nawet bez niego. O wyniku mutacji decyduje ODCZYT PO ZAPISIE
 * (`.select("id")`), nie brak błędu: PostgREST na UPDATE/DELETE, który nie
 * trafił w żaden wiersz, odpowiada 204 bez błędu — cisza wyglądałaby jak
 * udana zmiana cudzej albo nieistniejącej notatki.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { uuidSchema } from "@/lib/order-validation";

/** Górny limit == CHECK-owi z 0039 (btrim między 1 a 10000) — jedno źródło prawdy. */
export const NOTE_BODY_MAX = 10_000;

const bodySchema = z
  .string()
  .trim()
  .min(1, "Wpisz treść notatki.")
  .max(NOTE_BODY_MAX, `Notatka może mieć maksymalnie ${NOTE_BODY_MAX} znaków.`);

export const addOrderNoteSchema = z.object({
  orderId: uuidSchema,
  body: bodySchema,
});

export const editOrderNoteSchema = z.object({
  noteId: uuidSchema,
  body: bodySchema,
});

export const deleteOrderNoteSchema = z.object({
  noteId: uuidSchema,
});

export type AddOrderNoteInput = z.infer<typeof addOrderNoteSchema>;
export type EditOrderNoteInput = z.infer<typeof editOrderNoteSchema>;
export type DeleteOrderNoteInput = z.infer<typeof deleteOrderNoteSchema>;

/** Wynik operacji rdzenia — akcja mapuje go na FormState. */
export type NoteResult = { ok: true } | { ok: false; formError: string };

const NOTE_ADD_DENIED =
  "Nie udało się dodać notatki - zamówienie nie istnieje albo nie masz do niego dostępu.";
const NOTE_MISSING =
  "Nie udało się zapisać zmiany - notatka nie istnieje albo nie masz do niej dostępu.";

/** Jeden wiersz listy notatek — kształt odczytu w szczególe zamówienia. */
export interface OrderNoteRow {
  id: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Dodaje wpis. `created_by` = wołający członek zespołu (autor wpisu) — to
 * JEDYNE miejsce, w którym autorstwo powstaje; pominięcie go dałoby wpis bez
 * autora (dowiedzione testem mutacyjnym). Wstawienie do cudzego zamówienia
 * pada na FK złożonym (23503) albo polityce WITH CHECK (42501), nigdy cicho.
 */
export async function addOrderNote(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  input: AddOrderNoteInput,
): Promise<NoteResult> {
  const { data, error } = await supabase
    .from("order_notes")
    .insert({
      tenant_id: tenantId,
      order_id: input.orderId,
      body: input.body,
      created_by: userId,
    })
    .select("id");

  if (error) return { ok: false, formError: error.message };
  if (!data || data.length === 0) return { ok: false, formError: NOTE_ADD_DENIED };
  return { ok: true };
}

/**
 * Edytuje treść wpisu. Edycja CUDZEGO wpisu w obrębie tenanta jest dozwolona
 * świadomie (mały zespół — ADR-079); bramką pozostaje tenant_id. Odczyt po
 * zapisie odróżnia „zapisano" od „wiersz spoza zasięgu" (patrz nagłówek).
 */
export async function editOrderNote(
  supabase: SupabaseClient,
  tenantId: string,
  input: EditOrderNoteInput,
): Promise<NoteResult> {
  const { data, error } = await supabase
    .from("order_notes")
    .update({ body: input.body })
    .eq("tenant_id", tenantId)
    .eq("id", input.noteId)
    .select("id");

  if (error) return { ok: false, formError: error.message };
  if (!data || data.length === 0) return { ok: false, formError: NOTE_MISSING };
  return { ok: true };
}

/** Twarde usunięcie wpisu (notatka to nie rekord finansowy — ADR-079). */
export async function deleteOrderNote(
  supabase: SupabaseClient,
  tenantId: string,
  input: DeleteOrderNoteInput,
): Promise<NoteResult> {
  const { data, error } = await supabase
    .from("order_notes")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", input.noteId)
    .select("id");

  if (error) return { ok: false, formError: error.message };
  if (!data || data.length === 0) return { ok: false, formError: NOTE_MISSING };
  return { ok: true };
}

"use server";

/**
 * Akcje notatek zamówienia — LISTA WPISÓW (uwaga właściciela, runda
 * 2026-07-28: „notatki powinny być listą… każda kolejna trafia do listy, nie
 * do uzupełnianego inputa"). ADR-079.
 *
 * Cienka warstwa serwerowa: parsuje FormData, bramkuje `requireMember`, woła
 * rdzeń z `notes-core.ts` (tam RLS, odczyt-po-zapisie, autor), odświeża stronę.
 * Rozdział wymuszony dyrektywą "use server" — plik-akcja nie może eksportować
 * niczego poza akcjami (patrz nagłówek notes-core.ts).
 */
import { revalidatePath } from "next/cache";

import { AuthError, type AuthContext } from "@/lib/auth";
import { assertClosableOrder } from "@/lib/closing";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import {
  addOrderNote,
  addOrderNoteSchema,
  deleteOrderNote,
  deleteOrderNoteSchema,
  editOrderNote,
  editOrderNoteSchema,
} from "./notes-core";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

const NO_TENANT = "Sesja nie wskazuje najemcy — zaloguj się ponownie.";

/**
 * Predykat zamrożonego zbioru dla akcji PO IDENTYFIKATORZE NOTATKI (edycja,
 * usunięcie): zamówienie znamy dopiero z wiersza notatki. Poza trybem
 * domykania — no-op bez zapytań (jak assertClosableOrder).
 */
async function assertClosableNote(ctx: AuthContext, noteId: string): Promise<void> {
  if (!ctx.closing) return;
  const { data: note, error } = await ctx.supabase
    .from("order_notes")
    .select("order_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", noteId)
    .maybeSingle();
  if (error) {
    throw new Error(`Nie udało się zweryfikować notatki w oknie domykania: ${error.message}`);
  }
  if (!note) {
    // Nie ma czego pilnować — rdzeń i tak odmówi na braku wiersza; nie
    // robimy z predykatu drugiej wyroczni istnienia.
    return;
  }
  await assertClosableOrder(ctx, (note as { order_id: string }).order_id);
}

export async function addOrderNoteAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = addOrderNoteSchema.safeParse({
    orderId: str(formData.get("orderId")),
    body: str(formData.get("body")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138): notatki dokumentują spory przy
  // wydaniu/zwrocie — zawężone do zamrożonego zbioru.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  if (!ctx.tenantId) return { formError: NO_TENANT };

  const result = await addOrderNote(ctx.supabase, ctx.tenantId, ctx.user.id, parsed.data);
  if (!result.ok) return { formError: result.formError };

  revalidatePath("/", "layout");
  return { success: "added" };
}

export async function editOrderNoteAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = editOrderNoteSchema.safeParse({
    noteId: str(formData.get("noteId")),
    body: str(formData.get("body")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138) — zbiór po zamówieniu wskazanym notatką.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableNote(ctx, parsed.data.noteId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  if (!ctx.tenantId) return { formError: NO_TENANT };

  const result = await editOrderNote(ctx.supabase, ctx.tenantId, parsed.data);
  if (!result.ok) return { formError: result.formError };

  revalidatePath("/", "layout");
  return { success: "edited" };
}

export async function deleteOrderNoteAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteOrderNoteSchema.safeParse({
    noteId: str(formData.get("noteId")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138) — jak w edycji.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableNote(ctx, parsed.data.noteId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  if (!ctx.tenantId) return { formError: NO_TENANT };

  const result = await deleteOrderNote(ctx.supabase, ctx.tenantId, parsed.data);
  if (!result.ok) return { formError: result.formError };

  revalidatePath("/", "layout");
  return { success: "deleted" };
}

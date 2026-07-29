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

import { AuthError } from "@/lib/auth";
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

export async function addOrderNoteAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = addOrderNoteSchema.safeParse({
    orderId: str(formData.get("orderId")),
    body: str(formData.get("body")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
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

  let ctx;
  try {
    ctx = await requireMember();
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

  let ctx;
  try {
    ctx = await requireMember();
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

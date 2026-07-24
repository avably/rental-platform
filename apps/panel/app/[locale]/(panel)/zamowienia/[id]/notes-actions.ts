"use server";

/**
 * Notatka zamówienia (uwaga właściciela N6: „no a te notatki gdzieś się
 * dodaje?").
 *
 * Kolumna `orders.notes` istnieje od 0007 i do tej pory była WYŁĄCZNIE
 * wyświetlana — czyli pole, które umiał wypełnić tylko ktoś z dostępem do
 * bazy. BEZ MIGRACJI: nie ma czego migrować, brakowało wyłącznie zapisu.
 *
 * BRAMKĄ JEST RLS TENANTA, NIE FILTR W ZAPYTANIU. `eq("tenant_id", …)`
 * niżej jest drugą warstwą i wygodą diagnostyczną; polityki z 0007
 * odfiltrowałyby cudzy wiersz nawet bez niego. Dlatego o wyniku decyduje
 * ODCZYT PO ZAPISIE (`.select("id")`), a nie brak błędu: PostgREST na
 * UPDATE, który nie trafił w żaden wiersz, odpowiada 204 bez ani jednego
 * błędu — cisza wyglądałaby jak zapisana notatka.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import { orderNotesSchema } from "./deposit-settle";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

export async function updateOrderNotesAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = orderNotesSchema.safeParse({
    orderId: str(formData.get("orderId")),
    notes: str(formData.get("notes")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  const tenantId = ctx.tenantId;
  if (!tenantId) {
    return { formError: "Sesja nie wskazuje najemcy — zaloguj się ponownie." };
  }

  const { data, error } = await ctx.supabase
    .from("orders")
    .update({ notes: parsed.data.notes })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.orderId)
    .select("id");

  if (error) return { formError: error.message };
  if (!data || data.length === 0) {
    return { formError: "Nie udało się zapisać notatki — zamówienie nie istnieje albo nie masz do niego dostępu." };
  }

  revalidatePath("/", "layout");
  return { success: "notes" };
}

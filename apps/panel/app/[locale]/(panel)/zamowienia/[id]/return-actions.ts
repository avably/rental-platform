"use server";

/**
 * Akcja ZWROTU CZĘŚCIOWEGO (ADR-272): operator odznacza, które pozycje
 * zamówienia fizycznie wróciły. Każde przełączenie woła RPC
 * `app.return_order_items`, który stempluje/kasuje `order_items.returned_at`.
 *
 * ================== BRAMKI, KTÓRYCH TEN MODUŁ NIE OMIJA ==================
 *
 * 1. TENANT-SCOPE + ŻYWY CZŁONEK. Autoryzacja siedzi w RPC (SECURITY DEFINER
 *    z jawnym `app.tenant_id()` + `app.is_current_tenant_member()`), a nie
 *    w tym module — cudze zamówienie „nie istnieje" (P0002), nie ma osobnej
 *    ścieżki obejścia przez service-role.
 * 2. DOSTĘPNOŚĆ PRZY ODWRÓCENIU. Odznaczenie (returned=false) przechodzi
 *    w bazie przez re-check `app.assert_unit_available`: egzemplarz zajęty
 *    w międzyczasie przez inne zamówienie NIE wraca do najmu (23P01). Kod
 *    rozpoznajemy po SQLSTATE, nie po treści — komunikat bramki nie niesie
 *    identyfikatorów (ADR-181).
 * 3. STAN ZAMÓWIENIA. RPC działa wyłącznie na zamówieniu `picked_up`; próba
 *    na innym stanie wraca 22023 i jest tu tłumaczona na zdanie dla operatora.
 *
 * KAUCJA — POZA ZAKRESEM. Zwrot częściowy rusza wyłącznie inwentarz; kaucja
 * rozlicza się przy pełnym zwrocie, w sekcji kaucji (ADR-027).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { requireMember } from "@/lib/supabase-server";

/** Kod bramki dostępności (assert_unit_available) — egzemplarz zajęty. */
const PG_UNIT_CONFLICT = "23P01";

export interface ReturnProgress {
  totalCount: number;
  returnedCount: number;
  allReturned: boolean;
}

export interface ReturnActionState {
  error?: string;
  progress?: ReturnProgress;
}

const toggleSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string().uuid(),
  returned: z.boolean(),
});

export async function toggleItemReturnAction(input: {
  orderId: string;
  itemId: string;
  returned: boolean;
}): Promise<ReturnActionState> {
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Nieprawidłowe dane pozycji - odśwież stronę." };
  }
  const { orderId, itemId, returned } = parsed.data;

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  const { data, error } = await ctx.supabase.schema("app").rpc("return_order_items", {
    p_order_id: orderId,
    p_item_ids: [itemId],
    p_returned: returned,
  });

  if (error) {
    // Odmowa po SQLSTATE, nie po treści (ADR-181): ta sama bramka odmawia
    // niezalogowanemu klientowi sklepu, więc jej komunikat nie jest nośnikiem
    // danych operacyjnych.
    if (error.code === PG_UNIT_CONFLICT) {
      return {
        error:
          "Nie można cofnąć zwrotu - egzemplarz zajęło w międzyczasie inne " +
          "zamówienie w tym terminie.",
      };
    }
    if (error.code === "22023") {
      return { error: "Zwrot pozycji jest możliwy tylko dla zamówienia wydanego." };
    }
    if (error.code === "P0002") {
      return { error: "Zamówienie nie istnieje - odśwież stronę." };
    }
    if (error.code === "42501") {
      return { error: "Brak uprawnień do tego zamówienia." };
    }
    return { error: error.message };
  }

  const row = data as { total_count: number; returned_count: number; all_returned: boolean };

  revalidatePath("/", "layout");
  return {
    progress: {
      totalCount: row.total_count,
      returnedCount: row.returned_count,
      allReturned: row.all_returned,
    },
  };
}

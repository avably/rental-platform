"use server";

/**
 * Akcje widoku PM przeglądu (ADR-071). Jak reszta akcji /admin: guard
 * `requireSuperadminPage()` dla UX, egzekucja w RLS 0033 (klient z sesją,
 * zero service_role). Endpoint i akcja żyją tylko przy REVIEW_MODE=1.
 */
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireSuperadminPage } from "@/lib/superadmin";

const toggleSchema = z.object({
  id: z.uuid(),
  status: z.enum(["open", "done"]),
});

export async function toggleReviewStatusAction(formData: FormData): Promise<void> {
  if (process.env.REVIEW_MODE !== "1") notFound();
  const ctx = await requireSuperadminPage("/admin/przeglad-uwagi");

  const parsed = toggleSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;

  const { error } = await ctx.supabase
    .from("review_comments")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id);
  if (error) throw new Error(`Zmiana statusu uwagi: ${error.message}`);

  revalidatePath("/admin/przeglad-uwagi");
}

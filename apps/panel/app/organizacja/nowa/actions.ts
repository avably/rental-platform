"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createTenantSchema } from "@/lib/validation";

export interface CreateTenantState {
  error?: string;
}

export async function createTenantAction(
  _prevState: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const parsed = createTenantSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    redirect("/login");
  }

  const { error } = await supabase.schema("app").rpc("create_tenant", {
    p_slug: parsed.data.slug,
    p_name: parsed.data.name,
  });
  if (error) {
    // Komunikaty RAISE EXCEPTION z app.create_tenant (0003_auth.sql) są już
    // po polsku i bezpieczne do pokazania userowi wprost.
    return { error: error.message };
  }

  // JWT bieżącej sesji nie ma jeszcze świeżego claimu tenant_id (hook
  // wstrzykuje go dopiero przy WYSTAWIENIU tokenu) — wymuszamy nowy token.
  await supabase.auth.refreshSession();

  redirect("/");
}

"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { acceptInvitationSchema } from "@/lib/validation";

export interface AcceptInvitationState {
  error?: string;
}

export async function acceptInvitationAction(
  _prevState: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const parsed = acceptInvitationSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowy token." };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    redirect(await localePath("/login", { next: `/zaproszenie/${parsed.data.token}` }));
  }

  const { error } = await supabase.schema("app").rpc("accept_invitation", {
    p_token: parsed.data.token,
  });
  if (error) {
    return { error: error.message };
  }

  // Jak przy create_tenant: JWT bieżącej sesji nie ma jeszcze świeżego
  // claimu tenant_id/role, więc wymuszamy nowy token przed przekierowaniem.
  await supabase.auth.refreshSession();

  redirect(await localePath("/"));
}

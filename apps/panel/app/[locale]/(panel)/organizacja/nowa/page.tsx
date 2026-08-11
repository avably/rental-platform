import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { CreateTenantForm } from "./form";

/**
 * Onboarding organizacji — ekran WYŁĄCZNIE dla sesji BEZ organizacji
 * (C1 UI-only, UX1/ADR-140).
 *
 * Sesja, która JUŻ MA organizację, jest odsyłana na `/` — lustrzanie do
 * guardu logowania (login/actions.ts): sesja bez tenanta idzie TUTAJ, sesja
 * z tenantem NA PULPIT. Powód: hook tokenów wybiera najstarsze członkostwo,
 * więc druga organizacja byłaby po utworzeniu NIEOSIĄGALNA (przełącznika nie
 * ma w UI ani w schemacie — audyt IA-4); ekran zapraszający do jej założenia
 * to pułapka, nie funkcja. RPC `create_tenant` (limit 2) celowo BEZ ZMIAN —
 * domknięcie po stronie bazy to osobny punkt backlogu przy najbliższej
 * migracji (ADR-140); C2/C3 (wybór organizacji / przełącznik) dopiero przy
 * realnym popycie.
 */
export default async function NewTenantPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));
  if (ctx.tenantId) redirect(await localePath("/"));

  return (
    <div className="flex flex-col justify-center gap-4">
      <p className="text-sm text-muted-foreground">
        Zostaniesz właścicielem (owner) nowej organizacji.
      </p>
      <CreateTenantForm />
    </div>
  );
}

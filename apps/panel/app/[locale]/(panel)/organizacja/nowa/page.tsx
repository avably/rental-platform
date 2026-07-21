import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { CreateTenantForm } from "./form";

export default async function NewTenantPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  return (
    <div className="flex flex-col justify-center gap-4">
      <p className="text-sm text-muted-foreground">
        Zostaniesz właścicielem (owner) nowej organizacji. Możesz mieć maks. 2 organizacje.
      </p>
      <CreateTenantForm />
    </div>
  );
}

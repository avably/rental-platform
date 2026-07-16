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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Załóż organizację</h1>
      <p className="text-sm text-gray-600">
        Zostaniesz właścicielem (owner) nowej organizacji. Możesz mieć maks. 2 organizacje.
      </p>
      <CreateTenantForm />
    </main>
  );
}

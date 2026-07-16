import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { TotpEnrollForm } from "./form";

export default async function SecurityPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect("/login");

  const t = await getTranslations("security");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <TotpEnrollForm />
    </main>
  );
}

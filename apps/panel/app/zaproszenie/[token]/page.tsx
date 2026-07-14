import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { AcceptInvitationForm } from "./form";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(`/login?next=/zaproszenie/${token}`);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Zaproszenie do organizacji</h1>
      <p className="text-sm text-gray-600">Zalogowany jako {ctx.user.email}.</p>
      <AcceptInvitationForm token={token} />
    </main>
  );
}

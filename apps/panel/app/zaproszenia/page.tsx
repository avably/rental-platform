import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/logout";
import { requireMember } from "@/lib/supabase-server";

import { InviteMemberForm } from "./form";

export default async function InvitationsPage() {
  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) redirect(err.status === 401 ? "/login" : "/");
    throw err;
  }

  const { data: invitations } = await ctx.supabase
    .from("invitations")
    .select("id, email, role, accepted_at, expires_at, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <header className="flex items-center justify-between text-sm">
        <span>{ctx.user.email}</span>
        <form action={logoutAction}>
          <button type="submit" className="underline">
            Wyloguj
          </button>
        </form>
      </header>
      <h1 className="text-xl font-semibold">Zaproszenia członków</h1>
      <InviteMemberForm />
      <section>
        <h2 className="mb-2 text-sm font-semibold">Wysłane zaproszenia</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {(invitations ?? []).map((invitation) => (
            <li key={invitation.id}>
              {invitation.email} · {invitation.role} ·{" "}
              {invitation.accepted_at ? "zaakceptowane" : "oczekuje"}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

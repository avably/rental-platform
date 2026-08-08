/**
 * Odczyt zespołu tenanta — moduł BEZ dyrektyw (wzorzec `delivery.ts`).
 *
 * Nie może mieszkać w `team-actions.ts`: plik z "use server" wystawia KAŻDY
 * swój eksport jako punkt wejścia akcji serwerowej, a `loadTeamMembers`
 * przyjmuje kontekst z klientem Supabase — czyli argument, którego nie da się
 * (i nie wolno) serializować z przeglądarki.
 */
import type { requireMember } from "@/lib/supabase-server";

/** Wiersz listy zespołu — rola z `members`, adres z app.tenant_member_emails(). */
export interface TeamMemberRow {
  userId: string;
  email: string | null;
  role: "owner" | "staff";
  createdAt: string;
}

/**
 * Lista członków tenanta WOŁAJĄCEGO.
 *
 * Adresy e-mail biorą się z `app.tenant_member_emails()` (0039) — funkcji,
 * która zakres liczy z `app.tenant_id()`, czyli z claimu JWT żądania, a nie
 * z argumentu. Dzięki temu ekran zespołu nie potrzebuje ani service-role, ani
 * nowej funkcji SECURITY DEFINER: `public.members` nie trzyma adresów (te są
 * w `auth.users`, do której `authenticated` nie ma dostępu), a mapa
 * uuid→e-mail własnego tenanta już istniała na potrzeby autorstwa notatek.
 *
 * Brak adresu (osoba skasowała konto między zapytaniami) to `null`, nie
 * zmyślona wartość — ekran pokazuje wtedy „—".
 */
export async function loadTeamMembers(
  ctx: Awaited<ReturnType<typeof requireMember>>,
): Promise<TeamMemberRow[]> {
  const [membersResult, emailsResult] = await Promise.all([
    ctx.supabase
      .from("members")
      .select("user_id, role, created_at")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: true }),
    ctx.supabase.schema("app").rpc("tenant_member_emails"),
  ]);

  const emails = new Map(
    ((emailsResult.data ?? []) as { user_id: string; email: string | null }[]).map((row) => [
      row.user_id,
      row.email,
    ]),
  );

  return ((membersResult.data ?? []) as { user_id: string; role: string; created_at: string }[]).map(
    (row) => ({
      userId: row.user_id,
      email: emails.get(row.user_id) ?? null,
      role: row.role as "owner" | "staff",
      createdAt: row.created_at,
    }),
  );
}

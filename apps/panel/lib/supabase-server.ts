/**
 * Klient Supabase server-side (RSC/Route Handlers/Server Actions) osadzony w
 * cookies żądania Next.js oraz owijki `requireMember`/`requireSuperadmin`
 * używane bezpośrednio w kodzie panelu (patrz lib/auth.ts po rdzeń
 * testowalny bez next/headers).
 */
import { cookies } from "next/headers";

import { createServerClient, type Role } from "@avably/db";

import { requireMemberWithClient, requireSuperadminWithClient, type AuthContext } from "./auth";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Wywołane z Server Component (odczyt, nie Route Handler/Server
        // Action) — zapis cookies tam jest no-opem; proxy.ts odświeża
        // sesję (i zapisuje cookies) przy każdym żądaniu, więc to bezpieczne.
      }
    },
  });
}

/** Guard dla Server Components/Actions/Route Handlers panelu. */
export async function requireMember(role?: Role): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  return requireMemberWithClient(supabase, role);
}

/** Guard superadmina (claim superadmin + aal2) dla panelu. */
export async function requireSuperadmin(): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  return requireSuperadminWithClient(supabase);
}

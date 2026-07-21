import { SidebarNav } from "@/components/shell/sidebar-nav";
import { PanelTopbar } from "@/components/shell/panel-topbar";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Shell tras tenanta (ADR-056).
 *
 * Grupa `(panel)` nie wchodzi do adresu — `/zamowienia` zostaje
 * `/zamowienia`. Dzięki temu shell obejmuje wyłącznie ekrany tenanta, a
 * `(auth)`, `(superadmin)`, publiczny akcept zaproszenia i galeria
 * `/design-system` zostają poza nim, bez ruszania jednego znaku w linkach.
 *
 * Layout NIE jest guardem: kontekst czytamy wyłącznie po to, żeby belka
 * pokazała tożsamość sesji. Każdy ekran trzyma własne sprawdzenie dostępu
 * (`requireMemberPage` / `getAuthContext`), a strona główna panelu celowo
 * wpuszcza zalogowanego BEZ organizacji — dokładanie tu przekierowania
 * zrobiłoby z tego pętlę.
 */
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getAuthContext(await createSupabaseServerClient());

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="border-border bg-sidebar hidden w-[236px] shrink-0 border-r md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto">
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelTopbar userEmail={ctx?.user.email ?? ""} />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

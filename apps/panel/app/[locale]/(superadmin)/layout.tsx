import Link from "next/link";

/**
 * Powłoka panelu superadmina. Guard nie siedzi tutaj (layouty w App Routerze
 * nie chronią route handlerów ani nie są przeliczane przy każdej nawigacji) —
 * każda strona i akcja woła `requireSuperadminPage()` u siebie, bliżej danych.
 */
export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4 text-sm">
          <span className="font-semibold">Superadmin</span>
          <Link className="text-gray-600 hover:text-gray-900" href="/admin/tenants">
            Organizacje
          </Link>
          <Link className="text-gray-600 hover:text-gray-900" href="/admin/audit">
            Dziennik zdarzeń
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

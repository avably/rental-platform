import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { PUBLIC_PAGES, REVIEW_PAGES } from "@/lib/marketing/template";

/**
 * Indeks przeglądu dla właściciela: komplet przeniesionych stron i wariantów
 * w jednym miejscu, żeby dało się je obejrzeć ciągiem i wskazać, który układ
 * zostaje per typ strony. Świadomie POZA szablonem — to narzędzie robocze,
 * nie część produktu, więc nie ładuje jego arkuszy i nie wchodzi do sitemap.
 */
export const metadata: Metadata = {
  title: "Przegląd układów — Avably",
  robots: { index: false, follow: false },
};

const ROUTE_OF: Record<string, string> = { home: "" };

function routeFor(page: string): string {
  return ROUTE_OF[page] ?? page;
}

export default async function ReviewIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const groups = [
    { title: "Strony publiczne (linkowane, indeksowane)", pages: PUBLIC_PAGES },
    { title: "Warianty do wyboru (noindex, poza nawigacją)", pages: REVIEW_PAGES },
  ];

  return (
    <main
      style={{
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        margin: "0 auto",
        maxWidth: "48rem",
        padding: "3rem 1.5rem",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", letterSpacing: "-0.02em" }}>Przegląd układów</h1>
      <p style={{ color: "#55616D", lineHeight: 1.6 }}>
        Komplet stron przeniesionych z szablonu. Warianty są do wyboru — treść uzupełniamy na
        tych, które zostaną.
      </p>
      {groups.map((group) => (
        <section key={group.title} style={{ marginTop: "2.5rem" }}>
          <h2 style={{ fontSize: "1rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {group.title}
          </h2>
          <ul style={{ lineHeight: 2, paddingLeft: "1.25rem" }}>
            {group.pages.map((page) => (
              <li key={page}>
                <a href={`/${locale}/${routeFor(page)}`}>{`/${locale}/${routeFor(page)}`}</a>
                {page === "home" ? " — landing" : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p style={{ color: "#55616D", marginTop: "2.5rem" }}>
        Ta strona jest narzędziem roboczym: nie ma jej w nawigacji ani w sitemap.
      </p>
    </main>
  );
}

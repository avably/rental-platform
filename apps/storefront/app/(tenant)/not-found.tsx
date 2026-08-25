import Link from "next/link";

import { categoryNavItems } from "@/lib/catalog/category-nav";
import { PageShell } from "@/components/storefront/page-shell";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { pageTitle } from "@/lib/seo/tenant-metadata";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
import { getStorefrontCopy } from "@/lib/storefront/copy";
import { loadStorefrontContext } from "@/lib/storefront/context";

/**
 * 404 SKLEPU NAJEMCY (L-UX-01, ADR-197) — cel każdego `notFound()` z tras
 * grupy `(tenant)`: zdjęta pozycja katalogu, zły permalink dokumentu, numer
 * strony spoza zakresu. Do ADR-197 lądowały we WBUDOWANYM 404 Nexta:
 * angielskim, bez motywu najemcy i bez wyjścia — klient „wypadał" ze sklepu
 * na stronę, która wyglądała jak awaria platformy.
 *
 * DWIE GAŁĘZIE, ta sama zasada co w layoucie osi (fallback `lang="pl"`):
 *   • tenant rozwiązany → PEŁNA POWŁOKA SKLEPU (PageShell: motyw, znak,
 *     stopka — te same prymitywy co każda podstrona), copy w JĘZYKU NAJEMCY
 *     (`tenants.locale` — oś tenancka nie ma locale w URL), wyjście do
 *     `/katalog`; `term={null}`, bo 404 nie sprzedaje (wzorzec dokumentów
 *     prawnych);
 *   • kontekstu nie ma (wejście spoza gałęzi tenanckiej albo katalog
 *     nieczytelny — fail-closed jak w layoucie) → minimalny ekran bez motywu
 *     w PL, spójnie z `lang` layoutu dla tej samej gałęzi.
 *
 * NIE dotyczy odmów middleware'u (ADR-131): nierozwiązany host i zły kształt
 * ścieżki dostają neutralne `text/plain` ZANIM router cokolwiek zobaczy —
 * tam nierozróżnialność jest celem i ten ekran niczego w niej nie zmienia.
 * Tu tenant JEST rozwiązany, więc branding niczego nie zdradza.
 *
 * Jedyny `h1` strony jest tutaj — powłoka nagłówka sklepu nie niesie h1
 * (nazwa sklepu to link), dokładnie jak na stronie sprzętu (ADR-189).
 *
 * ==================== TYTUŁ DOKUMENTU (S-57 audytu 2026-08-25) ====================
 *
 * Ten ekran nie miał `<title>` W OGÓLE — karta przeglądarki, historia i
 * zakładka pokazywały goły adres (WCAG 2.4.2 „Page Titled"). Nie był to brak
 * przeoczony w metadanych, tylko brak z BUDOWY: `notFound()` z tras sklepu
 * wychodzi po tym, jak `generateMetadata` trasy oddało `{}` (patrz
 * `produkt/[slug]/page.tsx`), a `not-found.tsx` własnego `generateMetadata`
 * nie ma jak wystawić — musiałoby ono znać kontekst najemcy, którego ta
 * konwencja Nexta nie przekazuje.
 *
 * Dlatego tytuł jedzie ELEMENTEM `<title>` w drzewie: React wynosi go do
 * `<head>`, a copy bierze się z języka NAJEMCY, czyli tam, gdzie i tak stoi
 * reszta napisów tego ekranu. Konkurenta nie ma — na tej ścieżce żadne inne
 * `<title>` nie powstaje, bo metadane trasy są puste.
 */
export default async function TenantNotFound() {
  const ctx = await loadStorefrontContext();

  if (!ctx) {
    const copy = await getStorefrontCopy("pl");
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-start justify-center gap-3 px-6">
        <title>{copy.notFound.title}</title>
        <p className="text-2xl font-semibold tabular-nums opacity-60">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.notFound.title}</h1>
        <p className="leading-7 opacity-70">{copy.notFound.description}</p>
        <Link href="/katalog" className="mt-3 font-medium underline underline-offset-4">
          {copy.common.backToCatalog}
        </Link>
      </main>
    );
  }

  const { copy, style, catalog, site } = ctx;

  return (
    <PageShell
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      site={site}
      logo={storeLogo(ctx)}
      siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}
      term={null}
      /* Menu kategorii (S-30) — 404 to wejście z martwego linku; menu jest wyjściem. */
      categoryNav={categoryNavItems(catalog)}
    >
      <div data-store-not-found className="max-w-xl">
        {/*
          TYTUŁ Z NAZWĄ SKLEPU — ten sam szablon, co reszta tras (`pageTitle`),
          żeby karta przeglądarki mówiła klientowi, czyj sklep odmówił.
        */}
        <title>{pageTitle(catalog.tenant.name, copy.notFound.title)}</title>
        <p className="site-text-muted text-2xl font-semibold tabular-nums">404</p>
        <h1 className={`mt-2 text-2xl tracking-tight ${SITE_HEADING}`}>{copy.notFound.title}</h1>
        <p className="site-text-muted mt-3 leading-7">{copy.notFound.description}</p>
        <Link href="/katalog" className="site-link mt-6 inline-block font-medium">
          {copy.common.backToCatalog}
        </Link>
      </div>
    </PageShell>
  );
}

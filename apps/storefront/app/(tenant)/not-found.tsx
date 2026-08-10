/**
 * 404 OSI TENANCKIEJ (B4).
 *
 * Do tej pory storefront nie miał ANI JEDNEGO pliku not-found, więc każde
 * pudło na domenie najemcy — literówka w adresie, martwy link ze stopki,
 * skasowany produkt — kończyło się wbudowaną, nieobrandowaną stroną 404 Next
 * renderowaną na CUDZEJ MARCE. To nie był 404 sklepu; to był 404 platformy
 * pokazany klientowi najemcy.
 *
 * Bez kontekstu (wejście spoza gałęzi tenanckiej) schodzimy na treść neutralną
 * — strona 404 nie może sama się wywrócić na braku danych.
 */
import { StoreChrome, SITE_HEADING } from "@/components/storefront/store-chrome";
import { loadStorefrontContext } from "@/lib/storefront/context";

export default async function TenantNotFound() {
  const ctx = await loadStorefrontContext();

  if (!ctx) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-16">
        <h1 className="text-2xl tracking-tight">404</h1>
      </main>
    );
  }

  const { copy, style, catalog } = ctx;

  return (
    <StoreChrome style={style} copy={copy} storeName={catalog.tenant.name}>
      <main className="mx-auto w-full max-w-5xl px-6 py-16" data-tenant-not-found="true">
        <h1 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.notFound.title}</h1>
        <p className="mt-3 text-sm opacity-80">{copy.notFound.body}</p>
        <a className="mt-6 inline-block text-sm underline underline-offset-4" href="/store">
          {copy.common.backToCatalog}
        </a>
      </main>
    </StoreChrome>
  );
}

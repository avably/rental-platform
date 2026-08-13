/**
 * Zakładka „Strona sklepu" — LISTA WERSJI STRONY (0048, ADR-093).
 *
 * Do 0047 był tu launcher jednej strony, a samą stronę zakładało wejście na tę
 * trasę (`ensureSite`). Model stron uchylił jedno i drugie: wersji może być
 * wiele, więc ekran jest listą, a tworzenie stało się jawnym czasownikiem —
 * operator nie może dostać wersji, o którą nie prosił, przy kliknięciu w menu.
 *
 * Serwerowo zostaje dokładnie tyle, ile lista potrzebuje: guard członka, odczyt
 * wersji i sformatowane daty. Cała interakcja (publikacja, nazwa, usunięcie)
 * siedzi w komponencie klienckim, bo to są mutacje ze stanem oczekiwania.
 *
 * Nieudany odczyt kończy się WŁASNYM stanem (`SiteLoadError`), a nie pustą
 * listą: „nie masz żadnej strony" i „nie wiadomo, czy masz" to dwa różne
 * komunikaty — i tylko jeden z nich zaprasza do klikania.
 */
import { getFormatter, getTranslations } from "next-intl/server";

import { ScreenBackLink } from "@/components/screens/screen-header";
import { footerMarkGaps } from "@/lib/footer-mark-reach";
import { requireMemberPage } from "@/lib/member-page";
import { listSites } from "@/lib/site-queries";
import { tenantLogo } from "@/lib/tenant-logo-render";

import { SitePages, type SitePageRow } from "./site-pages";
import { SiteLoadError } from "./site-load-error";
import { StoreLogoCard } from "./store-logo-card";

export default async function SitePage() {
  const ctx = await requireMemberPage("/strona");
  const t = await getTranslations("site");

  let sites;
  try {
    sites = await listSites();
  } catch {
    return (
      <SiteLoadError backLabel={t("backHome")} title={t("loadErrorTitle")} message={t("loadError")} />
    );
  }

  /*
    ZNAK FIRMY (ADR-160) — własność NAJEMCY, więc czytany z `tenants`, a nie
    z którejkolwiek ze stron. Nieudany odczyt NIE gasi ekranu: lista stron jest
    tu ważniejsza niż karta znaku, a `own_select` i tak oddaje wyłącznie własny
    wiersz najemcy.
  */
  const tenantRow = await ctx.supabase
    .from("tenants")
    .select("logo_draft, logo_published")
    .eq("id", ctx.tenantId!)
    .maybeSingle();

  /*
    GDZIE ZNAK DO STOPKI NIE DOTRZE (ADR-167). Odczyt jest tu, a nie w karcie,
    bo karta jest komponentem KLIENCKIM — i dotyczy stanu OPUBLIKOWANEGO,
    czyli tego samego zbioru sekcji, który wypuszcza `app.get_published_page`.
    Nieudany odczyt gasi samo zdanie, a nie ekran: brak ostrzeżenia jest gorszy
    od ostrzeżenia, ale pusta lista stron byłaby gorsza od obu.
  */
  const footerRows = await ctx.supabase
    .from("site_sections")
    .select("site_id, content_published")
    .eq("tenant_id", ctx.tenantId!)
    .eq("type", "footer")
    .eq("enabled_published", true)
    .not("content_published", "is", null);

  const format = await getFormatter();
  const stamp = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" }) : null;

  const rows: SitePageRow[] = sites.map((site) => ({
    id: site.id,
    name: site.name,
    // ŻYWOŚĆ to jedyna prawda o tym, co widzi klient (ADR-093 D1) — lista
    // czyta ją z tej samej kolumny, z której czyta ją sklep.
    live: site.published_at !== null,
    // ADRES: szkic i bliźniak osobno (0073, ADR-157). Lista pokazuje adres
    // SZKICU, bo to on jest przedmiotem edycji, ale musi umieć powiedzieć, że
    // klienci mają jeszcze stary — dlatego bliźniak jedzie obok.
    slug: site.slug,
    slugPublished: site.slug_published,
    redirectOldSlug: site.redirect_old_slug,
    publishedAtLabel: stamp(site.published_at),
    createdAtLabel: stamp(site.created_at),
  }));

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={t("backHome")} />
      <StoreLogoCard
        state={{
          draft: tenantLogo(tenantRow.data?.logo_draft),
          published: tenantLogo(tenantRow.data?.logo_published),
        }}
        footerGaps={footerMarkGaps(
          sites.map((site) => ({
            id: site.id,
            name: site.name,
            live: site.published_at !== null,
          })),
          footerRows.data ?? [],
        )}
      />
      <SitePages rows={rows} />
    </div>
  );
}

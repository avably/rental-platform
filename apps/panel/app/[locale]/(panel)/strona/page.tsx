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
import { requireMemberPage } from "@/lib/member-page";
import { listSites } from "@/lib/site-queries";

import { SitePages, type SitePageRow } from "./site-pages";
import { SiteLoadError } from "./site-load-error";

export default async function SitePage() {
  await requireMemberPage("/strona");
  const t = await getTranslations("site");

  let sites;
  try {
    sites = await listSites();
  } catch {
    return (
      <SiteLoadError backLabel={t("backHome")} title={t("loadErrorTitle")} message={t("loadError")} />
    );
  }

  const format = await getFormatter();
  const stamp = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" }) : null;

  const rows: SitePageRow[] = sites.map((site) => ({
    id: site.id,
    name: site.name,
    // ŻYWOŚĆ to jedyna prawda o tym, co widzi klient (ADR-093 D1) — lista
    // czyta ją z tej samej kolumny, z której czyta ją sklep.
    live: site.published_at !== null,
    publishedAtLabel: stamp(site.published_at),
    createdAtLabel: stamp(site.created_at),
  }));

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={t("backHome")} />
      <SitePages rows={rows} />
    </div>
  );
}

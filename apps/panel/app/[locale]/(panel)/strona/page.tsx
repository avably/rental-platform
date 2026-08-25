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

import { isProductTemplateKind } from "@avably/core/site";

import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import {
  publishWarnings,
  type PublishWarning,
  type PublishWarningSection,
} from "@/lib/publish-warnings";
import { listSites } from "@/lib/site-queries";

import { appearancePending } from "./appearance-state";
import { draftPending, type DraftSectionColumns } from "./draft-state";
import { SitePages, type SitePageRow } from "./site-pages";
import { SiteLoadError } from "./site-load-error";
import { StoreAppearanceCard } from "./store-appearance-card";

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
    WYGLĄD SKLEPU (ADR-161) do KARTY STANU — własność NAJEMCY, więc czytana
    z `tenants`, a nie z którejkolwiek ze stron. Karta odpowiada wyłącznie na
    pytanie „czy klienci już to widzą" i prowadzi na ekran designu
    (`/strona/wyglad`, ADR-230); ZNAK i pigułka terminu przeniosły się tam wraz
    z realną edycją, więc ten ekran ich kolumn już nie czyta. Nieudany odczyt
    NIE gasi ekranu: lista stron jest ważniejsza niż karta, a `own_select` i tak
    oddaje wyłącznie własny wiersz najemcy.

    Kolumny wyglądu doszły przy ADR-171: do tej poprawki `style_published`
    i `template_published` nie czytał ani jeden ekran panelu, więc stan
    „wygląd czeka na publikację" nie miał jak powstać.
  */
  const tenantRow = await ctx.supabase
    .from("tenants")
    .select("template, template_published, style_draft, style_published")
    .eq("id", ctx.tenantId!)
    .maybeSingle();

  /*
    NIEUDANY ODCZYT ZNACZY „NIE WIADOMO", a nie „bez zmian" — karta wyglądu
    znika wtedy w całości. Zdanie o tym, co widzą klienci, postawione na
    domyśle, jest gorsze od jego braku (kanon ADR-171: napis o stanie sklepu
    pochodzi z odczytu tego, co sklep naprawdę przeczyta).
  */
  const appearance = tenantRow.data
    ? appearancePending({
        template: (tenantRow.data.template as string | null) ?? null,
        template_published: (tenantRow.data.template_published as string | null) ?? null,
        style_draft: tenantRow.data.style_draft,
        style_published: tenantRow.data.style_published,
      })
    : null;

  /*
    STARE ADRESY PROWADZĄCE DO STRON (0075, ADR-159) — potrzebne oknu zdjęcia
    strony ze sklepu (ADR-170): 308 wychodzi wyłącznie dla strony, która dalej
    jest żywa, więc zdjęcie gasi je razem z nią. `authenticated` ma na tej
    tabeli SAM SELECT, a RLS zawęża ją do najemcy — jawny filtr jest tu
    czytelnością zapytania, nie mechanizmem ochrony.

    Nieudany odczyt gasi jedno ZDANIE w oknie, a nie ekran: lista stron jest
    ważniejsza niż wyliczenie adresów, a brak zdania nie wprowadza w błąd
    o kierunku operacji.
  */
  const historyRows = await ctx.supabase
    .from("site_slug_history")
    .select("site_id, slug")
    .eq("tenant_id", ctx.tenantId!)
    .order("slug", { ascending: true });

  const redirectsBySite = new Map<string, string[]>();
  for (const row of historyRows.data ?? []) {
    const list = redirectsBySite.get(row.site_id as string) ?? [];
    list.push(row.slug as string);
    redirectsBySite.set(row.site_id as string, list);
  }

  /*
    NAZWY PRODUKTÓW DLA WIERSZY WYJĄTKÓW (faza B, ADR-200). Odznaka „własna
    strona" ma wymieniać sprzęt Z NAZWY — sam `product_id` jest kluczem, nie
    informacją. Odczyt po liście identyfikatorów, przez RLS; nieudany odczyt
    gasi NAZWĘ przy odznace, a nie ekran (ta sama reguła, co przy karcie
    wyglądu wyżej: lista stron jest ważniejsza niż podpis).
  */
  const exceptionProductIds = sites
    .map((site) => site.product_id)
    .filter((id): id is string => typeof id === "string");
  const productNames = new Map<string, string>();
  if (exceptionProductIds.length > 0) {
    const namesRows = await ctx.supabase
      .from("products")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId!)
      .in("id", exceptionProductIds);
    for (const row of namesRows.data ?? []) {
      productNames.set(row.id as string, row.name as string);
    }
  }

  /*
    SPRZĘT DO WYBORU W OKNIE „UTWÓRZ STRONĘ SPRZĘTU" (ADR-200, B1). Czytany
    wyłącznie, gdy jest z czego forkować (szablon-matka istnieje): fork jest
    KOPIĄ jej treści roboczej, więc bez niej czasownik nie ma przedmiotu.
    Tylko pozycje AKTYWNE — strona produktu spoza katalogu publicznego nie ma
    adresu, pod którym klient by ją zobaczył (trasa sklepu filtruje `active`
    przed pytaniem o szablon). Produkty, które już mają wyjątek, odsiewa ekran
    z tych samych wierszy, którymi rysuje odznaki.

    Sufit odczytu jak przy płótnie kreatora (60 w `site-preview-data`): to jest
    lista do WYBORU, nie katalog — a `null` po nieudanym odczycie gasi samo
    okno forka, nie ekran.
  */
  const hasMotherTemplate = sites.some(
    (site) => isProductTemplateKind(site.kind) && site.product_id === null,
  );
  let forkProducts: { id: string; name: string }[] | null = null;
  if (hasMotherTemplate) {
    const forkRows = await ctx.supabase
      .from("products")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId!)
      .eq("active", true)
      .order("name", { ascending: true })
      .limit(60);
    forkProducts = forkRows.error
      ? null
      : (forkRows.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
  }

  /*
    NIEDOPUBLIKOWANE ZMIANY SZKICU (K-05, audyt UX 2026-08-25) i OSTRZEŻENIA
    PUBLIKACJI (K-13) — jeden odczyt na oba pytania, i to jest cała optymalizacja
    tego bloku.

    Czytamy sekcje WYŁĄCZNIE stron ŻYWYCH. Dla strony roboczej pytanie „czym
    szkic różni się od żywego" nie ma przedmiotu (bliźniaka nie ma), a lista
    mówi o niej „wersja robocza" — zdanie prawdziwe i wystarczające. To zawęża
    najdroższą część odczytu (dwie kolumny jsonb na sekcję) do jednej, najwyżej
    kilku stron zamiast do wszystkich.

    Nieudany odczyt gasi ODZNAKĘ i listę ostrzeżeń, a nie ekran: „nie wiadomo"
    i „bez zmian" to dwa różne zdania (kanon ADR-171), a lista stron jest
    ważniejsza niż którekolwiek z nich.
  */
  const liveSiteIds = sites.filter((site) => site.published_at !== null).map((site) => site.id);
  const draftPendingBySite = new Map<string, boolean>();
  const warningsBySite = new Map<string, PublishWarning[]>();
  if (liveSiteIds.length > 0) {
    const sectionRows = await ctx.supabase
      .from("site_sections")
      .select(
        "site_id, type, content_draft, content_published, position, position_published, enabled, enabled_published, deleted_in_draft",
      )
      .eq("tenant_id", ctx.tenantId!)
      .in("site_id", liveSiteIds);
    if (!sectionRows.error) {
      const bySite = new Map<string, DraftSectionColumns[]>();
      const contentBySite = new Map<string, PublishWarningSection[]>();
      for (const row of sectionRows.data ?? []) {
        const siteId = row.site_id as string;
        const list = bySite.get(siteId) ?? [];
        list.push(row as unknown as DraftSectionColumns);
        bySite.set(siteId, list);

        // Ostrzeżenia opisują to, co publikacja WYPUŚCI — sekcja skasowana
        // w szkicu zniknie, więc jej treść nikogo już nie obchodzi.
        if (row.deleted_in_draft) continue;
        const contents = contentBySite.get(siteId) ?? [];
        contents.push({
          type: row.type as PublishWarningSection["type"],
          enabled: row.enabled as boolean,
          content: row.content_draft,
        });
        contentBySite.set(siteId, contents);
      }
      for (const site of sites) {
        if (site.published_at === null) continue;
        draftPendingBySite.set(
          site.id,
          draftPending(
            { slug: site.slug, slug_published: site.slug_published },
            bySite.get(site.id) ?? [],
          ),
        );
        warningsBySite.set(site.id, publishWarnings(contentBySite.get(site.id) ?? []));
      }
    }
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
    // ROLA (0080, ADR-178): rozstrzyga, czy wiersz w ogóle MA adres. Bez niej
    // szablon pokazywałby ścieżkę `/`, pod którą nie stoi, i liczyłby się do
    // strony głównej.
    kind: site.kind,
    // ADRES: szkic i bliźniak osobno (0073, ADR-157). Lista pokazuje adres
    // SZKICU, bo to on jest przedmiotem edycji, ale musi umieć powiedzieć, że
    // klienci mają jeszcze stary — dlatego bliźniak jedzie obok.
    slug: site.slug,
    slugPublished: site.slug_published,
    redirectOldSlug: site.redirect_old_slug,
    redirectedFrom: redirectsBySite.get(site.id) ?? [],
    // WYJĄTEK (0088, ADR-199/200): przypięcie do produktu i jego nazwa
    // z katalogu. `productName` null przy nieudanym odczycie nazw — odznaka
    // zostaje, podpis gaśnie (zdanie z domysłu byłoby gorsze od braku).
    productId: site.product_id,
    productName: site.product_id ? (productNames.get(site.product_id) ?? null) : null,
    publishedAtLabel: stamp(site.published_at),
    createdAtLabel: stamp(site.created_at),
    // `null` = nie wiadomo (nieudany odczyt sekcji albo strona robocza, dla
    // której pytanie nie ma przedmiotu) — odznaka się wtedy nie rysuje.
    draftPending: draftPendingBySite.get(site.id) ?? null,
    warnings: warningsBySite.get(site.id) ?? [],
  }));

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={t("backHome")} />
      {/*
        KARTA WYGLĄDU (ADR-171) — teraz WEJŚCIE na ekran designu (C4, ADR-230):
        status plus „Edytuj wygląd →" prowadzące na `/strona/wyglad`. Znak firmy
        i pigułka terminu przeniosły się na tamten ekran wraz z realną edycją,
        więc na liście stron zostaje samo wejście z wyglądem.
      */}
      {appearance === null ? null : <StoreAppearanceCard pending={appearance} />}
      {/*
        ZASIĘG PUBLIKACJI JEDZIE DO OKNA (ADR-171). Okno potwierdzenia mówiło
        bezwarunkowo „Pozostałe strony sklepu zostają bez zmian", a `publishSite`
        wypuszcza przy okazji wygląd CAŁEGO sklepu. Zdanie jest odtąd warunkowe,
        a warunek liczy się TUTAJ — z tego samego odczytu, z którego liczy się
        karta wyżej, żeby ekran i okno nie mogły powiedzieć czegoś innego.
      */}
      <SitePages rows={rows} appearancePending={appearance} forkProducts={forkProducts} />
    </div>
  );
}

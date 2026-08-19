/**
 * TRASA KREATORA STRON `/strona/[siteId]/kreator` (K1, ADR-083; segment wersji
 * od 0048/ADR-093) — pełny ekran.
 *
 * Grupa `(kreator)` stoi POZA `(panel)`, więc trasa nie dostaje powłoki panelu:
 * na płótnie buduje się stronę sklepu i każdy piksel sidebara jest tu zabrany
 * z tej pracy. Nazwa grupy nie wchodzi do adresu — trasa to po prostu
 * `/strona/[siteId]/kreator`, a zakładka „Strona sklepu" (`/strona`) jest listą
 * wersji, z której się tu wchodzi. Segment `[siteId]` jest OBOWIĄZKOWY, odkąd
 * wersji może być wiele — bez niego kreator nie miałby czym wybrać strony.
 *
 * `force-dynamic` NIE JEST OZDOBĄ: layout locale ma `generateStaticParams`, więc
 * bez pinu Next.js wciągnąłby kreator w statyczny prerender, a CSP panelu
 * (nonce per żądanie + `strict-dynamic`) odmówiłaby wykonania skryptów
 * wypieczonych z nonce'em z czasu builda. Strona wyrenderowałaby się poprawnie
 * i NIE zhydratowała — bez jednego błędu w konsoli (odkrycie ze spike'u C0).
 * Kreator bez hydracji to martwe płótno, więc pin pilnuje testem, nie komentarzem.
 *
 * Bramka wejścia jest ta sama, co na reszcie tras tenanta (`requireMemberPage`);
 * właściwą izolacją danych pozostaje RLS (0019), nie ten guard.
 */
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { isProductTemplateKind, pagePathFromSlug } from "@avably/core/site";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { loadCustomFieldDefinitions } from "@/lib/custom-fields";
import { requireMemberPage } from "@/lib/member-page";
import {
  catalogProductEntries,
  pickupLocationEntries,
  productFieldEntries,
} from "@/lib/site-import-sources";
import { previewProductRecordFor, previewProductsFor } from "@/lib/site-preview-data";
import { getSiteWithSections } from "@/lib/site-queries";
import { getTenantDraftStyle } from "@/lib/tenant-appearance";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { SiteBuilder } from "./site-builder";

export const dynamic = "force-dynamic";

export default async function SiteBuilderPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const locale = await getLocale();
  const ctx = await requireMemberPage(`/strona/${siteId}/kreator`);
  const data = await getSiteWithSections(siteId);

  // Wersja strony wskazana adresem NIE ISTNIEJE albo należy do innego tenanta
  // (RLS tnie wiersz — wynik ten sam, celowo nieodróżnialny). To 404, a nie
  // puste płótno: kreator bez strony nie ma czego edytować.
  if (!data) notFound();

  const products = await previewProductsFor(ctx, ctx.tenantId!);

  /*
   * POZYCJA, NA KTÓREJ STOI TA STRONA (faza 5, ADR-178; przypięcie — faza B,
   * ADR-200).
   *
   * Szablon-MATKA (`product_id` NULL) startuje z PIERWSZEJ pozycji katalogu —
   * prawdziwa nazwa i cena mówią o układzie prawdę, której atrapa nie powie —
   * a operator może ją PRZEŁĄCZYĆ w pasku kreatora (sam podgląd, zero zapisu:
   * projektuję szablon, widzę go na konkretnym rowerze — §3 dokumentu
   * architektury).
   *
   * WYJĄTEK (`product_id` ustawione) jest PRZYPIĘTY do swojego produktu, bez
   * przełącznika: dotyczy jednej pozycji i podgląd na innej byłby kłamstwem
   * o stronie. Rekord bierzemy z listy płótna, a gdy go tam nie ma (pozycja
   * spoza sufitu 60 albo zdezaktywowana) — osobnym odczytem TEGO produktu.
   *
   * `undefined` w dwóch przypadkach, oba poprawne: strona NIE JEST szablonem
   * (nie stoi na żadnej pozycji) albo nie ma czego podstawić (pusty katalog;
   * wyjątek bez produktu jest niereprezentowalny — kaskada 0088).
   */
  const isTemplate = isProductTemplateKind(data.site.kind);
  const pinnedProductId = data.site.product_id;
  const pageRecord = !isTemplate
    ? undefined
    : pinnedProductId
      ? (products.find((product) => product.id === pinnedProductId) ??
        (await previewProductRecordFor(ctx, ctx.tenantId!, pinnedProductId)) ??
        undefined)
      : products[0];

  /*
   * WALUTA I ZAPIS KWOT NAJEMCY (E6, aneks ADR-094). Jedna wartość na dwa
   * cele: płótno rysuje nią cennik dokładnie tak, jak zobaczy go klient,
   * a szuflada przelicza nią to, co operator wpisuje w polu ceny. Locale bierze
   * się z PANELU, bo to jego język operator ma pod klawiaturą — a waluta
   * z ustawienia najemcy, bo to ona stoi w katalogu, kasie i na fakturach.
   */
  const money = { currency: await getTenantCurrency(ctx.supabase, ctx.tenantId!), locale };

  /*
   * PUNKTY ODBIORU DO SKOPIOWANIA W SEKCJI DOJAZDU (E5, ADR-096).
   *
   * Trasa CZYTA wiersze, a o tym, które z nich stają się wpisami sekcji,
   * rozstrzyga czysta `pickupLocationEntries` — łącznie z odsiewem punktów
   * NIEAKTYWNYCH. Zapytanie celowo nie filtruje samo (delta recenzji PM do
   * PR #186): reguła w warunku SQL była niewidoczna dla każdego testu, więc jej
   * wycięcie przechodziło całą siatkę na zielono.
   *
   * Sortowanie zostaje tutaj — kolejność to własność ODCZYTU (operator widzi
   * punkty po nazwie na ekranie Dostaw), a nie reguła produktowa.
   *
   * NIEUDANY ODCZYT RZUCA (ADR-174). Do tej pory `?? []` zamieniało awarię bazy
   * w zdanie „nie masz punktów odbioru" — a operator, który je przed chwilą
   * wpisał na ekranie Dostaw, dostawał w kreatorze odpowiedź o SWOICH danych
   * tam, gdzie padła odpowiedź o odczycie. BRAK punktów zostaje przy tym stanem
   * cichym i poprawnym: pusta tablica bez błędu to najemca, który ich jeszcze
   * nie założył, i sekcja dojazdu ma wtedy po prostu nic do skopiowania.
   */
  const { data: pickupLocations, error: pickupError } = await ctx.supabase
    .from("pickup_locations")
    .select("name, address_street, address_zip, address_city, active")
    .eq("tenant_id", ctx.tenantId!)
    .order("name", { ascending: true });

  if (pickupError)
    throw new Error(`Odczyt punktów odbioru nie powiódł się: ${pickupError.message}`);

  const pickupEntries = pickupLocationEntries(pickupLocations ?? []);

  /*
   * POLA WŁASNE SPRZĘTU DO WSKAZANIA NA KAFLU (faza 1b, ADR-154).
   *
   * Trasa CZYTA komplet definicji encji `product` — także zarchiwizowane
   * i te widoczne wyłącznie w panelu. O tym, które z nich wolno WSKAZAĆ,
   * rozstrzyga czysta `productFieldEntries`, i to jest decyzja świadoma:
   * odsiew w warunku SQL byłby niewidoczny dla każdego testu jednostkowego,
   * więc jego wycięcie przechodziłoby całą siatkę na zielono (lekcja PR #186,
   * ta sama, co przy punktach odbioru wyżej) — a tutaj wycięcie oznaczałoby
   * proponowanie operatorowi pól, których sklep nigdy nie dostaje.
   */
  const productFields = productFieldEntries(
    await loadCustomFieldDefinitions(ctx.supabase, ctx.tenantId!, "product"),
  );

  return (
    <SiteBuilder
      siteId={data.site.id}
      siteName={data.site.name}
      /*
       * ŻYWOŚĆ CZYTANA Z WIERSZA TEJ STRONY (ADR-165) — jedno źródło prawdy,
       * wspólne z listą stron (`(panel)/strona/page.tsx`).
       *
       * Stało tu osobne zapytanie „która strona najemcy jest żywa" z
       * `.maybeSingle()`, powołane na unikat `sites_one_live_per_tenant_idx`,
       * który ZDJĘŁA migracja 0073. Po 0074 żywych stron może być wiele, więc
       * PostgREST oddawał BŁĄD — a kod czytał wyłącznie `data`, czyli po cichu
       * `null`. Operator edytujący stronę, którą klienci widzą, dostawał w
       * oknie publikacji wariant „pierwszej publikacji".
       *
       * Naprawa jest usunięciem pytania, a nie poprawieniem go: „czy TĘ stronę
       * widzi klient" odpowiada kolumna TEGO wiersza, a `getSiteWithSections`
       * już ją przywiozła — i w odróżnieniu od zapytania wyżej RZUCA przy
       * błędzie odczytu, zamiast oddawać ciche `null`.
       */
      live={data.site.published_at !== null}
      /*
       * ADRES do potwierdzenia publikacji: adres SZKICU, bo to on wejdzie na
       * żywo przy najbliższej publikacji (bliźniak `slug_published`, 0073).
       */
      address={pagePathFromSlug(data.site.slug)}
      /*
       * Styl SZKICU — SKLEPU, nie tej strony (ADR-161). Kreator pokazuje
       * wygląd, który po publikacji obowiązuje na WSZYSTKICH podstronach, więc
       * zmiana akcentu w kreatorze „Kontaktu" jest zmianą całego sklepu.
       */
      style={await getTenantDraftStyle(ctx.supabase, ctx.tenantId!)}
      sections={toEditorSections(data.sections)}
      products={products}
      /*
       * Rekord strony wyliczony wyżej (matka: pierwsza pozycja + przełącznik;
       * wyjątek: przypięty produkt). `pageRecordPinned` gasi przełącznik
       * podglądu na wyjątku — jego strona dotyczy jednej pozycji.
       */
      pageRecord={pageRecord}
      pageRecordPinned={pinnedProductId !== null}
      /*
       * ROLA STRONY DLA OKNA PUBLIKACJI (ADR-200): matka obowiązuje na
       * stronie każdego sprzętu, wyjątek — jednego, a zwykła strona staje pod
       * adresem. Zdania niesie `PublishDialog`, ten sam co na liście stron;
       * kreator podaje mu rolę, bo tylko trasa ją zna. Nazwę sprzętu wyjątku
       * wyprowadza SiteBuilder z przypiętego rekordu.
       */
      productTemplate={isTemplate}
      money={money}
      /*
       * Nazwa źródła jest LUSTREM `itemsImport` / `itemsPick` z rejestru typów
       * strukturalnych (@avably/core/site) — dopisanie tu drugiego źródła nie
       * wymaga zmiany w szufladzie, a typ bez deklaracji nie dostanie cudzych
       * danych.
       *
       * Katalog do WSKAZANIA składamy z tej samej listy, którą dostaje płótno:
       * podgląd kreatora i selektor szuflady widzą wtedy dokładnie ten sam
       * sprzęt, więc pozycja wskazana w szufladzie na pewno narysuje się na
       * płótnie (i odwrotnie — brak pozycji w jednym miejscu znaczy brak w obu).
       */
      importSources={{
        pickupLocations: pickupEntries,
        catalogProducts: catalogProductEntries(products),
        productFields,
      }}
    />
  );
}

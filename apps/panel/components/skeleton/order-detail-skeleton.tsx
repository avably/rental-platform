import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@avably/ui";
import { useTranslations } from "next-intl";

import { ORDER_DETAIL_SKELETON_ITEM_ROWS } from "./screen-regions";
import {
  SkeletonBlock,
  SkeletonLine,
  SkeletonRegion,
  SkeletonScreen,
  times,
} from "./skeleton-primitives";

/**
 * Szkielet ładowania SZCZEGÓŁU zamówienia (uwaga przeglądu N1).
 *
 * Odwzorowuje ekran po przebudowie D1/D4/D5/D9 (#114): odchudzony nagłówek,
 * POZIOMA OŚ CZASU (pięć kroków) zamiast rzędu chipów, rama dwukolumnowa z
 * panelem bocznym 320px (karta klienta, podsumowanie, umowa) i kolumna
 * operacyjna z sześcioma sekcjami.
 *
 * Co jest odwzorowane CO DO PIKSELA: nagłówek, oś czasu, geometria ramy i
 * karty panelu bocznego — czyli wszystko, od czego zależy pozycja pozostałych
 * regionów. Wnętrza sekcji operacyjnych mają wysokość ZALEŻNĄ OD DANYCH
 * (liczba pozycji, zdarzeń kaucji, przesyłek), więc szkielet maluje ich
 * wiarygodny zarys i NIE udaje treści — dokładne liczby z pomiaru siedzą w
 * dzienniku dokumentacji.
 *
 * Zbioru regionów pilnuje `ORDER_DETAIL_REGIONS` w `screen-regions.ts` przez
 * `test/skeleton-parity-contract.test.tsx`.
 */

/** Karta panelu bocznego — kopia klasy z `customer-card.tsx` i podsumowania. */
const ASIDE_CARD_CLASS = "border-border bg-card flex flex-col gap-4 rounded-md border p-5";

/** Sekcja kolumny głównej — kopia klasy `<section>` ze szczegółu. */
const SECTION_CLASS = "flex flex-col gap-3";

/** Wiersz karty klienta: ikona 16, treść 14+20, przycisk kopiowania 32. */
function CustomerRow() {
  return (
    <div className="flex items-center gap-3">
      <SkeletonBlock className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <SkeletonLine line="micro" className="w-16" />
        <SkeletonLine line="text" className="w-40" />
      </div>
      <SkeletonBlock className="size-8 shrink-0 rounded-md" />
    </div>
  );
}

/** Para etykieta/wartość — kopia geometrii `DetailField` (14 + 6 + 22). */
function DetailFieldRow({ width }: { width: string }) {
  return (
    <div className="grid gap-1.5">
      <SkeletonLine line="micro" className="w-20" />
      <SkeletonBlock className={`h-[22px] ${width}`} />
    </div>
  );
}

export function OrderDetailSkeleton() {
  const t = useTranslations("orders.detail");

  return (
    <SkeletonScreen label={t("loading")} className="flex flex-col gap-8">
      {/* Nagłówek: mikro-etykieta (14) + numer `text-2xl leading-[30px]` (30)
          w kolumnie `gap-1` → 48px, po prawej powrót do listy (text-sm). */}
      <SkeletonRegion
        region="header"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="flex flex-col gap-1">
          <SkeletonLine line="micro" className="w-24" />
          <SkeletonLine line="display" className="w-44" />
        </div>
        <SkeletonLine line="text" className="w-28" />
      </SkeletonRegion>

      {/* Oś czasu: pięć kroków, kropka 28px i dwie linie podpisu o wysokości
          line boxów `text-[13px] leading-tight` (16.25) i `text-xs
          leading-tight` (15). Ta sama zmiana kierunku na `md`. */}
      <SkeletonRegion region="timeline" className="flex flex-col md:flex-row">
        {times(5).map((step) => (
          <SkeletonRegion
            key={step}
            region="timeline-step"
            className="relative flex flex-1 items-start gap-3 pb-6 last:pb-0 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
          >
            <SkeletonBlock className="size-7 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5 md:items-center md:pt-0">
              <SkeletonBlock className="h-[16.25px] w-24" />
              <SkeletonBlock className="h-[15px] w-20" />
            </div>
          </SkeletonRegion>
        ))}
      </SkeletonRegion>

      {/* Rama dwukolumnowa. Panel boczny stoi PIERWSZY w źródle (jak na
          ekranie), więc poniżej `lg` karta klienta ląduje nad resztą. */}
      <SkeletonRegion
        region="layout"
        className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start"
      >
        <SkeletonRegion
          region="aside"
          className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1"
        >
          {/* Karta klienta: awatar 44 + trzy wiersze po 34 (gap-3). Wiersz
              „firma/NIP" jest WARUNKOWY, więc szkielet go nie maluje — lepszy
              brak niż obietnica pola, którego zamówienie może nie mieć. */}
          <SkeletonRegion region="customer-card" className={ASIDE_CARD_CLASS}>
            <div className="flex items-center gap-3">
              <SkeletonBlock className="size-11 shrink-0 rounded-full" />
              <div className="min-w-0">
                <SkeletonLine line="micro" className="w-20" />
                <SkeletonLine line="text" className="w-32" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <SkeletonRegion region="customer-email">
                <CustomerRow />
              </SkeletonRegion>
              <SkeletonRegion region="customer-phone">
                <CustomerRow />
              </SkeletonRegion>
              <SkeletonRegion region="customer-address">
                <CustomerRow />
              </SkeletonRegion>
            </div>
          </SkeletonRegion>

          {/* Podsumowanie: nagłówek (14) + termin + dostawa. Pole „notatki"
              jest warunkowe — nie malujemy go z tego samego powodu. */}
          <SkeletonRegion region="summary" className={ASIDE_CARD_CLASS}>
            <SkeletonLine line="micro" className="w-28" />
            <DetailFieldRow width="w-44" />
            <DetailFieldRow width="w-36" />
          </SkeletonRegion>

          {/* Umowa najmu: nagłówek z akcją i jeden wiersz treści. */}
          <SkeletonRegion region="contract-card" className={ASIDE_CARD_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SkeletonLine line="micro" className="w-24" />
              <SkeletonBlock className="h-9 w-28 rounded-md" />
            </div>
            <SkeletonLine line="text" className="w-full" />
          </SkeletonRegion>
        </SkeletonRegion>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          {/* Status: nagłówek `text-xl leading-[26px]` + rząd przycisków
              przejścia (h-9) z podpisem „wyślij e-mail" (text-xs). */}
          <SkeletonRegion region="section-status" className={SECTION_CLASS}>
            <SkeletonLine line="heading" className="w-40" />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {times(2).map((action) => (
                  <div key={action} className="flex flex-col gap-1">
                    <SkeletonBlock className="h-9 w-44 rounded-md" />
                    <SkeletonLine line="caption" className="w-28" />
                  </div>
                ))}
              </div>
            </div>
          </SkeletonRegion>

          {/* Pozycje: nagłówek + tabela w ramce + linia podsumowania kwot. */}
          <SkeletonRegion region="section-items" className={SECTION_CLASS}>
            <SkeletonLine line="heading" className="w-32" />
            <div className="border-border bg-card overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["w-20", "w-16", "w-14", "w-14"].map((width) => (
                      <TableHead key={width} className="px-3.5">
                        <SkeletonLine line="micro" className={width} />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {times(ORDER_DETAIL_SKELETON_ITEM_ROWS).map((row) => (
                    <TableRow key={row}>
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="w-40" />
                      </TableCell>
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="w-28" />
                      </TableCell>
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="ml-auto w-20" />
                      </TableCell>
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="ml-auto w-20" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <SkeletonLine line="text" className="w-64" />
          </SkeletonRegion>

          {/* Kaucja: nagłówek, rejestr zdarzeń (albo komunikat pustki),
              podsumowanie sald i TRZY karty operacji (pobranie, zwrot,
              potrącenie) w siatce `md:grid-cols-3` — jak `DepositForms`. */}
          <SkeletonRegion region="section-deposit" className={SECTION_CLASS}>
            <SkeletonLine line="heading" className="w-28" />
            <SkeletonLine line="text" className="w-72" />
            <div className="flex flex-wrap items-center gap-3">
              <SkeletonLine line="text" className="w-32" />
              <SkeletonLine line="text" className="w-32" />
              <SkeletonLine line="text" className="w-28" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {times(3).map((form) => (
                <div key={form} className="flex flex-col gap-2 rounded border p-3">
                  <SkeletonLine line="text" className="w-32" />
                  {times(3).map((field) => (
                    <div key={field} className="flex flex-col gap-2">
                      <SkeletonLine line="caption" className="w-20" />
                      <SkeletonBlock className="h-9 w-full rounded-md" />
                    </div>
                  ))}
                  <SkeletonBlock className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </SkeletonRegion>

          {/* Przedłużenie, logistyka i dziennik e-maili mają nagłówek
              `text-base font-semibold` (24px), nie `text-xl` — szkielet
              kopiuje tę różnicę zamiast ją wygładzać. */}
          <SkeletonRegion region="section-extension" className={SECTION_CLASS}>
            <SkeletonLine line="body" className="w-40" />
            {/* Formularz przedłużenia: etykieta, pole daty, podpowiedź,
                przycisk — w ramce `gap-2 rounded border p-3`. */}
            <div className="flex flex-col gap-2 rounded border p-3">
              <SkeletonLine line="micro" className="w-32" />
              <SkeletonBlock className="h-9 w-48 rounded-md" />
              <SkeletonLine line="text" className="w-64" />
              <SkeletonBlock className="h-9 w-40 rounded-md" />
            </div>
          </SkeletonRegion>

          <SkeletonRegion region="section-delivery" className={SECTION_CLASS}>
            <SkeletonLine line="body" className="w-32" />
            <SkeletonLine line="text" className="w-72" />
            <SkeletonLine line="text" className="w-64" />
            <SkeletonBlock className="h-9 w-48 rounded-md" />
          </SkeletonRegion>

          <SkeletonRegion region="section-emails" className={SECTION_CLASS}>
            <SkeletonLine line="body" className="w-48" />
            <SkeletonLine line="text" className="w-64" />
          </SkeletonRegion>
        </div>
      </SkeletonRegion>
    </SkeletonScreen>
  );
}

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

          {/* Podsumowanie: nagłówek (14) + termin + dostawa. Notatki wyszły
              stąd do własnej karty (#118), więc pola są dokładnie dwa. */}
          <SkeletonRegion region="summary" className={ASIDE_CARD_CLASS}>
            <SkeletonLine line="micro" className="w-28" />
            <DetailFieldRow width="w-44" />
            <DetailFieldRow width="w-36" />
          </SkeletonRegion>

          {/* Notatki (N6, #118): nagłówek (14) + formularz `gap-2` z etykietą
              `text-sm leading-none` (14), polem wieloliniowym i przyciskiem
              `size="sm"` (32). Pole nosi `min-h-16` — tę SAMĄ podłogę
              wysokości co `Textarea` z @avably/ui, zamiast zgadywanego piksela.
              Karta ma `gap-3`, nie `gap-4` jak reszta panelu bocznego;
              szkielet kopiuje tę różnicę, zamiast ją wygładzać. */}
          <SkeletonRegion
            region="notes"
            className="border-border bg-card flex flex-col gap-3 rounded-md border p-5"
          >
            <SkeletonLine line="micro" className="w-20" />
            <div className="flex flex-col gap-2">
              {/* Etykieta pola jest DŁUGA („Notatki (stan sprzętu, uwagi
                  o zwrocie kaucji)") i w kolumnie 320 px zawija się na dwie
                  linie po 14 px. Dwa stykające się paski odwzorowują zawinięty
                  wiersz i dają dokładnie te 28 px, zamiast jednego klocka. */}
              <div className="flex flex-col">
                <SkeletonBlock className="h-[14px] w-full" />
                <SkeletonBlock className="h-[14px] w-32" />
              </div>
              <SkeletonBlock className="min-h-16 w-full rounded-md" />
              <SkeletonBlock className="h-8 w-28 rounded-md" />
            </div>
          </SkeletonRegion>

          {/* Umowa najmu: nagłówek z akcją i jeden wiersz treści. */}
          <SkeletonRegion region="contract-card" className={ASIDE_CARD_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SkeletonLine line="micro" className="w-24" />
              <SkeletonBlock className="h-9 w-28 rounded-md" />
            </div>
            <SkeletonLine line="text" className="w-full" />
          </SkeletonRegion>

          {/* Faktura (D3, ADR-076): karta panelu bocznego o tej samej
              geometrii co pozostałe (`gap-4 p-5`), w stanie WEJŚCIOWYM —
              nagłówek (14), zdanie „Faktury jeszcze nie wysłano" (`text-sm`,
              czyli 20) i przycisk `size="sm"` (h-8) w wierszu akcji.

              Czego szkielet NIE maluje i dlaczego: (a) plakietki „Wysłana",
              daty i adresu ostatniej wysyłki — to gałąź warunkowa REKORDOWA
              (to zamówienie może nigdy nie mieć faktury), a takich pól nie
              obiecujemy, tak samo jak wiersza firma/NIP w karcie klienta;
              (b) samego okna wysyłki — otwiera je dopiero kliknięcie, więc
              przy wejściu na ekran go nie ma. Po wysłaniu karta jest o dwa
              wiersze opisu (≈36 px) wyższa. */}
          <SkeletonRegion region="invoice-card" className={ASIDE_CARD_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SkeletonLine line="micro" className="w-16" />
            </div>
            <SkeletonLine line="text" className="w-40" />
            <SkeletonBlock className="h-8 w-32 rounded-md" />
          </SkeletonRegion>
        </SkeletonRegion>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          {/* Status po N3: nagłówek `text-xl leading-[26px]` + JEDEN dropdown
              przejść (`SelectTrigger` w rozmiarze domyślnym, czyli h-9;
              szerokość `w-full sm:w-72` z adaptera panelowego). Rząd
              przycisków zniknął razem ze `status-buttons.tsx`.

              Nie malujemy nic pod spodem, choć sekcja bywa wyższa: podpowiedź
              o zablokowanym anulowaniu, ostrzeżenie o niedostępnej wysyłce,
              baner odliczania i komunikat wyniku są WARUNKOWE, a przy wejściu
              na ekran nie ma żadnego z nich — szkielet nie obiecuje rzeczy,
              których po załadowaniu nie widać (ta sama reguła co przy pasku
              akcji masowych na liście i panelu edycji pozycji niżej). */}
          <SkeletonRegion region="section-status" className={SECTION_CLASS}>
            <SkeletonLine line="heading" className="w-40" />
            <div className="flex flex-col gap-2">
              <SkeletonBlock className="h-9 w-full rounded-md sm:w-72" />
            </div>
          </SkeletonRegion>

          {/* Pozycje po D6/N4: nagłówek + tabela z PIĄTĄ kolumną („Akcje",
              przycisk „Edytuj" h-8 dosunięty do prawej) + linia sum + kafel
              „Dodaj pozycję".

              Szkielet maluje gałąź EDYTOWALNĄ, choć kolumna akcji i formularz
              dodawania znikają w statusach `picked_up`/`returned`/`cancelled`.
              To ten sam rodzaj warunku co formularz pobrania kaucji niżej,
              a nie warunek rekordowy w rodzaju „firma/NIP": zamówienie żyje
              w statusach edytowalnych przez CAŁY okres, w którym ktokolwiek na
              nie patrzy w celu innym niż archiwalny, więc gałąź edytowalna
              jest dominująca. W statusach zamkniętych sekcja jest o wysokość
              kafla dodawania (≈118 px) niższa i o jedną kolumnę węższa.

              Panel edycji pozycji NIE jest malowany: otwiera go dopiero
              kliknięcie „Edytuj", więc na wejściu na ekran go nie ma — a
              szkielet nie obiecuje rzeczy, których po załadowaniu nie widać
              (ta sama reguła co przy pasku akcji masowych na liście). */}
          <SkeletonRegion region="section-items" className={SECTION_CLASS}>
            <SkeletonLine line="heading" className="w-32" />
            <SkeletonRegion
              region="items-table"
              className="border-border bg-card overflow-x-auto rounded-lg border"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {["w-20", "w-16", "w-14", "w-14", "w-12"].map((width, column) => (
                      <TableHead key={`${width}-${column}`} className="px-3.5">
                        <SkeletonLine line="micro" className={width} />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {times(ORDER_DETAIL_SKELETON_ITEM_ROWS).map((row) => (
                    <TableRow key={row} data-skeleton-region="items-row">
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="w-40" />
                      </TableCell>
                      {/* Komórka egzemplarza jest JEDNOLINIOWA: dwuwierszowy
                          wariant („bez przypisania" + powód) dotyczy pozycji
                          bez przypisanej sztuki, czyli przypadku mniejszości. */}
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="w-28" />
                      </TableCell>
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="ml-auto w-20" />
                      </TableCell>
                      <TableCell className="px-3.5 py-3">
                        <SkeletonLine className="ml-auto w-20" />
                      </TableCell>
                      {/* Przycisk `size="sm"` = h-8; wiersz i tak mierzy
                          32 px, bo to najwyższy element komórki. */}
                      <TableCell className="px-3.5 py-3">
                        <SkeletonBlock className="ml-auto h-8 w-20 rounded-md" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SkeletonRegion>
            <SkeletonLine line="text" className="w-64" />
            {/* „Dodaj pozycję": ramka `gap-2 rounded-md border p-3` z tytułem
                `text-sm font-semibold` (20), etykietą pola (14), wyborem
                produktu (h-9) i przyciskiem (h-9) w jednym wierszu. */}
            <SkeletonRegion
              region="items-add"
              className="border-border flex flex-col gap-2 rounded-md border p-3"
            >
              <SkeletonLine line="text" className="w-28" />
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-56 flex-1 flex-col gap-1">
                  <SkeletonBlock className="h-[14px] w-16" />
                  <SkeletonBlock className="h-9 w-full rounded-md" />
                </div>
                <SkeletonBlock className="h-9 w-44 rounded-md" />
              </div>
            </SkeletonRegion>
          </SkeletonRegion>

          {/* Kaucja po uproszczeniu D7/N5 (#118): NAJPIERW DZIAŁANIE, POTEM
              DOWÓD. Nagłówek, karta salda z jednym przyciskiem rozliczenia,
              a chronologia zdarzeń w ZWINIĘTYCH szczegółach. Trzy kafle
              formularzy z poprzedniej wersji już nie istnieją.

              Karta salda: kolumna `gap-1` z mikro-etykietą (14), kwotą
              `text-2xl leading-7` (28) i zdaniem o obiegu `text-sm` (20) =
              70 px, po prawej przycisk `h-9` — wiersz `items-end` ma więc
              70 px. Pod nim formularz pobrania „z ręki".

              Dlaczego formularz pobrania JEST malowany, a wiersz firma/NIP
              klienta nie: to dwa różne rodzaje warunku. Firma/NIP zależy od
              REKORDU (to zamówienie może jej nie mieć) — takiego pola nie
              obiecujemy. Formularz pobrania zależy od OBIEGU PŁATNOŚCI
              TENANTA, który jest jednakowy dla wszystkich jego zamówień, a
              obieg ręczny (`payment_provider = manual`) jest dziś domyślny
              i dominujący — więc szkielet maluje gałąź dominującą, tak samo
              jak przy liście maluje tenanta Z zamówieniami, a nie pusty stan.
              Na torze dostawcy karta jest o te 92 px niższa. */}
          <SkeletonRegion region="section-deposit" className={SECTION_CLASS}>
            <SkeletonLine line="heading" className="w-28" />
            <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
              {/* Wiersz salda ZAWIJA SIĘ i to nie jest przypadek: zdanie
                  o obiegu płatności jest długie (~485 px szerokości własnej),
                  więc przycisk zwrotu nie mieści się obok i schodzi do drugiej
                  linii flexa. Szkielet wymusza to samo `w-full` na kolumnie
                  opisu — deterministycznie, bez dopasowywania piksela do
                  długości jednego zdania. Wiersz ma przez to 70 + 12 + 36. */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex w-full flex-col gap-1">
                  <SkeletonLine line="micro" className="w-16" />
                  <SkeletonBlock className="h-7 w-32" />
                  <SkeletonLine line="text" className="w-3/4" />
                </div>
                <SkeletonBlock className="h-9 w-40 rounded-md" />
              </div>
              <div className="border-border flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <SkeletonBlock className="h-[14px] w-32" />
                  <SkeletonBlock className="h-9 w-full rounded-md" />
                </div>
                <SkeletonBlock className="h-9 w-44 rounded-md" />
              </div>
            </div>
            {/* Rejestr wchodzi ZWINIĘTY, więc szkielet maluje samą ramkę
                `<details>`: `px-4 py-3` + summary `text-sm` = 46 px. */}
            <div className="border-border bg-card rounded-lg border px-4 py-3">
              <SkeletonLine line="text" className="w-72" />
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

          {/* Historia komunikacji po D10 (0035): nie jedno zdanie, tylko
              tabela z wierszem nagłówka i wpisami, a wysokość wiersza
              dyktuje przycisk „Podgląd treści" (`size="sm"` → h-8), nie
              tekst. Szkielet maluje przypadek dominujący — zamówienie
              PRAWIE ZAWSZE ma co najmniej potwierdzenie — bo szkielet
              odwzorowujący pusty stan skakałby przy każdym zamówieniu,
              które jakąkolwiek wiadomość wysłało. */}
          <SkeletonRegion region="section-emails" className={SECTION_CLASS}>
            <SkeletonLine line="body" className="w-48" />
            <SkeletonLine line="micro" className="w-full" />
            <div className="flex items-center justify-between gap-3">
              <SkeletonLine line="text" className="w-3/5" />
              <SkeletonBlock className="h-8 w-28 rounded-md" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <SkeletonLine line="text" className="w-2/3" />
              <SkeletonBlock className="h-8 w-28 rounded-md" />
            </div>
          </SkeletonRegion>
        </div>
      </SkeletonRegion>
    </SkeletonScreen>
  );
}

/**
 * Lista przesyłek zamówienia (ADR-188).
 *
 * ================== DLACZEGO TO NIE JEST TABELA ==================
 *
 * Tabela ośmiu kolumn (typ, status, numer u dostawcy, śledzenie, koszt, data,
 * etykieta, akcje) miała szerokość WŁASNĄ 1952 px przy 624 px, które
 * kolumna treści szczegółu zamówienia oferuje w NAJSZERSZYM oknie. Sufit
 * bierze się z systemu, nie z tego ekranu: kontener panelu ma `max-w-5xl`
 * (ADR-243), a 320 px zabiera kolumna boczna — więc kolumna główna NIE
 * ROŚNIE wraz z oknem i tabela nie mieściła się przy ŻADNEJ szerokości ekranu.
 *
 * Stąd dwa wnioski, które ukształtowały ten plik:
 *
 * 1. Progi `md:`/`lg:` są tu bezużyteczne — reagują na szerokość OKNA, a
 *    problemem jest szerokość KOLUMNY, która od okna prawie nie zależy.
 *    Układ musi być płynny z konstrukcji: siatka licząca liczbę torów
 *    z faktycznej szerokości rodzica, zawijanie i `min-w-0` — zamiast
 *    progów i zamiast szerokości przypiętych liczbą.
 * 2. Komórka tabeli nie ma jak zawinąć bez rozjechania sąsiednich wierszy,
 *    a `table-layout: auto` liczy szerokość od TREŚCI — czyli od danych
 *    dostawcy, na które nie mamy wpływu (numer śledzenia bywa 23-znakowy,
 *    surowy status dostawcy bywa zdaniem). Dlatego wiersz przesyłki jest
 *    kartą: pola układają się w tyle rzędów, ile mieści kolumna.
 *
 * ŻADNA informacja nie znika — karta pokazuje komplet dawnych kolumn naraz,
 * bez chowania czegokolwiek za rozwinięciem czy przewijaniem.
 *
 * Geometrię pilnuje pomiarem `packages/e2e/tests/06-przesylki-w-kolumnie.spec.ts`.
 */
import { formatMoney, isShipmentCancellable, mapProviderStatus, type CurrencyCode } from "@avably/core";
import { getTranslations } from "next-intl/server";

import { StatusChip } from "@/lib/orders/status-chip";

import type { ShipmentRow } from "./delivery";
import {
  CancelShipmentButton,
  RefreshStatusButton,
  SendReturnLabelButton,
  TrackingCopyButton,
} from "./delivery-forms";

/** Akcje sekcji dostawy wstrzykiwane z komponentu serwerowego (dyrektywa
 * `"use server"` żyje w `delivery-actions.ts`, tu przechodzą jako referencje). */
type DeliveryAction = Parameters<typeof RefreshStatusButton>[0]["action"];

/**
 * Pole karty: mikro-etykieta nad wartością, jak `DetailField` w podsumowaniu.
 *
 * `min-w-0` to połowa mechaniki mieszczenia się: bez niego domyślna
 * `min-width: auto` zabrania polu zejść poniżej własnej treści, i to ONA
 * zamienia „za wąsko" w „wystaje poza kolumnę". Drugą połową jest
 * `break-words` — dla wartości będących JEDNYM długim słowem (numer śledzenia
 * nie ma spacji, więc bez łamania rozpychałby rząd).
 */
function ShipmentField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-shipment-field className="min-w-0">
      <dt className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

export async function ShipmentsList({
  shipments,
  orderId,
  locale,
  currency,
  emailAvailability,
  timestamp,
  actions,
}: {
  shipments: ShipmentRow[];
  orderId: string;
  locale: string;
  /** Waluta ZAMÓWIENIA (0049/ADR-103) — koszty przesyłek mówią nią, a nie
   * bieżącym ustawieniem najemcy. */
  currency: CurrencyCode;
  emailAvailability: { available: boolean };
  timestamp: Intl.DateTimeFormat;
  actions: {
    refreshStatus: DeliveryAction;
    cancelShipment: DeliveryAction;
    sendReturnLabel: DeliveryAction;
  };
}) {
  const t = await getTranslations("orders.delivery.section");

  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {shipments.map((shipment) => (
        <li
          key={shipment.id}
          data-shipment
          data-shipment-type={shipment.shipment_type}
          className="border-border bg-card flex min-w-0 flex-col gap-3 rounded-md border px-3.5 py-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[15px] leading-[22px] font-medium">
              {t(`types.${shipment.shipment_type}`)}
            </span>
            <StatusChip axis="shipment" value={shipment.status} />
            {/* Surowy status dostawcy pokazywany, gdy NIE odpowiada naszemu
                (nieznany albo rozjechany po dryfie API) — bez tego badge
                twierdziłby coś, czego dostawca nie potwierdza, a właśnie po to
                provider_status jest zapisywany (ADR-031). */}
            {shipment.provider_status &&
            mapProviderStatus(shipment.provider_status) !== shipment.status ? (
              <span className="text-muted-foreground min-w-0 text-xs break-words">
                {t("providerStatus", { status: shipment.provider_status })}
              </span>
            ) : null}
          </div>

          {/*
            Siatka SAMOROZKŁADAJĄCA SIĘ, bez ani jednego progu `md:`/`lg:`.
            `auto-fit` liczy liczbę kolumn z FAKTYCZNEJ szerokości karty, więc
            reaguje na to, co tu naprawdę się zmienia (szerokość kolumny
            treści), a nie na szerokość okna — przy 624 px stają dwie kolumny
            (czytelna macierz 2×2), przy telefonie jedna.
            `min(16rem, 100%)` zamiast samego `16rem` domyka konstrukcję: przy
            karcie węższej niż 16 rem tor zwęża się do jej szerokości zamiast
            wystawać — układ nie ma DOLNEJ granicy, poniżej której się psuje.
          */}
          <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-x-6 gap-y-3">
            <ShipmentField label={t("colNumber")}>
              {shipment.provider_order_number}
            </ShipmentField>
            <ShipmentField label={t("colTracking")}>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {shipment.tracking_url ? (
                  <a
                    className="min-w-0 break-words underline underline-offset-[3px]"
                    href={shipment.tracking_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shipment.tracking_number ?? shipment.tracking_url}
                  </a>
                ) : (
                  <span className="min-w-0 break-words">{shipment.tracking_number ?? "—"}</span>
                )}
                {shipment.tracking_number ? (
                  <TrackingCopyButton value={shipment.tracking_number} />
                ) : null}
              </span>
            </ShipmentField>
            <ShipmentField label={t("colPrice")}>
              <span className="tabular-nums tracking-[0.01em]">
                {shipment.price_grosze !== null
                  ? formatMoney(shipment.price_grosze, currency, locale)
                  : "—"}
              </span>
            </ShipmentField>
            <ShipmentField label={t("colCreated")}>
              <span className="tabular-nums tracking-[0.01em]">
                {timestamp.format(new Date(shipment.created_at))}
              </span>
            </ShipmentField>
          </dl>

          <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
            {/* Zwykły <a> z jawnym locale: to route handler (PDF), nie strona —
                Link z i18n/navigation nie ma tu zastosowania. */}
            <a
              // `py-2` zrównuje pole tekstu linku z wysokością sąsiednich
              // przycisków — bez tego link wisi przy górnej krawędzi rzędu.
              className="py-2 text-sm break-words underline underline-offset-[3px]"
              href={`/${locale}/zamowienia/${orderId}/delivery-label?shipment=${shipment.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("labelLink")}
            </a>
            <RefreshStatusButton shipmentId={shipment.id} action={actions.refreshStatus} />
            {/* Etykietę zwrotną e-mailem można wysłać tylko dla przesyłki
                ZWROTNEJ i tylko gdy dostawca wydał już etykietę (jest hash) —
                inaczej akcja i tak odmówi. */}
            {shipment.shipment_type === "return" ? (
              <SendReturnLabelButton
                orderId={orderId}
                shipmentId={shipment.id}
                emailAvailability={emailAvailability}
                action={actions.sendReturnLabel}
              />
            ) : null}
            {/* Anulowanie tylko tam, gdzie ma jeszcze skutek (ADR-105): przy
                przesyłce w drodze przycisk nie istnieje, zamiast obiecywać
                operację, którą dostawca i tak odrzuci. */}
            {isShipmentCancellable(shipment.status) ? (
              <CancelShipmentButton
                shipmentId={shipment.id}
                shipmentNumber={shipment.provider_order_number}
                action={actions.cancelShipment}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

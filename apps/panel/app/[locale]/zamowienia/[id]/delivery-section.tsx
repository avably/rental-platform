/**
 * Sekcja dostawy szczegółu zamówienia — SAMOWYSTARCZALNY server component
 * (własne odczyty przesyłek i konfiguracji): page.tsx wpina ją jedną linią
 * (protokół antykolizyjny Zadań 6/7).
 *
 * Pokazuje: koszt dostawy wg cennika (ADR-030), listę przesyłek z etykietą
 * i odświeżeniem statusu (ADR-031) oraz formularz nadania — a przy
 * niekompletnej konfiguracji kuriera CZYTELNĄ listę braków z linkiem do
 * ustawień, zamiast ukrywać funkcję bez wyjaśnienia.
 */
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import {
  COURIER_CONFIG_KEYS,
  CourierConfigError,
  DELIVERY_PRICING_KEY,
  DeliveryPricingError,
  calculateDeliveryCost,
  courierConfigFromSettings,
  deliveryPricingFromSettings,
  formatMoney,
  type DeliveryMethod,
} from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMember } from "@/lib/supabase-server";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { createShipmentAction, refreshShipmentStatusAction } from "./delivery-actions";
import { SHIPMENT_ROW_COLUMNS, canCreateShipments, type ShipmentRow } from "./delivery";
import { CreateShipmentForm, RefreshStatusButton } from "./delivery-forms";

export async function DeliverySection({
  orderId,
  deliveryMethod,
  totalRentalGrosze,
}: {
  orderId: string;
  deliveryMethod: string;
  totalRentalGrosze: number;
}) {
  const ctx = await requireMember();
  const t = await getTranslations("orders.delivery.section");
  const locale = await getLocale();
  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);

  const { data: shipmentRows } = await ctx.supabase
    .from("courier_shipments")
    .select(SHIPMENT_ROW_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  const shipments = (shipmentRows ?? []) as unknown as ShipmentRow[];

  const { data: settingRows } = await ctx.supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", ctx.tenantId)
    .in("key", [...COURIER_CONFIG_KEYS, DELIVERY_PRICING_KEY]);
  const settings = settingRows ?? [];

  // Koszt dostawy wg cennika (ADR-030): brak cennika dla metody płatnej to
  // stan konfiguracji pokazywany operatorowi, nie cichy koszt 0.
  let deliveryCostGrosze: number | null = null;
  let pricingProblem: string | null = null;
  try {
    const pricing = deliveryPricingFromSettings(settings);
    deliveryCostGrosze = calculateDeliveryCost({
      method: deliveryMethod as DeliveryMethod,
      pricing,
      rentalTotalGrosze: totalRentalGrosze,
    });
  } catch (err) {
    if (err instanceof DeliveryPricingError || err instanceof CourierConfigError) {
      pricingProblem = err.message;
    } else {
      throw err;
    }
  }

  // Kompletność konfiguracji kuriera decyduje o formularzu nadania.
  let configProblems: string[] | null = null;
  let parcelDefaults: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    weightKg: number;
  } | null = null;
  try {
    const config = courierConfigFromSettings(settings);
    parcelDefaults = config.parcel;
  } catch (err) {
    if (err instanceof CourierConfigError) {
      configProblems = err.problems;
    } else {
      throw err;
    }
  }

  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  });

  const eligible = canCreateShipments(deliveryMethod);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("title")}</h2>

      {deliveryMethod !== "pickup" ? (
        <p className="text-sm">
          {t("deliveryCost")}:{" "}
          {pricingProblem ? (
            <span className="text-red-600">
              {t("pricingMissing")}{" "}
              <Link className="underline" href="/ustawienia-dostaw">
                {t("settingsLink")}
              </Link>
            </span>
          ) : deliveryCostGrosze === 0 ? (
            <span>{t("deliveryCostFree")}</span>
          ) : (
            <span className="font-semibold">
              {formatMoney(deliveryCostGrosze ?? 0, currency, locale)}
            </span>
          )}
        </p>
      ) : null}

      {shipments.length === 0 ? (
        <p className="text-sm text-gray-500">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colType")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colNumber")}</TableHead>
              <TableHead>{t("colTracking")}</TableHead>
              <TableHead>{t("colPrice")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead>{t("colLabel")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((shipment) => (
              <TableRow key={shipment.id}>
                <TableCell>{t(`types.${shipment.shipment_type}`)}</TableCell>
                <TableCell>
                  <Badge variant={shipment.status === "cancelled" ? "outline" : "default"}>
                    {t(`statuses.${shipment.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>{shipment.provider_order_number}</TableCell>
                <TableCell>
                  {shipment.tracking_url ? (
                    <a
                      className="underline"
                      href={shipment.tracking_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shipment.tracking_number ?? shipment.tracking_url}
                    </a>
                  ) : (
                    (shipment.tracking_number ?? "—")
                  )}
                </TableCell>
                <TableCell>
                  {shipment.price_grosze !== null
                    ? formatMoney(shipment.price_grosze, currency, locale)
                    : "—"}
                </TableCell>
                <TableCell>{timestamp.format(new Date(shipment.created_at))}</TableCell>
                <TableCell>
                  {/* Zwykły <a> z jawnym locale: to route handler (PDF), nie
                      strona — Link z i18n/navigation nie ma tu zastosowania. */}
                  <a
                    className="underline"
                    href={`/${locale}/zamowienia/${orderId}/delivery-label?shipment=${shipment.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("labelLink")}
                  </a>
                </TableCell>
                <TableCell>
                  <RefreshStatusButton
                    shipmentId={shipment.id}
                    action={refreshShipmentStatusAction}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!eligible ? (
        <p className="text-sm text-gray-500">{t("notCourier")}</p>
      ) : configProblems ? (
        <div className="rounded border border-red-200 p-3 text-sm">
          <p className="text-red-600">{t("configMissing")}</p>
          <ul className="list-disc pl-5 text-red-600">
            {configProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <Link className="underline" href="/ustawienia-dostaw">
            {t("settingsLink")}
          </Link>
        </div>
      ) : (
        <CreateShipmentForm
          orderId={orderId}
          defaults={parcelDefaults}
          action={createShipmentAction}
        />
      )}
    </section>
  );
}

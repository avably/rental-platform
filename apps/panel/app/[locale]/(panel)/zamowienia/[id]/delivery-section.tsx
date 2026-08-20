/**
 * Sekcja dostawy szczegółu zamówienia — SAMOWYSTARCZALNY server component
 * (własne odczyty przesyłek i konfiguracji): page.tsx wpina ją jedną linią
 * (protokół antykolizyjny Zadań 6/7).
 *
 * Pokazuje: ZAPISANY koszt dostawy zamówienia (kolumny 0016/0044 — dlaczego
 * zapisany, a nie przeliczany, tłumaczy `delivery-cost.tsx`), listę przesyłek
 * z etykietą i odświeżeniem statusu (ADR-031) oraz formularz nadania — a przy
 * niekompletnej konfiguracji kuriera CZYTELNĄ listę braków z linkiem do
 * ustawień, zamiast ukrywać funkcję bez wyjaśnienia.
 */
import {
  COURIER_CONFIG_KEYS,
  CourierConfigError,
  emailAvailability,
  type CurrencyCode,
  type DeliveryPriceSource,
} from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMember } from "@/lib/supabase-server";

import { courierConfigItems } from "./courier-config-copy";
import {
  cancelShipmentAction,
  createShipmentAction,
  refreshOrderShipmentsAction,
  refreshShipmentStatusAction,
  searchCarriersAction,
  sendPickupReturnReminderAction,
  sendReturnLabelEmailAction,
} from "./delivery-actions";
import { DeliveryCost } from "./delivery-cost";
import {
  SHIPMENT_ROW_COLUMNS,
  canCreateShipments,
  loadCourierConfigStatus,
  loadRecipientDefaults,
  type PartyDefaults,
  type ShipmentRow,
} from "./delivery";
import {
  RefreshAllShipmentsButton,
  SendPickupReminderButton,
} from "./delivery-forms";
import { ShipmentModalLauncher } from "./shipment-modal";
import { ShipmentsList } from "./shipments-list";

export async function DeliverySection({
  orderId,
  deliveryMethod,
  deliveryGrosze,
  deliveryPriceSource,
  currency,
}: {
  orderId: string;
  deliveryMethod: string;
  /** `orders.delivery_grosze` — kwota utrwalona przy tworzeniu zamówienia. */
  deliveryGrosze: number;
  /** `orders.delivery_price_source` — cennik czy ustalenie ręczne (0044). */
  deliveryPriceSource: DeliveryPriceSource;
  /**
   * Waluta ZAMÓWIENIA (orders.currency, 0049/ADR-103) — koszt dostawy
   * i koszty przesyłek TEGO zamówienia mówią walutą, w której powstało,
   * a nie bieżącym ustawieniem najemcy.
   */
  currency: CurrencyCode;
}) {
  // Opt-in okna domykania (ADR-138): logistyka kurierska jest na allowliście.
  const ctx = await requireMember(undefined, { closing: true });
  const t = await getTranslations("orders.delivery.section");
  const locale = await getLocale();

  const { data: shipmentRows } = await ctx.supabase
    .from("courier_shipments")
    .select(SHIPMENT_ROW_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    // `provider_order_number is not null`: ukrywa PRZEJŚCIOWE wiersze-zaklepania
    // (L5, ADR-223 — status 'pending' bez numeru, albo zwolnione 'cancelled'
    // bez numeru). Potwierdzona przesyłka ZAWSZE ma numer, więc lista pokazuje
    // wyłącznie realne przesyłki dostawcy.
    .not("provider_order_number", "is", null)
    .order("created_at", { ascending: true });
  const shipments = (shipmentRows ?? []) as unknown as ShipmentRow[];

  // Cennik dostaw NIE JEST tu odczytywany i to jest sedno poprawki R3-1b:
  // kwota dostawy zamówienia przychodzi propem z kolumn zamówienia, więc
  // zmiana cennika nie ma jak przepisać historii (patrz `delivery-cost.tsx`).
  // Z ustawień bierzemy WYŁĄCZNIE konfigurację kuriera — do modalu nadania.
  const { data: settingRows } = await ctx.supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", ctx.tenantId)
    .in("key", [...COURIER_CONFIG_KEYS]);
  const settings = settingRows ?? [];

  // Kompletność konfiguracji kuriera decyduje o modalu nadania. Nadawca do
  // prefillu bierzemy z tej samej konfiguracji (bez odszyfrowywania hasła).
  let configProblems: string[] | null = null;
  let parcelDefaults: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    weightKg: number;
  } | null = null;
  let senderDefaults: PartyDefaults | null = null;
  try {
    const config = await loadCourierConfigStatus(ctx.supabase, ctx.tenantId!, settings);
    parcelDefaults = config.parcel;
    senderDefaults = {
      name: config.sender.name,
      street: config.sender.street,
      houseNumber: config.sender.houseNumber,
      apartmentNumber: config.sender.apartmentNumber ?? "",
      postCode: config.sender.postCode,
      city: config.sender.city,
      phone: config.sender.phone,
      email: config.sender.email,
    };
  } catch (err) {
    if (err instanceof CourierConfigError) {
      configProblems = err.problems;
    } else {
      throw err;
    }
  }

  // Odbiorca do prefillu z kartoteki klienta zamówienia (edytowalny w modalu).
  const recipientDefaults = await loadRecipientDefaults(ctx.supabase, ctx.tenantId!, orderId);

  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  });

  const eligible = canCreateShipments(deliveryMethod);
  // Dostępność wysyłki e-maili rozstrzyga się JAWNIE (ADR-033): przy braku
  // klucza przyciski zwrotów są zablokowane z komunikatem. Do klienta idzie
  // SAM boolean (U1, audyt W3) — powód to wnętrzności platformy, treść
  // komunikatu daje słownik.
  const emailStatus = { available: emailAvailability().available };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("title")}</h2>

      {deliveryMethod !== "pickup" ? (
        <DeliveryCost
          grosze={deliveryGrosze}
          source={deliveryPriceSource}
          currency={currency}
          locale={locale}
        />
      ) : null}

      {shipments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div data-shipments className="flex min-w-0 flex-col gap-2">
          <div className="flex justify-end">
            <RefreshAllShipmentsButton
              orderId={orderId}
              action={refreshOrderShipmentsAction}
            />
          </div>
          {/* Karty zamiast tabeli ośmiu kolumn (ADR-188): kolumna treści ma
              sufit 752 px i NIE ROŚNIE z oknem, więc układ musi być płynny
              z konstrukcji, a nie dostrajany progami. Uzasadnienie i pomiar —
              `shipments-list.tsx`. */}
          <ShipmentsList
            shipments={shipments}
            orderId={orderId}
            locale={locale}
            currency={currency}
            emailAvailability={emailStatus}
            timestamp={timestamp}
            actions={{
              refreshStatus: refreshShipmentStatusAction,
              cancelShipment: cancelShipmentAction,
              sendReturnLabel: sendReturnLabelEmailAction,
            }}
          />
        </div>
      )}

      {deliveryMethod === "pickup" ? (
        <SendPickupReminderButton
          orderId={orderId}
          emailAvailability={emailStatus}
          action={sendPickupReturnReminderAction}
        />
      ) : null}

      {!eligible ? (
        deliveryMethod === "pickup" ? null : (
          <p className="text-muted-foreground text-sm">{t("notCourier")}</p>
        )
      ) : configProblems ? (
        // Braki w JĘZYKU NAJEMCY (U1, audyt W3): lista wiader do
        // uzupełnienia zamiast nazw kluczy ustawień, z linkiem prowadzącym
        // dokładnie tam, gdzie się je uzupełnia. Surowe problemy zostają
        // w silniku — tu jest ekran, nie log.
        <div className="border-destructive rounded-md border p-3 text-sm">
          <p className="text-destructive">{t("configMissing")}</p>
          <ul className="text-destructive list-disc pl-5">
            {courierConfigItems(configProblems).map((item) => (
              <li key={item}>{t(`configItems.${item}`)}</li>
            ))}
          </ul>
          <Link className="underline" href="/ustawienia-dostaw">
            {t("settingsLink")}
          </Link>
        </div>
      ) : senderDefaults ? (
        <ShipmentModalLauncher
          orderId={orderId}
          senderDefaults={senderDefaults}
          recipientDefaults={recipientDefaults}
          parcelDefaults={parcelDefaults}
          createAction={createShipmentAction}
          searchAction={searchCarriersAction}
        />
      ) : null}
    </section>
  );
}

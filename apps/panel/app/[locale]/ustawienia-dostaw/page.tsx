/**
 * Ustawienia dostaw (Zadanie 7, ADR-030/031): credentiale GlobKurier,
 * nadawca przesyłek, domyślna paczka i cennik dostaw — cztery klucze
 * tenant_settings z CHECK-ami 0013.
 *
 * Hasło credentiali NIE jest renderowane z powrotem (strona pokazuje tylko
 * znacznik „skonfigurowane") — wartość jsonb zostaje server-side. Dostęp
 * dla każdego członka, spójnie z RLS 0007; zawężenie do ownera = dług
 * (ADR-031). Dojście: link z sekcji dostawy zamówienia.
 */
import {
  COURIER_CONFIG_KEYS,
  COURIER_PARCEL_KEY,
  COURIER_SENDER_KEY,
  DELIVERY_PRICING_KEY,
  GLOBKURIER_CREDENTIALS_KEY,
  deliveryPricingFromSettings,
} from "@avably/core";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import {
  saveCourierCredentialsAction,
  saveCourierParcelAction,
  saveCourierSenderAction,
  saveDeliveryPricingAction,
} from "./delivery-settings-actions";
import {
  CredentialsForm,
  ParcelForm,
  PricingForm,
  SenderForm,
  type PricingDefaults,
  type SenderDefaults,
} from "./delivery-settings-forms";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const s = (value: unknown): string => (typeof value === "string" ? value : "");
const n = (value: unknown): number | null => (typeof value === "number" ? value : null);

export default async function DeliverySettingsPage() {
  const ctx = await requireMemberPage("/ustawienia-dostaw");
  const t = await getTranslations("orders.delivery.settings");
  const tSection = await getTranslations("orders.delivery.section");

  const { data: rows } = await ctx.supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", ctx.tenantId)
    .in("key", [...COURIER_CONFIG_KEYS, DELIVERY_PRICING_KEY]);
  const settings = rows ?? [];
  const byKey = new Map(settings.map((row) => [row.key as string, row.value as unknown]));

  const credentials = asRecord(byKey.get(GLOBKURIER_CREDENTIALS_KEY));
  const sender = asRecord(byKey.get(COURIER_SENDER_KEY));
  const parcel = asRecord(byKey.get(COURIER_PARCEL_KEY));

  const senderDefaults: SenderDefaults | null = sender
    ? {
        name: s(sender.name),
        street: s(sender.street),
        houseNumber: s(sender.house_number),
        apartmentNumber: s(sender.apartment_number),
        postCode: s(sender.post_code),
        city: s(sender.city),
        phone: s(sender.phone),
        email: s(sender.email),
      }
    : null;

  const parcelDefaults =
    parcel &&
    n(parcel.length_cm) !== null &&
    n(parcel.width_cm) !== null &&
    n(parcel.height_cm) !== null &&
    n(parcel.weight_kg) !== null
      ? {
          lengthCm: parcel.length_cm as number,
          widthCm: parcel.width_cm as number,
          heightCm: parcel.height_cm as number,
          weightKg: parcel.weight_kg as number,
        }
      : null;

  // Wadliwy cennik w bazie (niemożliwy przy CHECK-ach 0013, ale odczyt nie
  // zgaduje) — formularz startuje pusty zamiast wykładać stronę.
  let pricingDefaults: PricingDefaults | null;
  try {
    pricingDefaults = deliveryPricingFromSettings(
      settings as { key: string; value: unknown }[],
    );
  } catch {
    pricingDefaults = null;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link className="text-sm underline" href="/zamowienia">
          {tSection("title")} ↩
        </Link>
      </header>
      <p className="text-sm text-gray-500">{t("intro")}</p>

      <CredentialsForm
        action={saveCourierCredentialsAction}
        configured={credentials !== null}
        defaults={
          credentials
            ? { email: s(credentials.email), environment: s(credentials.environment) || "test" }
            : null
        }
      />
      <SenderForm action={saveCourierSenderAction} defaults={senderDefaults} />
      <ParcelForm action={saveCourierParcelAction} defaults={parcelDefaults} />
      <PricingForm action={saveDeliveryPricingAction} defaults={pricingDefaults} />
    </main>
  );
}

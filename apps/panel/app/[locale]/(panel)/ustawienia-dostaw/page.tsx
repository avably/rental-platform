/**
 * Ustawienia dostaw = HUB DOSTAW (Zadanie 7, ADR-030/031; przebudowa UX
 * ADR-236). Kafelki ze stanem: punkty odbioru, integracja z kurierami, dane
 * nadawcy, domyślna paczka i cennik — klucze tenant_settings z CHECK-ami
 * 0013/0024. Edycja każdej sekcji przenosi się do modalu (patrz
 * `delivery-hub.tsx`); strona niesie stan i skróty, nie stos surowych
 * formularzy.
 *
 * HASŁO NIE JEST TU CZYTANE W OGÓLE (ADR-052). Strona pyta bazę wyłącznie
 * o to, CZY sekret istnieje (app.tenant_secret_is_set → boolean) i pokazuje
 * znacznik „skonfigurowane"; ani wartość jawna, ani nawet szyfrogram nie mają
 * po co trafiać do warstwy widoku. Formularz działa w trybie NADPISZ, nie
 * odczytaj — pole hasła zawsze startuje puste.
 *
 * Odczyt dla każdego członka, ZAPIS wyłącznie dla właściciela (RLS 0024) —
 * odmowa przychodzi z bazy, a akcja tłumaczy ją na komunikat. Dojście: link
 * z sekcji dostawy zamówienia.
 *
 * Od 2026-08-04 ekran jest też RODZICEM punktów odbioru
 * (`/ustawienia-dostaw/punkty-odbioru`, decyzja właściciela): odbiór osobisty
 * to metoda dostawy, więc mieszka przy kurierze i paczkomacie, a nie przy
 * katalogu produktów, gdzie stał wcześniej. Od ADR-236 dodane punkty są
 * POKAZANE na hubie (kafelki), nie tylko linkowane.
 */
import {
  COURIER_CONFIG_KEYS,
  COURIER_PARCEL_KEY,
  COURIER_SENDER_KEY,
  DELIVERY_PRICING_KEY,
  GLOBKURIER_CREDENTIALS_KEY,
  GLOBKURIER_PASSWORD_SECRET_KEY,
  deliveryPricingFromSettings,
} from "@avably/core";
import { getFormatter, getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import {
  saveCourierCredentialsAction,
  saveCourierParcelAction,
  saveCourierSenderAction,
  saveDeliveryPricingAction,
} from "./delivery-settings-actions";
import {
  IntegrationSection,
  ParcelCard,
  PricingCard,
  SenderCard,
} from "./delivery-hub";
import { type PricingDefaults, type SenderDefaults } from "./delivery-settings-forms";
import { deliverySectionStates } from "./delivery-settings-status";
import {
  PickupLocationsSummary,
  type PickupLocationSummaryRow,
} from "./pickup-locations-summary";

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
    .select("key, value, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .in("key", [...COURIER_CONFIG_KEYS, DELIVERY_PRICING_KEY]);
  const settings = rows ?? [];
  const byKey = new Map(settings.map((row) => [row.key as string, row.value as unknown]));

  // Punkty odbioru POKAZANE na hubie (ADR-236), nie tylko linkowane. Odczyt
  // przez RLS tak jak na podstronie — ekran nie zna cudzych punktów.
  const { data: locations } = await ctx.supabase
    .from("pickup_locations")
    .select("id, name, address_street, address_zip, address_city, active")
    .eq("tenant_id", ctx.tenantId)
    .order("name", { ascending: true });
  const locationRows: PickupLocationSummaryRow[] = (locations ?? []).map((location) => ({
    id: location.id,
    name: location.name,
    address:
      [location.address_street, location.address_zip, location.address_city]
        .filter(Boolean)
        .join(", ") || "—",
    active: location.active,
  }));

  const credentials = asRecord(byKey.get(GLOBKURIER_CREDENTIALS_KEY));

  // Znacznik „skonfigurowane" mówi o HAŚLE, nie o istnieniu wiersza ustawień:
  // po ADR-052 to dwie różne rzeczy i mylenie ich wprowadzałoby operatora
  // w błąd — wiersz z samym e-mailem istnieje także wtedy, gdy hasła nie ma
  // (np. po migracji 0024, która zdjęła hasła zapisane jawnie).
  const { data: passwordSet } = await ctx.supabase
    .schema("app")
    .rpc("tenant_secret_is_set", { p_key: GLOBKURIER_PASSWORD_SECRET_KEY });
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

  // Zapis należy do właściciela (RLS 0024), odczyt do każdego członka. Ekran
  // mówi to WPROST, zamiast zostawiać członkowi zespołu przyciski, po których
  // dostanie odmowę z bazy — od U9 zdanie stoi PRZY KAŻDEJ stopce zapisu
  // (`SaveRow`), czyli tam, gdzie brakuje przycisku, a nie osobną kartą na
  // górze ekranu, oderwaną od sekcji, których dotyczy (audyt UX 6.1).
  const canWrite = ctx.role === "owner";

  /*
    Gotowość sekcji liczy `deliverySectionStates` — JEDNA ocena kompletności
    w całym repo (ta sama, którą dostaje nadanie przesyłki), patrz
    `delivery-settings-status.ts`. Data ostatniego zapisu idzie z
    `tenant_settings.updated_at` per klucz, więc żadna migracja nie jest
    potrzebna: kolumnę ustawia każdy upsert w `delivery-settings-actions.ts`.
  */
  const sectionStates = deliverySectionStates(
    settings as { key: string; value: unknown }[],
    passwordSet === true,
  );
  const format = await getFormatter();
  const savedAtByKey = new Map(
    settings
      .filter((row) => typeof row.updated_at === "string")
      .map((row) => [
        row.key as string,
        format.dateTime(new Date(row.updated_at as string), {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      ]),
  );
  const sectionStatus = (key: string, state: (typeof sectionStates)[keyof typeof sectionStates]) => ({
    state,
    savedAt: savedAtByKey.get(key) ?? null,
  });

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/zamowienia" label={`← ${tSection("title")}`} />
      {/*
        Wstęp niesie fakt CAŁEGO EKRANU („zespół widzi, właściciel zapisuje"),
        bo dotyczy wszystkich kart naraz. Fakt operacyjny — „tu nie ma
        przycisku, bo nie jesteś właścicielem" — stoi niżej, w modalu każdej
        sekcji, przy stopce zapisu.
      */}
      <p
        className="text-muted-foreground text-sm"
        {...(canWrite ? { "data-delivery-access-rule": "owner-writes" } : {})}
      >
        {t("intro")}
        {canWrite ? <> {t("accessRuleOwner")}</> : null}
      </p>

      {/*
        Kolejność huba: najpierw to, na czym operator pracuje na co dzień
        (punkty odbioru — prowadzi je każdy członek zespołu), potem konfiguracja
        wysyłki kurierem (integracja → nadawca → paczka → cennik). Punkty stoją
        na górze także dlatego, że nie są objęte regułą właściciela (RLS 0024),
        więc nie powinny wyglądać na zamknięte tym samym ograniczeniem.
      */}
      <PickupLocationsSummary rows={locationRows} />

      <IntegrationSection
        action={saveCourierCredentialsAction}
        configured={passwordSet === true}
        canWrite={canWrite}
        status={sectionStatus(GLOBKURIER_CREDENTIALS_KEY, sectionStates.credentials)}
        defaults={
          credentials
            ? { email: s(credentials.email), environment: s(credentials.environment) || "test" }
            : null
        }
      />
      <SenderCard
        action={saveCourierSenderAction}
        canWrite={canWrite}
        status={sectionStatus(COURIER_SENDER_KEY, sectionStates.sender)}
        defaults={senderDefaults}
      />
      <ParcelCard
        action={saveCourierParcelAction}
        canWrite={canWrite}
        status={sectionStatus(COURIER_PARCEL_KEY, sectionStates.parcel)}
        defaults={parcelDefaults}
      />
      <PricingCard
        action={saveDeliveryPricingAction}
        canWrite={canWrite}
        status={sectionStatus(DELIVERY_PRICING_KEY, sectionStates.pricing)}
        defaults={pricingDefaults}
      />
    </FormMeasure>
  );
}

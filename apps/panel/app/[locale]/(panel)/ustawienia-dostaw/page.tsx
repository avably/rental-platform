/**
 * Ustawienia dostaw (Zadanie 7, ADR-030/031): credentiale dostawcy, nadawca
 * przesyłek, domyślna paczka i cennik dostaw — klucze tenant_settings
 * z CHECK-ami 0013/0024.
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
 * katalogu produktów, gdzie stał wcześniej.
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
import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink, ScreenSection } from "@/components/screens/screen-header";
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
  const tLocations = await getTranslations("orders.delivery.locations");

  const { data: rows } = await ctx.supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", ctx.tenantId)
    .in("key", [...COURIER_CONFIG_KEYS, DELIVERY_PRICING_KEY]);
  const settings = rows ?? [];
  const byKey = new Map(settings.map((row) => [row.key as string, row.value as unknown]));

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
  // mówi to WPROST kartą reguły dostępu, zamiast zostawiać członkowi zespołu
  // przyciski, po których dostanie odmowę z bazy.
  const canWrite = ctx.role === "owner";

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/zamowienia" label={`← ${tSection("title")}`} />
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      {/*
        Wejście w punkty odbioru stoi NAD kartą reguły dostępu i nad czterema
        formularzami, a nie pod nimi — z dwóch powodów. Po pierwsze karta reguły
        mówi o zapisie USTAWIEŃ (właściciel, RLS 0024), a punkty odbioru
        prowadzi każdy członek zespołu; zamknięta pod nią wyglądałaby na objętą
        tym samym ograniczeniem. Po drugie to nawigacja, nie ustawienie: gdyby
        stała na końcu, trzeba by przewinąć dwadzieścia jeden pól konfiguracji
        kuriera, żeby dojść do ekranu, na którym pracuje się na co dzień.
      */}
      <ScreenSection
        data-delivery-locations-entry="true"
        title={tLocations("title")}
        description={tLocations("cardDescription")}
      >
        <div>
          <Button asChild variant="secondary">
            <Link href="/ustawienia-dostaw/punkty-odbioru">{tLocations("cardCta")}</Link>
          </Button>
        </div>
      </ScreenSection>

      <ScreenSection
        data-delivery-access-rule={canWrite ? "owner-writes" : "member-reads"}
        description={canWrite ? t("accessRuleOwner") : t("accessRuleMember")}
      />

      <CredentialsForm
        action={saveCourierCredentialsAction}
        configured={passwordSet === true}
        canWrite={canWrite}
        defaults={
          credentials
            ? { email: s(credentials.email), environment: s(credentials.environment) || "test" }
            : null
        }
      />
      <SenderForm action={saveCourierSenderAction} canWrite={canWrite} defaults={senderDefaults} />
      <ParcelForm action={saveCourierParcelAction} canWrite={canWrite} defaults={parcelDefaults} />
      <PricingForm
        action={saveDeliveryPricingAction}
        canWrite={canWrite}
        defaults={pricingDefaults}
      />
    </FormMeasure>
  );
}

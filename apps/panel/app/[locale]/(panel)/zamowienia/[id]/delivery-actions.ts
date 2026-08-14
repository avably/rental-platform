"use server";

/**
 * Akcje przesyłek kurierskich (Zadanie 7). Wzorzec deposit-actions.ts:
 * walidacja Zod PRZED Supabase, guard requireMember (obie role — nadanie
 * przesyłki to praca lady), mutacje klientem z sesją (RLS 0013 jest bramką).
 *
 * Konfiguracja tenanta czytana per żądanie; CourierConfigError z silnika →
 * czytelny komunikat z LISTĄ braków (zero twardych fallbacków — decyzja
 * wiążąca nr 5, ADR-030/031). CI/dev nie dotyka żywego API — błędy dostawcy
 * (GlobKurierAPIError) wracają jako komunikat formularza.
 */
import { revalidatePath } from "next/cache";

import type { EmailTenantLogo } from "@avably/emails";
import {
  COUNTRY_IDS,
  DEFAULT_TENANT_LOCALE,
  EMAIL_SENDER_KEY,
  GlobKurierAPIError,
  buildBestPriceRequest,
  courierOfferFromProduct,
  emailAvailability,
  isLocale,
  isShipmentCancellable,
  mapProviderStatus,
  resendTransport,
  type CarrierOffer,
  type CourierSender,
  type Locale,
  type ShipmentParty,
  type ShipmentStatus,
  type ShipmentType,
  type TenantSettingRow,
} from "@avably/core";

import { AuthError } from "@/lib/auth";
import { assertClosableOrder } from "@/lib/closing";
import { panelEmailLogRecorder } from "@/lib/email-log";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";
import { tenantEmailLogo } from "@/lib/tenant-mark";

import { loadCourierApi } from "./delivery";
import {
  carrierSearchSchema,
  pickupReturnReminderSchema,
  returnLabelEmailSchema,
  shipmentCancelSchema,
  shipmentCreateSchema,
  shipmentRefreshAllSchema,
  shipmentRefreshSchema,
} from "./delivery-validation";
import {
  sendPickupReturnReminderEmail,
  sendReturnLabelEmail,
  type ReturnEmailCustomer,
} from "./return-email";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

interface OrderForShipmentRow {
  id: string;
  order_number: string;
  delivery_method: string;
}

/** Stan wyszukiwarki przewoźników: oferty ALBO powód, dla którego ich nie ma. */
export type CarrierSearchState = FormState & { offers?: CarrierOffer[] };

/** Pola strony przesyłki z formularza → neutralna strona (nadawca/odbiorca). */
function partyFromFields(fields: {
  name: string;
  street: string;
  houseNumber: string;
  apartmentNumber?: string;
  postCode: string;
  city: string;
  phone: string;
  email: string;
}): ShipmentParty {
  return {
    name: fields.name,
    street: fields.street,
    houseNumber: fields.houseNumber,
    ...(fields.apartmentNumber !== undefined ? { apartmentNumber: fields.apartmentNumber } : {}),
    postCode: fields.postCode,
    city: fields.city,
    phone: fields.phone,
    email: fields.email,
  };
}

/**
 * Wyszukiwarka przewoźników z cenami (searchProducts → GET /products).
 *
 * To zapytanie CENOWE, nie zlecenie: NIE tworzy przesyłki i NIE niesie kosztu —
 * dlatego wolno je wołać przy weryfikacji na koncie testowym kuriera. Klucze
 * dostawcy liczone są na SERWERZE (loadCourierApi odszyfrowuje hasło); do
 * przeglądarki wraca sama lista ofert (bez credentiali). Oferty posortowane
 * rosnąco ceną, żeby klient mógł zaznaczyć najtańszą domyślnie.
 */
export async function searchCarriersAction(
  _prevState: CarrierSearchState,
  formData: FormData,
): Promise<CarrierSearchState> {
  const parsed = carrierSearchSchema.safeParse({
    orderId: str(formData.get("orderId")),
    senderPostCode: str(formData.get("senderPostCode")),
    receiverPostCode: str(formData.get("receiverPostCode")),
    lengthCm: str(formData.get("lengthCm")),
    widthCm: str(formData.get("widthCm")),
    heightCm: str(formData.get("heightCm")),
    weightKg: str(formData.get("weightKg")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138): komplet kurierski jest na allowliście —
  // bez niego klient, który dostał sprzęt kurierem, nie ma jak go odesłać.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: order } = await ctx.supabase
    .from("orders")
    .select("id, delivery_method")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.orderId)
    .maybeSingle();
  if (!order) return { formError: "Zamówienie nie istnieje albo zostało usunięte." };
  if (order.delivery_method !== "courier") {
    return { formError: "Przewoźników wyszukujemy tylko dla zamówień z dostawą kurierem." };
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  let products;
  try {
    products = await courier.api.searchProducts({
      senderPostCode: parsed.data.senderPostCode,
      senderCountryId: COUNTRY_IDS.POLAND,
      receiverPostCode: parsed.data.receiverPostCode,
      receiverCountryId: COUNTRY_IDS.POLAND,
      length: parsed.data.lengthCm,
      width: parsed.data.widthCm,
      height: parsed.data.heightCm,
      weight: parsed.data.weightKg,
      collectionType: "PICKUP",
    });
  } catch (err) {
    if (err instanceof GlobKurierAPIError) {
      return { formError: `Nie udało się pobrać ofert przewoźników: ${err.message}` };
    }
    throw err;
  }

  const offers = products
    .map(courierOfferFromProduct)
    .sort((a, b) => a.priceGrosze - b.priceGrosze);
  if (offers.length === 0) {
    return { formError: "Brak dostępnych przewoźników dla podanych parametrów przesyłki." };
  }
  return { offers };
}

export async function createShipmentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shipmentCreateSchema.safeParse({
    orderId: str(formData.get("orderId")),
    shipmentType: str(formData.get("shipmentType")),
    lengthCm: str(formData.get("lengthCm")),
    widthCm: str(formData.get("widthCm")),
    heightCm: str(formData.get("heightCm")),
    weightKg: str(formData.get("weightKg")),
    content: str(formData.get("content")),
    productId: str(formData.get("productId")),
    insurance: str(formData.get("insurance")),
    insuranceValuePln: str(formData.get("insuranceValuePln")),
    saturdayDelivery: str(formData.get("saturdayDelivery")),
    senderName: str(formData.get("senderName")),
    senderStreet: str(formData.get("senderStreet")),
    senderHouseNumber: str(formData.get("senderHouseNumber")),
    senderApartmentNumber: str(formData.get("senderApartmentNumber")),
    senderPostCode: str(formData.get("senderPostCode")),
    senderCity: str(formData.get("senderCity")),
    senderPhone: str(formData.get("senderPhone")),
    senderEmail: str(formData.get("senderEmail")),
    recipientName: str(formData.get("recipientName")),
    recipientStreet: str(formData.get("recipientStreet")),
    recipientHouseNumber: str(formData.get("recipientHouseNumber")),
    recipientApartmentNumber: str(formData.get("recipientApartmentNumber")),
    recipientPostCode: str(formData.get("recipientPostCode")),
    recipientCity: str(formData.get("recipientCity")),
    recipientPhone: str(formData.get("recipientPhone")),
    recipientEmail: str(formData.get("recipientEmail")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138) — jak w searchCarriersAction.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: order } = await ctx.supabase
    .from("orders")
    .select("id, order_number, delivery_method")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.orderId)
    .maybeSingle();
  if (!order) return { formError: "Zamówienie nie istnieje albo zostało usunięte." };

  const row = order as unknown as OrderForShipmentRow;
  if (row.delivery_method !== "courier") {
    return {
      formError:
        "Przesyłki kurierskie są dostępne tylko dla zamówień z metodą dostawy „kurier”.",
    };
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  // Nadawca i odbiorca z formularza (prefill z konfiguracji/kartoteki, override
  // na tę przesyłkę). Konfiguracja tenanta wciąż jest bramką credentiali
  // (loadCourierApi), ale adresy bierzemy z tego, co operator zatwierdził.
  const sender: CourierSender = {
    name: parsed.data.senderName,
    street: parsed.data.senderStreet,
    houseNumber: parsed.data.senderHouseNumber,
    ...(parsed.data.senderApartmentNumber !== undefined
      ? { apartmentNumber: parsed.data.senderApartmentNumber }
      : {}),
    postCode: parsed.data.senderPostCode,
    city: parsed.data.senderCity,
    phone: parsed.data.senderPhone,
    email: parsed.data.senderEmail,
  };
  const recipient = partyFromFields({
    name: parsed.data.recipientName,
    street: parsed.data.recipientStreet,
    houseNumber: parsed.data.recipientHouseNumber,
    apartmentNumber: parsed.data.recipientApartmentNumber,
    postCode: parsed.data.recipientPostCode,
    city: parsed.data.recipientCity,
    phone: parsed.data.recipientPhone,
    email: parsed.data.recipientEmail,
  });

  const request = buildBestPriceRequest({
    type: parsed.data.shipmentType as ShipmentType,
    sender,
    customer: recipient,
    parcel: {
      lengthCm: parsed.data.lengthCm,
      widthCm: parsed.data.widthCm,
      heightCm: parsed.data.heightCm,
      weightKg: parsed.data.weightKg,
    },
    content: parsed.data.content,
    referenceNumber: row.order_number,
    ...(parsed.data.productId !== undefined ? { productId: parsed.data.productId } : {}),
    ...(parsed.data.insurance && parsed.data.insuranceValuePln !== undefined
      ? { insuranceValuePln: parsed.data.insuranceValuePln }
      : {}),
    ...(parsed.data.saturdayDelivery ? { saturdayDelivery: true } : {}),
  });

  let created;
  try {
    created = await courier.api.createOrderBestPrice(request);
  } catch (err) {
    if (err instanceof GlobKurierAPIError) {
      return { formError: `Nadanie przesyłki odrzucone przez GlobKurier: ${err.message}` };
    }
    throw err;
  }
  if (!created.number) {
    return {
      formError:
        "GlobKurier nie zwrócił numeru zamówienia — przesyłka mogła nie zostać nadana, sprawdź panel dostawcy.",
    };
  }

  // `.select("id")` po mutacji: RLS nie zgłasza odmowy, dosięga zero wierszy
  // — pusty wynik musi być błędem, nie cichym sukcesem (wzorzec deposit-actions).
  const { data: inserted, error: insertError } = await ctx.supabase
    .from("courier_shipments")
    .insert({
      tenant_id: ctx.tenantId,
      order_id: row.id,
      shipment_type: parsed.data.shipmentType,
      status: mapProviderStatus(created.status) ?? "created",
      provider_order_number: created.number,
      provider_order_hash: created.hash ?? null,
      provider_status: created.status,
      tracking_number: created.trackingNumber ?? null,
      tracking_url: created.trackingUrl ?? null,
      price_grosze: Number.isFinite(created.pricing.priceGross)
        ? Math.round(created.pricing.priceGross * 100)
        : null,
      length_cm: parsed.data.lengthCm,
      width_cm: parsed.data.widthCm,
      height_cm: parsed.data.heightCm,
      weight_kg: parsed.data.weightKg,
      content: parsed.data.content,
      created_by: ctx.user.id,
    })
    .select("id");
  if (insertError || !inserted || inserted.length === 0) {
    // Przesyłka JEST nadana u dostawcy — komunikat niesie jej numer, żeby
    // operator mógł ją odnaleźć, zamiast udawać pełną porażkę.
    return {
      formError:
        `Przesyłka nadana u dostawcy (${created.number}), ale zapis w systemie nie powiódł się` +
        `${insertError ? `: ${insertError.message}` : ""}. Zanotuj numer i odśwież stronę.`,
    };
  }

  revalidatePath("/", "layout");
  return { success: parsed.data.shipmentType };
}

export async function refreshShipmentStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shipmentRefreshSchema.safeParse({
    shipmentId: str(formData.get("shipmentId")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138); zamówienie przesyłki znamy dopiero
  // z wiersza — predykat zbioru stoi ZA odczytem, przed dostawcą.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: shipment } = await ctx.supabase
    .from("courier_shipments")
    .select("id, order_id, provider_order_number")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.shipmentId)
    .maybeSingle();
  if (!shipment) return { formError: "Przesyłka nie istnieje albo została usunięta." };
  try {
    await assertClosableOrder(ctx, shipment.order_id as string);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  let remote;
  try {
    remote = await courier.api.getOrder(shipment.provider_order_number as string);
  } catch (err) {
    if (err instanceof GlobKurierAPIError) {
      return { formError: `Nie udało się pobrać statusu z GlobKurier: ${err.message}` };
    }
    throw err;
  }

  // Nieznany status dostawcy NIE zmienia wewnętrznego cyklu życia — surowy
  // ląduje w provider_status (ADR-031).
  const mapped = mapProviderStatus(remote.status);
  const { data: updated, error: updateError } = await ctx.supabase
    .from("courier_shipments")
    .update({
      ...(mapped ? { status: mapped } : {}),
      provider_status: remote.status,
      tracking_number: remote.trackingNumber ?? null,
      tracking_url: remote.trackingUrl ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.shipmentId)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    return { formError: "Nie udało się zapisać odświeżonego statusu przesyłki." };
  }

  revalidatePath("/", "layout");
  return { success: "refreshed" };
}

/**
 * Anulowanie nadanej przesyłki U DOSTAWCY (L4, ADR-105).
 *
 * Do L4 `GlobKurierAPI.cancelOrder` istniało wraz z testem, ale nie wołała go
 * ANI JEDNA linijka aplikacji: jedyną drogą do `status='cancelled'` była
 * synchronizacja, czyli anulowanie musiało zajść poza systemem, w panelu
 * dostawcy. Operator miał w Avably przycisk „Anuluj", który zamykał modal.
 *
 * KOLEJNOŚĆ JEST TU CAŁĄ TREŚCIĄ AKCJI: najpierw potwierdzenie od dostawcy,
 * dopiero potem zapis `cancelled`. Odwrotna kolejność (albo zapis „na wszelki
 * wypadek" przy błędzie dostawcy) daje rozjazd, w którym system twierdzi, że
 * przesyłki nie ma, a kurier ją wiezie i wystawia za nią fakturę. Dlatego
 * błąd dostawcy zostawia stan lokalny NIETKNIĘTY i wraca jako komunikat.
 *
 * Credentiale kuriera pochodzą z ustawień TENANTA Z JWT (loadCourierApi
 * dostaje `ctx.tenantId`) — nigdy z formularza i nigdy współdzielone; wiersz
 * przesyłki jest wyszukiwany z tym samym ograniczeniem, więc dla cudzej
 * przesyłki nie dochodzi nawet do zapytania u dostawcy.
 */
export async function cancelShipmentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shipmentCancelSchema.safeParse({
    shipmentId: str(formData.get("shipmentId")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138): anulowanie PRZESYŁKI (nie zamówienia!)
  // jest na allowliście — błędnie nadaną etykietę trzeba móc wycofać, zanim
  // przewoźnik naliczy koszt. Predykat zbioru za odczytem wiersza.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: shipment } = await ctx.supabase
    .from("courier_shipments")
    .select("id, order_id, status, provider_order_number")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.shipmentId)
    .maybeSingle();
  if (!shipment) return { formError: "Przesyłka nie istnieje albo została usunięta." };
  try {
    await assertClosableOrder(ctx, shipment.order_id as string);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Odmowa PRZED dotknięciem dostawcy: żądanie anulowania przesyłki w drodze
  // albo doręczonej to koszt bez skutku (a przy niektórych przewoźnikach —
  // koszt ze skutkiem, którego nikt nie chciał).
  if (!isShipmentCancellable(shipment.status as ShipmentStatus)) {
    return {
      formError:
        "Tej przesyłki nie da się już anulować — anulowanie jest możliwe, dopóki przewoźnik " +
        "jej nie odebrał. Obecny status: " + String(shipment.status) + ".",
    };
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  try {
    await courier.api.cancelOrder(shipment.provider_order_number as string);
  } catch (err) {
    if (err instanceof GlobKurierAPIError) {
      // Brak zapisu lokalnego — patrz nagłówek.
      return { formError: `Dostawca nie anulował przesyłki: ${err.message}` };
    }
    throw err;
  }

  const { data: updated, error: updateError } = await ctx.supabase
    .from("courier_shipments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.shipmentId)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    // Rozjazd W DRUGĄ STRONĘ (u dostawcy anulowana, u nas nie) jest mniej
    // groźny, ale nie wolno go przemilczeć: mówimy wprost, co się stało
    // i czym to naprawić.
    return {
      formError:
        `Przesyłka została anulowana u dostawcy, ale zapis statusu w systemie nie powiódł się` +
        `${updateError ? `: ${updateError.message}` : ""}. Odśwież status przesyłki.`,
    };
  }

  revalidatePath("/", "layout");
  return { success: "shipmentCancelled" };
}

/**
 * Zbiorcze odświeżenie statusów WSZYSTKICH przesyłek zamówienia (przycisk
 * „Odśwież status przesyłek"). Każda przesyłka pytana osobno (getOrder —
 * odczyt, bez kosztu); pojedyncza porażka dostawcy nie wywraca całości —
 * liczymy odświeżone i nieudane, a wynik częściowy wraca jako NEUTRALNY
 * komunikat (nie „sukces", który kłamałby o niezsynchronizowanych, ani
 * „błąd", gdy część się udała).
 */
export async function refreshOrderShipmentsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shipmentRefreshAllSchema.safeParse({
    orderId: str(formData.get("orderId")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138) — jak w searchCarriersAction.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: shipments } = await ctx.supabase
    .from("courier_shipments")
    .select("id, provider_order_number")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", parsed.data.orderId);
  if (!shipments || shipments.length === 0) {
    return { formError: "To zamówienie nie ma jeszcze przesyłek do odświeżenia." };
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  let refreshed = 0;
  let failed = 0;
  for (const shipment of shipments) {
    try {
      const remote = await courier.api.getOrder(shipment.provider_order_number as string);
      const mapped = mapProviderStatus(remote.status);
      const { error: updateError } = await ctx.supabase
        .from("courier_shipments")
        .update({
          ...(mapped ? { status: mapped } : {}),
          provider_status: remote.status,
          tracking_number: remote.trackingNumber ?? null,
          tracking_url: remote.trackingUrl ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", shipment.id)
        .select("id");
      if (updateError) failed += 1;
      else refreshed += 1;
    } catch (err) {
      if (err instanceof GlobKurierAPIError) {
        failed += 1;
        continue;
      }
      throw err;
    }
  }

  revalidatePath("/", "layout");
  if (refreshed === 0) {
    return { formError: "Nie udało się odświeżyć statusów przesyłek — spróbuj ponownie." };
  }
  if (failed > 0) {
    return {
      notice: `Odświeżono ${refreshed} z ${refreshed + failed} przesyłek — dla ${failed} dostawca nie zwrócił statusu.`,
    };
  }
  return { success: "refreshedAll" };
}

// ---------------------------------------------------------------------------
// Zadanie 2.5 (ADR-043): e-maile zwrotów wysyłane RĘCZNIE przez operatora.
//
// FAKT WYSŁANIA NIE JEST UTRWALANY — wynik wraca w FormState do operatora
// (sukces albo uczciwy powód niewysłania). Wybór prostszego wariantu z briefu:
// zapis do orders.notes wymagałby read-modify-write cudzego, wolnego pola
// operatora (ryzyko nadpisania) i nic nie wnosi dla MVP, w którym to operator
// inicjuje wysyłkę i od razu widzi wynik. Bez migracji, bez nowej kolumny —
// dokładnie jak 8b pokazuje powód niewysłania zamiast go zapisywać.
//
// Wysyłka NIGDY nie wywraca akcji: logika (bramki, uczciwa częściowa porażka)
// siedzi w send*Email z return-email.ts i jest testowana bez Supabase.
// ---------------------------------------------------------------------------

/** Locale tenanta zsanityzowane: nieznana wartość spada na domyślną, nie wywala wysyłki. */
function tenantLocaleOrDefault(raw: string | null): Locale {
  return isLocale(raw ?? "") ? (raw as Locale) : DEFAULT_TENANT_LOCALE;
}

interface ReturnEmailOrderRow {
  order_number: string;
  end_date: string;
  delivery_method: string;
  customers: ReturnEmailCustomer | null;
  pickup_locations: {
    name: string;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
  } | null;
}

/**
 * Wspólny odczyt danych do wiadomości zwrotu: zamówienie (klient + punkt),
 * nadawca tenanta i nazwa/locale tenanta. Zwraca komplet albo POWÓD, dla
 * którego wiadomości nie da się złożyć.
 */
async function loadReturnEmailContext(
  ctx: Awaited<ReturnType<typeof requireMember>>,
  orderId: string,
): Promise<
  | {
      order: ReturnEmailOrderRow;
      settings: TenantSettingRow[];
      tenantName: string;
      /** Znak najemcy, KTÓREGO DOTYCZY zamówienie (ADR-175); brak = nazwa tekstem. */
      tenantLogo: EmailTenantLogo | undefined;
      tenantLocale: Locale;
    }
  | { error: string }
> {
  const [orderResult, settingsResult, tenantResult] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select(
        "order_number, end_date, delivery_method, customers(full_name, email, locale), pickup_locations(name, address_street, address_zip, address_city)",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", orderId)
      .maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
    // Kolumna OPUBLIKOWANA, nigdy szkic: wiadomość wychodzi na zewnątrz (ADR-175).
    ctx.supabase.from("tenants").select("name, locale, logo_published").eq("id", ctx.tenantId).maybeSingle(),
  ]);

  const order = orderResult.data as unknown as ReturnEmailOrderRow | null;
  const tenant = tenantResult.data as
    | { name: string; locale: string | null; logo_published?: unknown }
    | null;
  if (!order || !tenant) {
    return { error: "Nie udało się odczytać danych zamówienia — wiadomość nie została wysłana." };
  }

  return {
    order,
    settings: (settingsResult.data ?? []) as TenantSettingRow[],
    tenantName: tenant.name,
    // Znak z WIERSZA tego najemcy (ADR-175); brak = nazwa tekstem.
    tenantLogo: tenantEmailLogo(tenant),
    tenantLocale: tenantLocaleOrDefault(tenant.locale),
  };
}

/**
 * „Wyślij klientowi etykietę zwrotną e-mailem" — dla ISTNIEJĄCEJ przesyłki
 * zwrotnej. Etykieta pobierana TĄ SAMĄ ścieżką serwerową co route handler
 * PDF (loadCourierApi → getLabelsByHashes po provider_order_hash — hash nie
 * wychodzi do przeglądarki) i dołączana jako załącznik.
 */
export async function sendReturnLabelEmailAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = returnLabelEmailSchema.safeParse({
    orderId: str(formData.get("orderId")),
    shipmentId: str(formData.get("shipmentId")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138): etykieta zwrotna to JEDYNY mechanizm
  // odesłania sprzętu przy dostawie kurierem — musi działać w oknie.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Brak klucza Resend = JAWNA niedostępność (ADR-033) i zero pracy dostawcy:
  // nie ściągamy etykiety, której i tak nie wyślemy.
  const availability = emailAvailability();
  if (!availability.available) {
    // Neutralnie i bez powodu z serwera (U1, audyt W3): to sprawa platformy.
    return {
      formError:
        "Wysyłka e-maili jest chwilowo niedostępna po stronie platformy — spróbuj ponownie później.",
    };
  }

  const { data: shipment } = await ctx.supabase
    .from("courier_shipments")
    .select("id, shipment_type, provider_order_number, provider_order_hash")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", parsed.data.orderId)
    .eq("id", parsed.data.shipmentId)
    .maybeSingle();
  if (!shipment) return { formError: "Przesyłka nie istnieje albo została usunięta." };
  if (shipment.shipment_type !== "return") {
    return { formError: "Etykietę zwrotną można wysłać tylko dla przesyłki zwrotnej." };
  }
  if (!shipment.provider_order_hash) {
    return { formError: "Dostawca nie udostępnił jeszcze etykiety tej przesyłki." };
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  let labelPdf: Uint8Array;
  try {
    labelPdf = await courier.api.getLabelsByHashes(
      [shipment.provider_order_hash as string],
      "A4",
    );
  } catch (err) {
    if (err instanceof GlobKurierAPIError) {
      return { formError: `Nie udało się pobrać etykiety zwrotnej: ${err.message}` };
    }
    throw err;
  }

  const context = await loadReturnEmailContext(ctx, parsed.data.orderId);
  if ("error" in context) return { formError: context.error };

  const reason = await sendReturnLabelEmail({
    availability,
    transport: resendTransport(),
    customer: context.order.customers,
    settings: context.settings,
    tenantName: context.tenantName,
    ...(context.tenantLogo ? { tenantLogo: context.tenantLogo } : {}),
    tenantLocale: context.tenantLocale,
    orderNumber: context.order.order_number,
    endDate: context.order.end_date,
    shipmentNumber: shipment.provider_order_number as string,
    labelPdf,
    orderId: parsed.data.orderId,
    recorder: panelEmailLogRecorder(ctx.supabase, ctx.tenantId!),
  });

  return reason ? { formError: reason } : { success: "labelEmailSent" };
}

/**
 * „Wyślij przypomnienie o zwrocie" — dla zamówienia z odbiorem osobistym
 * (delivery_method='pickup'). Dane punktu z kartoteki zamówienia; telefon
 * i godziny otwarcia NIE istnieją dziś w pickup_locations (dług ADR-043),
 * więc przypomnienie podaje adres bez nich, zamiast fabrykować wartości.
 */
export async function sendPickupReturnReminderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = pickupReturnReminderSchema.safeParse({
    orderId: str(formData.get("orderId")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  // Opt-in okna domykania (ADR-138) — przypomnienie o zwrocie domyka najem.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const availability = emailAvailability();
  if (!availability.available) {
    // Neutralnie i bez powodu z serwera (U1, audyt W3): to sprawa platformy.
    return {
      formError:
        "Wysyłka e-maili jest chwilowo niedostępna po stronie platformy — spróbuj ponownie później.",
    };
  }

  const context = await loadReturnEmailContext(ctx, parsed.data.orderId);
  if ("error" in context) return { formError: context.error };

  if (context.order.delivery_method !== "pickup") {
    return {
      formError: "Przypomnienie o zwrocie dotyczy zamówień z odbiorem osobistym.",
    };
  }
  const location = context.order.pickup_locations;
  if (!location) {
    return { formError: "Zamówienie nie ma przypisanego punktu odbioru." };
  }

  // Adres z osobnych kolumn kartoteki punktu; puste pomijamy (kartoteka
  // dopuszcza braki — 0007). Zero fabrykowania: pokazujemy to, co jest.
  const address = [
    location.address_street,
    [location.address_zip, location.address_city].filter((p) => p?.trim()).join(" "),
  ]
    .filter((p) => p?.trim())
    .join(", ");

  const reason = await sendPickupReturnReminderEmail({
    availability,
    transport: resendTransport(),
    customer: context.order.customers,
    settings: context.settings,
    tenantName: context.tenantName,
    ...(context.tenantLogo ? { tenantLogo: context.tenantLogo } : {}),
    tenantLocale: context.tenantLocale,
    orderNumber: context.order.order_number,
    endDate: context.order.end_date,
    locationName: location.name,
    locationAddress: address,
    orderId: parsed.data.orderId,
    recorder: panelEmailLogRecorder(ctx.supabase, ctx.tenantId!),
  });

  return reason ? { formError: reason } : { success: "pickupReminderSent" };
}

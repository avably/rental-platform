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

import {
  DEFAULT_TENANT_LOCALE,
  EMAIL_SENDER_KEY,
  GlobKurierAPIError,
  buildBestPriceRequest,
  emailAvailability,
  isLocale,
  mapProviderStatus,
  resendTransport,
  type Locale,
  type ShipmentParty,
  type ShipmentType,
  type TenantSettingRow,
} from "@avably/core";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import { loadCourierApi } from "./delivery";
import {
  pickupReturnReminderSchema,
  returnLabelEmailSchema,
  shipmentCreateSchema,
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
  customers: {
    full_name: string | null;
    email: string;
    phone: string | null;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
  } | null;
}

/**
 * Adres klienta z kartoteki → strona przesyłki. Braki są wymieniane z nazwy
 * (operator ma uzupełnić kartotekę klienta, nie zgadywać) — fabrykowanie
 * którejkolwiek wartości do API kurierskiego to anty-wzorzec usuwany tym
 * zadaniem. Numer domu/lokalu przychodzi z formularza nadania: customers
 * trzyma ulicę jednym polem.
 */
function customerToParty(
  customer: OrderForShipmentRow["customers"],
  houseNumber: string,
  apartmentNumber: string | undefined,
): { party: ShipmentParty } | { missing: string[] } {
  const missing: string[] = [];
  if (!customer?.full_name?.trim()) missing.push("imię i nazwisko");
  if (!customer?.address_street?.trim()) missing.push("ulica");
  if (!customer?.address_zip?.trim()) missing.push("kod pocztowy");
  if (!customer?.address_city?.trim()) missing.push("miasto");
  if (!customer?.phone?.trim()) missing.push("telefon");
  if (missing.length > 0 || !customer) return { missing };
  return {
    party: {
      name: customer.full_name as string,
      street: customer.address_street as string,
      houseNumber,
      ...(apartmentNumber !== undefined ? { apartmentNumber } : {}),
      postCode: customer.address_zip as string,
      city: customer.address_city as string,
      phone: customer.phone as string,
      email: customer.email,
    },
  };
}

export async function createShipmentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shipmentCreateSchema.safeParse({
    orderId: str(formData.get("orderId")),
    shipmentType: str(formData.get("shipmentType")),
    houseNumber: str(formData.get("houseNumber")),
    apartmentNumber: str(formData.get("apartmentNumber")),
    lengthCm: str(formData.get("lengthCm")),
    widthCm: str(formData.get("widthCm")),
    heightCm: str(formData.get("heightCm")),
    weightKg: str(formData.get("weightKg")),
    content: str(formData.get("content")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: order } = await ctx.supabase
    .from("orders")
    .select(
      "id, order_number, delivery_method, customers(full_name, email, phone, address_street, address_zip, address_city)",
    )
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

  const customer = customerToParty(
    row.customers,
    parsed.data.houseNumber,
    parsed.data.apartmentNumber,
  );
  if ("missing" in customer) {
    return {
      formError: `Kartoteka klienta jest niekompletna — uzupełnij: ${customer.missing.join(", ")}.`,
    };
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) return { formError: courier.configError };

  const request = buildBestPriceRequest({
    type: parsed.data.shipmentType as ShipmentType,
    sender: courier.config.sender,
    customer: customer.party,
    parcel: {
      lengthCm: parsed.data.lengthCm,
      widthCm: parsed.data.widthCm,
      heightCm: parsed.data.heightCm,
      weightKg: parsed.data.weightKg,
    },
    content: parsed.data.content,
    referenceNumber: row.order_number,
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

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data: shipment } = await ctx.supabase
    .from("courier_shipments")
    .select("id, provider_order_number")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.shipmentId)
    .maybeSingle();
  if (!shipment) return { formError: "Przesyłka nie istnieje albo została usunięta." };

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
    ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
  ]);

  const order = orderResult.data as unknown as ReturnEmailOrderRow | null;
  const tenant = tenantResult.data as { name: string; locale: string | null } | null;
  if (!order || !tenant) {
    return { error: "Nie udało się odczytać danych zamówienia — wiadomość nie została wysłana." };
  }

  return {
    order,
    settings: (settingsResult.data ?? []) as TenantSettingRow[],
    tenantName: tenant.name,
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

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Brak klucza Resend = JAWNA niedostępność (ADR-033) i zero pracy dostawcy:
  // nie ściągamy etykiety, której i tak nie wyślemy.
  const availability = emailAvailability();
  if (!availability.available) {
    return { formError: availability.reason ?? "Wysyłka e-maili jest niedostępna." };
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
    tenantLocale: context.tenantLocale,
    orderNumber: context.order.order_number,
    endDate: context.order.end_date,
    shipmentNumber: shipment.provider_order_number as string,
    labelPdf,
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

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const availability = emailAvailability();
  if (!availability.available) {
    return { formError: availability.reason ?? "Wysyłka e-maili jest niedostępna." };
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
    tenantLocale: context.tenantLocale,
    orderNumber: context.order.order_number,
    endDate: context.order.end_date,
    locationName: location.name,
    locationAddress: address,
  });

  return reason ? { formError: reason } : { success: "pickupReminderSent" };
}

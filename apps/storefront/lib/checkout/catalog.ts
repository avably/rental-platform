/**
 * Publiczny odczyt katalogu i dostępności storefrontu (Zadanie 2.4a) —
 * WARSTWA DANYCH dla katalogu/koszyka 2.4b (komponenty powstają osobno).
 *
 * Jedyne ścieżki: app.get_public_catalog / app.get_public_availability (0020,
 * SECURITY DEFINER — wzorzec ADR-039/041). Anonimowy odwiedzający nie ma grantów
 * na products/product_units/... — RPC zwracają jawnie wybrane kolumny (bez
 * credentiali, bez numerów seryjnych, bez danych zamówień) i NULL dla tenanta
 * nieaktywnego / produktu nieosiągalnego. Fail-closed: błąd transportu = NULL.
 *
 * `client` wstrzykiwalny dla testów; produkcyjnie klient anon z cookies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";

import { customFieldsFromPublicRows } from "./custom-fields";
import type {
  PublicAvailability,
  PublicAvailabilityDays,
  PublicCatalog,
  PublicCatalogAvailability,
  PublicCustomField,
} from "./contract";

/**
 * Definicje pól własnych ZAMAWIANIA (C6-A3, 0058) — osobno od katalogu, bo
 * ścieżka ZAPISU (rdzeń checkoutu) potrzebuje ich przy każdym żądaniu, a nie
 * potrzebuje przy tym całego katalogu z cennikiem i zdjęciami. Strona
 * checkoutu bierze te same definicje z katalogu, który i tak już czyta.
 *
 * BŁĄD ODCZYTU ≠ BRAK PÓL. Odwrotnie niż `get_public_catalog`/`_availability`
 * (gdzie null = „online niedostępne", tor offline działa dalej), TA lista
 * bramkuje egzekwowanie pól WYMAGANYCH przy zapisie. Gdyby błąd transportu
 * dawał pustą listę, chwilowy blip zdejmowałby wymagalność — 201 i zamówienie
 * bez pola, które najemca oznaczył jako obowiązkowe. Dlatego RZUCAMY na błąd:
 * rdzeń checkoutu łapie to i ZAMYKA ścieżkę (odmowa), zamiast przepuścić.
 * Ścieżka RENDEROWANIA definicji nie wchodzi tędy — bierze je z katalogu
 * (`get_public_catalog`), więc odmowa dotyka wyłącznie ZAPISU.
 */
export async function getPublicCustomFields(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublicCustomField[]> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_custom_fields", { p_tenant_id: tenantId });

  if (error) {
    throw new Error(
      `Odczyt definicji pól własnych nie powiódł się (${error.code ?? error.message}).`,
    );
  }
  // Brak błędu, ale nie-tablica (np. najemca nieaktywny → null): PRAWDZIWY brak
  // pól, a nie awaria — pusta lista jest tu poprawną odpowiedzią.
  if (!Array.isArray(data)) return [];
  return data as PublicCustomField[];
}

/** To samo, ale w kształcie domenowym — tak, jak chce rdzeń pól własnych. */
export async function readCheckoutCustomFieldDefinitions(
  tenantId: string,
  client?: SupabaseClient,
) {
  return customFieldsFromPublicRows(await getPublicCustomFields(tenantId, client));
}

export async function getPublicCatalog(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublicCatalog | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_catalog", { p_tenant_id: tenantId });

  if (error || data == null) return null;
  return data as PublicCatalog;
}

export async function getPublicAvailability(
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicAvailability | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_availability", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicAvailability;
}

/**
 * Dostępność CAŁEGO katalogu jednym odczytem (0081, ADR-179).
 *
 * Istnieje po to, żeby katalog i wykrywanie konfliktu w koszyku nie robiły
 * jednego zapytania NA POZYCJĘ. Fail-closed jak reszta warstwy: błąd transportu
 * daje `null`, czyli „dostępności nie znamy" — nigdy pustej listy, bo pusta
 * lista znaczyłaby „najemca nie ma ani jednej pozycji" i cicho zdejmowałaby
 * blokadę kasy przy konflikcie.
 */
export async function getPublicCatalogAvailability(
  tenantId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicCatalogAvailability | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_catalog_availability", {
    p_tenant_id: tenantId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicCatalogAvailability;
}

/**
 * Dostępność DZIENNA jednego sprzętu (0081, ADR-179) — dane dla siatki
 * kalendarza na stronie sprzętu. Baza odmawia okna szerszego niż
 * `AVAILABILITY_WINDOW_MAX_DAYS`, oddając `null`; ta warstwa go tylko przenosi.
 */
export async function getPublicAvailabilityDays(
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicAvailabilityDays | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_availability_days", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicAvailabilityDays;
}

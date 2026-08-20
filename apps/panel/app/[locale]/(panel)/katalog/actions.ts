"use server";

/**
 * Akcje CRUD produktów. Wzorzec z zaproszeń: walidacja Zod PRZED Supabase,
 * guard requireMember (obie role — katalog to praca lady, patrz
 * lib/member-page.ts), mutacje klientem z sesją — bramką jest RLS (0007),
 * zero service-role.
 */
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { productCategoryIdsSchema, productSchema, uuidSchema } from "@/lib/catalog-validation";
import { syncProductCategories } from "@/lib/catalog/categories";
import { customFieldValuesFromRow, hasCustomFieldErrors } from "@/lib/custom-fields";
import {
  readCustomFieldsForCreate,
  readCustomFieldsForUpdate,
} from "@/lib/custom-fields-server";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

/** Produkt nieosiągalny (błąd odczytu, brak wiersza, cudzy tenant) — jeden komunikat. */
const PRODUCT_NOT_FOUND = "Nie znaleziono produktu.";

/**
 * ODMOWY ADRESU SPRZĘTU WRACAJĄ DO POLA (ADR-182), nie na górę formularza.
 *
 * Baza mówi o adresie dwiema różnymi rzeczami i to są dwie różne sytuacje
 * naprawcze, więc nie wolno ich zlepiać w jeden komunikat:
 *   • 23505 na `products_slug_unique_idx` — adres stoi przy INNYM sprzęcie;
 *   • 22023 z bramki `products_slug_guard` — adres PRZEKIEROWUJE do innego
 *     sprzętu, czyli trzeba najpierw zdjąć tamto przekierowanie. Zdanie z bazy
 *     jest już po polsku i mówi dokładnie to, więc przenosimy je bez zmian.
 *
 * Surowy komunikat PostgREST-a („duplicate key value violates unique
 * constraint…") pod polem adresu byłby dla operatora szumem.
 */
function slugFieldError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "23505" && error.message.includes("products_slug_unique_idx")) {
    return {
      fieldErrors: { slug: "Ten adres jest już zajęty przez inny sprzęt - wybierz inny." },
    };
  }
  if (error.code === "22023" && error.message.includes("przekierowuje")) {
    return { fieldErrors: { slug: error.message } };
  }
  return null;
}

function productPayload(input: ReturnType<typeof productSchema.parse>) {
  return {
    name: input.name,
    /*
      ADRES JEDZIE DO BAZY TAKŻE PUSTY (ADR-182) — i to jest cała treść reguły
      „adres rodzi się z nazwy": pusta wartość znaczy dla triggera 0083
      „wygeneruj", a nie „zostaw jak było". Dzięki temu operator, który
      wyczyści pole, dostaje adres z aktualnej nazwy, a nie sierotę po starej.
    */
    slug: input.slug,
    description: input.description,
    base_price_day_grosze: input.basePriceDayGrosze,
    deposit_grosze: input.depositGrosze,
    auto_increment_multiplier: input.autoIncrementMultiplier,
    buffer_before_days: input.bufferBeforeDays,
    buffer_after_days: input.bufferAfterDays,
    min_rental_days: input.minRentalDays,
    active: input.active,
  };
}

/**
 * Zaznaczone kategorie z formularza produktu (ADR-155).
 *
 * `getAll` zamiast `get`: pole jest POWTÓRZONE (jedna nazwa, wiele wartości).
 * Brak zaznaczeń daje pustą tablicę i to jest poprawny stan — produkt bez
 * kategorii jest normalny, a nie niekompletny.
 */
function parseCategoryIds(formData: FormData) {
  return productCategoryIdsSchema.safeParse(
    formData.getAll("categoryIds").map((value) => String(value)),
  );
}

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    slug: formData.get("slug") ?? "",
    basePriceDayGrosze: formData.get("basePriceDayGrosze"),
    depositGrosze: formData.get("depositGrosze"),
    autoIncrementMultiplier: formData.get("autoIncrementMultiplier"),
    bufferBeforeDays: formData.get("bufferBeforeDays"),
    bufferAfterDays: formData.get("bufferAfterDays"),
    minRentalDays: formData.get("minRentalDays"),
    active: formData.get("active"),
  });
}

export async function createProductAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  const categoryIds = parseCategoryIds(formData);
  if (!categoryIds.success) return zodErrorToState(categoryIds.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Pola własne PRZED zapisem: rdzeń oddaje czytelny powód przy właściwym
  // polu, zanim trigger 0057 odda swój surowy. Bramką pozostaje baza.
  const custom = await readCustomFieldsForCreate(ctx.supabase, ctx.tenantId!, "product", formData);
  if (hasCustomFieldErrors(custom)) {
    return { fieldErrors: custom.fieldErrors, ...(custom.formError ? { formError: custom.formError } : {}) };
  }

  // PO UTWORZENIU PROWADZIMY DALEJ, NIE Z POWROTEM (U8b, ADR-146).
  //
  // Dotąd akcja kończyła się na liście katalogu, a produkt świeżo utworzony
  // NIE DZIAŁA W SKLEPIE: nie ma egzemplarzy (nie ma czego wydać), progów
  // (cennik jest pusty) ani zdjęć (klient nie zobaczy, co kupuje). Lista
  // pokazywała nowy wiersz jako gotowy i zostawiała operatora bez wskazówki,
  // czego brakuje. Kierujemy więc na KARTĘ nowego produktu, gdzie sekcje
  // zdjęcia i dostępności mówią wprost, czego nie ma, a zakładki są drogą do
  // uzupełnienia — dlatego insert musi oddać identyfikator.
  const { data: created, error } = await ctx.supabase
    .from("products")
    .insert({ tenant_id: ctx.tenantId, ...productPayload(parsed.data), custom_fields: custom.values })
    .select("id")
    .single();
  if (error) return slugFieldError(error) ?? { formError: error.message };
  /*
    CACHE KATALOGU W SKLEPIE — UNIEWAŻNIAMY TU, A NIE PO KATEGORIACH
    (faza 4a, ADR-185). Pozycja jest już w bazie, więc od tej chwili koperta
    katalogu w cache'u jest nieaktualna — niezależnie od tego, czy uda się
    jeszcze przypisać kategorie i czy wiersz oddał identyfikator. `redirect`
    niżej rzuca, więc unieważnienie postawione po nim nie wykonałoby się nigdy.

    Do ADR-185 ta akcja nie wołała ŻADNEGO `revalidate*` — nie było czego
    unieważniać, bo sklep czytał katalog świeżo na każdą odsłonę.
  */
  await invalidateStorefrontCatalog(ctx.tenantId!);

  // Wiersz bez identyfikatora nie jest błędem zapisu (produkt POWSTAŁ), więc
  // nie udajemy porażki — wracamy na listę, jak przed U8b.
  if (!created?.id) redirect(await localePath("/katalog"));

  // Kategorie PO produkcie, bo przypisanie potrzebuje jego identyfikatora.
  // Odmowa na tym kroku NIE cofa produktu (PostgREST nie daje transakcji
  // obejmującej dwa żądania) — zostaje jednak przy formularzu, żeby operator
  // wiedział, że przynależność się nie zapisała, zamiast zobaczyć kartę
  // produktu z pustymi kategoriami i uznać to za swoją pomyłkę.
  const categoriesError = await syncProductCategories(
    ctx.supabase,
    ctx.tenantId!,
    created.id as string,
    categoryIds.data,
  );
  if (categoriesError) return { formError: categoriesError };

  redirect(await localePath(`/katalog/${created.id}`));
}

export async function updateProductAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = parseProductForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  const categoryIds = parseCategoryIds(formData);
  if (!categoryIds.success) return zodErrorToState(categoryIds.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Wartości JUŻ ZAPISANE są częścią zapisu, nie tłem: kolumna `custom_fields`
  // idzie do bazy W CAŁOŚCI, więc bez nich zapis formularza skasowałby to, co
  // stoi pod polami zarchiwizowanymi i checkoutowymi. Odczyt jest pod RLS
  // i zawężony do najemcy — nie ma jak przynieść cudzej mapy.
  const { data: current, error: currentError } = await ctx.supabase
    .from("products")
    .select("custom_fields")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .maybeSingle();
  // BŁĄD ODCZYTU ≠ PUSTY WIERSZ. Chwilowy błąd + udany UPDATE dałby `existing={}`
  // i wyzerował wartości pól niewidocznych w panelu (zarchiwizowane oraz
  // serwowane publicznie przez get_public_catalog) — cicho, z „zapisano".
  // Zamykamy ścieżkę zamiast zapisać mapę spoza wiersza.
  if (currentError || !current) return { formError: PRODUCT_NOT_FOUND };

  const custom = await readCustomFieldsForUpdate(
    ctx.supabase,
    ctx.tenantId!,
    "product",
    formData,
    customFieldValuesFromRow(current),
  );
  if (hasCustomFieldErrors(custom)) {
    return { fieldErrors: custom.fieldErrors, ...(custom.formError ? { formError: custom.formError } : {}) };
  }

  // .select("id") po mutacji: RLS nie zgłasza błędu przy UPDATE, który nie
  // dosięgnął żadnego wiersza (cudzy tenant / zły id) — pusty wynik to jedyny
  // sygnał, że nic się nie stało, i musi być błędem, nie cichym sukcesem.
  const { data, error } = await ctx.supabase
    .from("products")
    .update({ ...productPayload(parsed.data), custom_fields: custom.values })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return slugFieldError(error) ?? { formError: error.message };
  if (!data || data.length === 0) return { formError: PRODUCT_NOT_FOUND };

  // Przypisania doprowadzamy RÓŻNICĄ, nie pełną wymianą — patrz
  // lib/catalog/categories.ts (zapis, który nic nie zmienia w kategoriach,
  // nie ma prawa przepisywać wierszy).
  const categoriesError = await syncProductCategories(
    ctx.supabase,
    ctx.tenantId!,
    id.data,
    categoryIds.data,
  );
  if (categoriesError) return { formError: categoriesError };

  // Cache katalogu w SKLEPIE (ADR-185) — nazwa, cena, kaucja, bufory, pola
  // własne i `active` tej pozycji zmieniły się w kopercie publicznej.
  await invalidateStorefrontCatalog(ctx.tenantId!);

  return { success: "saved" };
}

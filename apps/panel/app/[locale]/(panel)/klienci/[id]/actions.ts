"use server";

/**
 * Edycja danych klienta z karty (R6a).
 *
 * BRAMKĄ JEST RLS TENANTA, NIE FILTR W ZAPYTANIU. `eq("tenant_id", …)` niżej
 * jest drugą warstwą i wygodą diagnostyczną; polityki z 0007 odfiltrowałyby
 * cudzy wiersz nawet bez niego. O wyniku decyduje ODCZYT PO ZAPISIE
 * (`.select("id")`): PostgREST na UPDATE, który nie trafił w żaden wiersz,
 * odpowiada 204 bez błędu — cisza wyglądałaby jak zapisana zmiana.
 *
 * Zmiana danych klienta NIE dotyka złożonych zamówień: kwoty i dane najmu są
 * zdenormalizowane w `orders` przy składaniu (checkout), więc historia zostaje
 * taka, jaka była w chwili zamówienia. Tu edytujemy WYŁĄCZNIE profil klienta.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { customerEditFromFormData, customerEditSchema } from "@/lib/customer-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

/** Kod unikatu Postgresa — kolizja customers_tenant_email_key (0007). */
const UNIQUE_VIOLATION = "23505";

export async function updateCustomerAction(
  customerId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(customerId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = customerEditSchema.safeParse(customerEditFromFormData(formData));
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  const tenantId = ctx.tenantId;
  if (!tenantId) {
    return { formError: "Sesja nie wskazuje najemcy — zaloguj się ponownie." };
  }

  const { email, fullName, phone, companyName, nip, addressStreet, addressZip, addressCity } =
    parsed.data;

  const { data, error } = await ctx.supabase
    .from("customers")
    .update({
      email,
      full_name: fullName,
      phone,
      company_name: companyName,
      nip,
      address_street: addressStreet,
      address_zip: addressZip,
      address_city: addressCity,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id.data)
    .select("id");

  if (error) {
    // Kolizja e-maila w obrębie tenanta: czytelny komunikat przy polu, nie
    // surowy PostgREST. (Indeks jest PER TENANT — nie zdradza cudzych klientów.)
    if (error.code === UNIQUE_VIOLATION) {
      return { fieldErrors: { email: "Inny klient w Twojej wypożyczalni ma już ten adres e-mail." } };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return {
      formError: "Nie udało się zapisać zmian — klient nie istnieje albo nie masz do niego dostępu.",
    };
  }

  // Odśwież RSC: po zapisie karta (i lista) mają pokazać NOWE dane, a nie stan
  // sprzed edycji — inaczej formularz zostaje z wartościami sprzed zapisu mimo
  // komunikatu „zapisano".
  revalidatePath("/", "layout");
  return { success: "saved" };
}

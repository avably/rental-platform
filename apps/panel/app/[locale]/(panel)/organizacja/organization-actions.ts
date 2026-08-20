"use server";

/**
 * Zapis danych organizacji przez WŁAŚCICIELA (U12, ADR-225): nazwa + język.
 *
 * Ścieżka zapisu to RPC `app.update_organization` (SECURITY DEFINER, 0093),
 * NIE bezpośredni UPDATE na `tenants` — członek nie ma tam UPDATE (RLS
 * superadmin_update, 0001), a nade wszystko RLS nie ogranicza KTÓRYCH kolumn
 * wolno ruszyć. Funkcja pisze WYŁĄCZNIE name+locale i bramkuje się właścicielem
 * (42501 dla nie-ownera). Tożsamość tenanta bierze z app.tenant_id(), nie z
 * inputu — cudzej organizacji nie da się wskazać.
 *
 * Bramka roli stoi więc U ŹRÓDŁA (baza). Tu jest defense in depth: requireMember
 * ("owner") czyta ŻYWĄ rolę z members (ADR-127), a nie claim — staff, który
 * ominął ukryty formularz i wysłał POST, dostaje odmowę zanim dojdzie do RPC.
 *
 * Sklejka FormData wyekstrahowana do funkcji CZYSTEJ i pokryta testem (lekcja
 * 8b): pole obecne w schemacie, którego akcja NIE czyta z FormData, ginie cicho.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { withFormEcho, zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import { organizationInputFromFormData, organizationSchema } from "./organization-validation";

/** Odmowa uprawnienia z RPC — ten sam SQLSTATE co RLS/grant (ADR-091). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** Odmowa walidacji z RPC — jedno zdanie dla wszystkich powodów (0076/0077). */
const PG_INVALID_PARAMETER = "22023";

const DENIED = "Zmiana danych organizacji wymaga uprawnień właściciela.";

export async function updateOrganizationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = organizationInputFromFormData(formData);
  const parsed = organizationSchema.safeParse(input);
  if (!parsed.success) return withFormEcho(zodErrorToState(parsed.error), input);

  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) return withFormEcho({ formError: DENIED }, input);
    throw err;
  }

  const { error } = await ctx.supabase.schema("app").rpc("update_organization", {
    p_name: parsed.data.name,
    p_locale: parsed.data.locale,
  });

  if (error) {
    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      return withFormEcho({ formError: DENIED }, input);
    }
    if (error.code === PG_INVALID_PARAMETER) {
      return withFormEcho(
        { formError: "Sprawdź nazwę organizacji i wybrany język." },
        input,
      );
    }
    // Surowa treść dostawcy do logu, na ekran zdanie ogólne (ADR-153:
    // wnętrzności Postgresa nie trafiają do interfejsu).
    console.error(
      "[organizacja:zapis] update_organization",
      JSON.stringify({ code: error.code ?? null, message: error.message ?? null }),
    );
    return withFormEcho({ formError: "Nie udało się zapisać danych organizacji." }, input);
  }

  // locale steruje językiem STOREFRONTU i e-maili SaaS (0005/ADR-037), a nie
  // językiem PANELU — ten wybiera prefiks ścieżki (/pl, /en) per operator.
  // Dlatego NIE wymuszamy przeładowania panelu na inny język; revalidate
  // layout odświeża ekran nowymi wartościami i etykietą języka sklepu.
  revalidatePath("/", "layout");
  return { success: "organization" };
}

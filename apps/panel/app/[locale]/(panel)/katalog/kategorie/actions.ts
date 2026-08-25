"use server";

/**
 * Akcje ekranu kategorii katalogu (ADR-155).
 *
 * ZERO odwzorowania uprawnień w kodzie: prawo do usunięcia kategorii trzyma
 * polityka RLS `tenant_delete` (0072, wyłącznie właściciel), a akcja tłumaczy
 * jej odmowę na zdanie po polsku. Gdyby bramka siedziała tutaj, obchodziłoby
 * ją każde surowe wywołanie API.
 *
 * Slug zarezerwowany odrzuca TRIGGER bazy (22023) — Zod w formularzu jest
 * uprzejmością, nie zabezpieczeniem, i dlatego komunikat bazy idzie wprost.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { categorySchema, uuidSchema } from "@/lib/catalog-validation";
import { withFormEcho, zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

const LIST_PATH = "/katalog/kategorie";

/** 42501 z RLS = „to nie twoja rola", nie „coś się popsuło". */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** 23505 = kolizja unikatu — u nas zawsze slug albo nazwa w obrębie najemcy. */
const PG_UNIQUE_VIOLATION = "23505";
/** 22023 = slug zarezerwowany (trigger catalog_categories_guard). */
const PG_INVALID_PARAMETER = "22023";

const NOT_OWNER = "Kategorie usuwa właściciel organizacji.";
const NOT_FOUND = "Nie znaleziono kategorii.";
const DUPLICATE =
  "Kategoria o tej nazwie lub o tym adresie już istnieje. Zmień jedno z tych pól.";

function databaseError(code: string | undefined, message: string): FormState {
  if (code === PG_INSUFFICIENT_PRIVILEGE) return { formError: NOT_OWNER };
  if (code === PG_UNIQUE_VIOLATION) return { formError: DUPLICATE };
  // Komunikat triggera jest pisany DLA OPERATORA („Adres «checkout» jest
  // zarezerwowany przez sklep") i idzie wprost — podstawienie w to miejsce
  // własnego zdania odebrałoby mu jedyną informację, która pomaga: który adres.
  if (code === PG_INVALID_PARAMETER) return { fieldErrors: { slug: message } };
  return { formError: message };
}

type Ctx = Awaited<ReturnType<typeof requireMember>>;

async function member(): Promise<Ctx | FormState> {
  try {
    return await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
}

function isFormState(value: Ctx | FormState): value is FormState {
  return !("supabase" in value);
}

function readForm(formData: FormData) {
  return categorySchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description"),
  });
}

/** Echo wpisanych wartości — formularz przeżywa pełny obieg dokumentu (U9). */
function echoOf(formData: FormData): Record<string, string> {
  return {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
}

export async function createCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const echo = echoOf(formData);
  const parsed = readForm(formData);
  if (!parsed.success) return withFormEcho(zodErrorToState(parsed.error), echo);

  const ctx = await member();
  if (isFormState(ctx)) return withFormEcho(ctx, echo);

  // Nowa kategoria ląduje NA KOŃCU listy — założenie kategorii nie przestawia
  // kolejności tych, które operator już ustawił. Błąd odczytu NIE jest tu
  // pomijalny: pusty wynik dałby pozycję 0, czyli kategorię na GÓRZE, dokładnie
  // odwrotnie niż obiecuje ta reguła.
  const { data: siblings, error: siblingsError } = await ctx.supabase
    .from("catalog_categories")
    .select("position")
    .eq("tenant_id", ctx.tenantId);
  if (siblingsError) {
    return withFormEcho(databaseError(siblingsError.code, siblingsError.message), echo);
  }
  const position = Math.min(
    9999,
    (siblings ?? []).reduce((max, row) => Math.max(max, (row.position as number) + 1), 0),
  );

  /*
   * ŚWIEŻA KATEGORIA ODDAJE SWÓJ IDENTYFIKATOR, bo operator jedzie PROSTO DO
   * NIEJ (K-16/K-17, audyt UX 2026-08-25). Do tej poprawki zakładanie kończyło
   * się powrotem na LISTĘ — a baner kategorii mieszka wyłącznie w EDYCJI (pole
   * wymaga istniejącego wiersza: bilet i zapis wołają `p_category_id`). Operator
   * zakładał kategorię, chciał wgrać grafikę, wracał na listę bez jednego zdania
   * o tym, gdzie jej szukać, i uznawał, że banera się nie da wgrać. Na tym
   * właśnie rozbił się właściciel.
   *
   * `.single()` NIE jest tu „na wszelki wypadek": bez identyfikatora nie ma
   * dokąd przekierować, a cichy powrót na listę przywróciłby dokładnie tę wadę.
   */
  const { data: created, error } = await ctx.supabase
    .from("catalog_categories")
    .insert({
      tenant_id: ctx.tenantId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      position,
    })
    .select("id")
    .single();
  if (error) return withFormEcho(databaseError(error.code, error.message), echo);
  if (!created) return withFormEcho({ formError: NOT_FOUND }, echo);

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  redirect(await localePath(`${LIST_PATH}/${created.id as string}`));
}

/** Wynik szybkiego tworzenia kategorii z formularza produktu (uwaga właściciela). */
export type InlineCategoryResult =
  | { ok: true; category: { id: string; name: string } }
  | { ok: false; error: string };

/**
 * SZYBKIE UTWORZENIE KATEGORII BEZ OPUSZCZANIA FORMULARZA PRODUKTU (ADR-237).
 *
 * Formularz produktu wybiera kategorie zaznaczeniami, a operator zakładający
 * pierwszy sprzęt nie ma jeszcze żadnej — kazać mu wychodzić do osobnego ekranu
 * i wracać to zgubiony wpis w formularzu. Ta akcja tworzy kategorię z samej
 * NAZWY (adres nadaje `categorySchema` przez `suggestCategorySlug`, dokładnie
 * jak pełny formularz) i ODDAJE jej identyfikator, żeby klient dopisał ją do
 * listy zaznaczeń — bez przeładowania i bez `redirect`.
 *
 * Bramką pozostaje baza (RLS + trigger slugów zarezerwowanych): akcja tłumaczy
 * jej odmowy tym samym `databaseError`, którym tłumaczy je pełny formularz.
 */
export async function createCategoryInlineAction(name: string): Promise<InlineCategoryResult> {
  const parsed = categorySchema.safeParse({ name, slug: "", description: "" });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  const ctx = await member();
  if (isFormState(ctx)) {
    return { ok: false, error: ctx.formError ?? ctx.fieldErrors?.name ?? DUPLICATE };
  }

  // Nowa kategoria NA KOŃCU listy — jak w pełnym formularzu (createCategoryAction);
  // błąd odczytu nie jest pomijalny, bo pusty wynik dałby pozycję 0 (górę).
  const { data: siblings, error: siblingsError } = await ctx.supabase
    .from("catalog_categories")
    .select("position")
    .eq("tenant_id", ctx.tenantId);
  if (siblingsError) {
    const state = databaseError(siblingsError.code, siblingsError.message);
    return { ok: false, error: state.formError ?? state.fieldErrors?.slug ?? siblingsError.message };
  }
  const position = Math.min(
    9999,
    (siblings ?? []).reduce((max, row) => Math.max(max, (row.position as number) + 1), 0),
  );

  const { data, error } = await ctx.supabase
    .from("catalog_categories")
    .insert({
      tenant_id: ctx.tenantId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      position,
    })
    .select("id, name")
    .single();
  if (error) {
    const state = databaseError(error.code, error.message);
    return { ok: false, error: state.formError ?? state.fieldErrors?.slug ?? error.message };
  }
  if (!data) return { ok: false, error: NOT_FOUND };

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — nowa kategoria wchodzi do filtrów
  // publicznego katalogu. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { ok: true, category: { id: data.id as string, name: data.name as string } };
}

export async function updateCategoryAction(
  categoryId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(categoryId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const echo = echoOf(formData);
  const parsed = readForm(formData);
  if (!parsed.success) return withFormEcho(zodErrorToState(parsed.error), echo);

  const ctx = await member();
  if (isFormState(ctx)) return withFormEcho(ctx, echo);

  // .select("id") po mutacji: RLS nie zgłasza błędu przy UPDATE, który nie
  // dosięgnął żadnego wiersza (cudzy najemca / zły id) — pusty wynik to jedyny
  // sygnał, że nic się nie stało, i musi być błędem, nie cichym sukcesem.
  const { data, error } = await ctx.supabase
    .from("catalog_categories")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return withFormEcho(databaseError(error.code, error.message), echo);
  if (!data || data.length === 0) return withFormEcho({ formError: NOT_FOUND }, echo);

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "saved" };
}

/**
 * Usunięcie kategorii. Przypisania znikają KASKADĄ (FK 0072) — produkty
 * zostają, tracą wyłącznie przynależność.
 *
 * Skuteczność mierzymy `.select("id")`, nie brakiem błędu: polityka DELETE dla
 * pracownika odfiltrowuje wiersz BEZ zgłaszania odmowy, więc „nie było błędu"
 * znaczyłoby „usunięto" także wtedy, gdy nic nie zniknęło.
 */
export async function deleteCategoryAction(
  categoryId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(categoryId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data, error } = await ctx.supabase
    .from("catalog_categories")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return databaseError(error.code, error.message);
  if (!data || data.length === 0) return { formError: NOT_OWNER };

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "deleted" };
}

/**
 * Przesunięcie kategorii o jedno miejsce.
 *
 * PRZENUMEROWANIE GĘSTE (0, 1, 2, …) całej listy, a nie zamiana dwóch pozycji
 * — ten sam wybór i to samo uzasadnienie co przy polach własnych (ADR-118):
 * przy REMISIE pozycji zamiana wpisuje obu te same wartości co przedtem,
 * a ekran melduje „przesunięto" i nie przesuwa niczego.
 */
export async function moveCategoryAction(
  categoryId: string,
  direction: "up" | "down",
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(categoryId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data: siblings, error } = await ctx.supabase
    .from("catalog_categories")
    .select("id, position")
    .eq("tenant_id", ctx.tenantId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) return databaseError(error.code, error.message);

  const ordered = siblings ?? [];
  const index = ordered.findIndex((row) => row.id === id.data);
  if (index < 0) return { formError: NOT_FOUND };

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  // Skraj listy to nie błąd — przycisk jest tam i tak wygaszony, a akcja
  // wywołana wprost (surowo) ma po prostu nic nie zrobić.
  if (targetIndex < 0 || targetIndex >= ordered.length) return { success: "moved" };

  const reordered = [...ordered];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved!);

  const writes: Array<[string, number]> = reordered
    .map((row, target): [string, number] => [row.id as string, target])
    .filter(([rowId, target]) => {
      const before = ordered.find((row) => row.id === rowId);
      return (before?.position as number) !== target;
    });

  for (const [rowId, position] of writes) {
    const { data: written, error: writeError } = await ctx.supabase
      .from("catalog_categories")
      .update({ position })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", rowId)
      .select("id");
    if (writeError) return databaseError(writeError.code, writeError.message);
    // Zero wierszy przy braku błędu = polityka UPDATE odfiltrowała zapis.
    // Milczące „przesunięto" byłoby ekranem, który potwierdza czynność,
    // jakiej nie wykonał.
    if (!written || written.length === 0) return { formError: NOT_FOUND };
  }

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "moved" };
}

"use server";

/**
 * Akcje ekranu pól własnych (C6-A1, ADR-118).
 *
 * ZERO odwzorowania uprawnień w kodzie: prawo do zarządzania definicjami
 * trzyma polityka RLS `tenant_insert`/`tenant_update` (0057, wyłącznie
 * właściciel), a akcja tłumaczy jej odmowę (42501) na zdanie po polsku.
 * Gdyby bramka siedziała tutaj, obchodziłoby ją każde surowe wywołanie API.
 *
 * ARCHIWIZACJA, NIE USUNIĘCIE: nie ma tu akcji kasującej i nie może być —
 * `authenticated` nie ma grantu DELETE na tej tabeli.
 */
import { nextCustomFieldPosition } from "@avably/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth";
import { uuidSchema } from "@/lib/catalog-validation";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

import { readDefinitionForm } from "./custom-fields-validation";

const LIST_PATH = "/organizacja/pola-wlasne";

/** 42501 z RLS = „to nie twoja rola", nie „coś się popsuło". */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** 23505 = kolizja unikatu — u nas zawsze etykieta w obrębie encji. */
const PG_UNIQUE_VIOLATION = "23505";
/** 23514 = bramka z 0057: zamrożony typ, zwężone opcje, niezmienna encja. */
const PG_CHECK_VIOLATION = "23514";

const NOT_OWNER = "Polami własnymi zarządza właściciel organizacji.";
const DUPLICATE_LABEL = "Pole o tej nazwie już istnieje dla tego rodzaju danych.";
const TYPE_FROZEN =
  "Tego pola nie da się już przebudować - ma zapisane wartości. Zarchiwizuj je i załóż nowe.";
const NOT_FOUND = "Nie znaleziono pola własnego.";

function databaseError(code: string | undefined, message: string): FormState {
  if (code === PG_INSUFFICIENT_PRIVILEGE) return { formError: NOT_OWNER };
  if (code === PG_UNIQUE_VIOLATION) return { formError: DUPLICATE_LABEL };
  // 23514 ma w 0057 co najmniej OSIEM różnych przyczyn, każdą z własnym
  // zdaniem po polsku (zła lista opcji, zmiana encji, zwężenie listy w użyciu,
  // znaki sterujące w nazwie, długość, zakres pozycji, zamrożony typ).
  // Podstawianie w to miejsce jednego komunikatu o zamrożeniu znaczyło, że
  // operator zmieniający encję pola BEZ wartości dostawał zdanie o zapisanych
  // wartościach — nieprawdziwe i mylące. Komunikaty z bazy są pisane dla
  // operatora, więc idą wprost; stała zostaje wyłącznie jako zabezpieczenie
  // na wypadek odmowy bez treści.
  if (code === PG_CHECK_VIOLATION) return { formError: message.trim() || TYPE_FROZEN };
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

export async function createDefinitionAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = readDefinitionForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  // Nowe pole ląduje NA KOŃCU listy swojej encji — dodanie pola nie
  // przestawia kolejności tych, które operator już opisał.
  //
  // Błąd odczytu NIE JEST tu pomijalny: pusty wynik daje pozycję 0, czyli pole
  // na GÓRZE listy — dokładnie odwrotnie niż obiecuje reguła wyżej. Cicha
  // zamiana „nie wiem" na „na początek" jest gorsza niż odmowa.
  const { data: siblings, error: siblingsError } = await ctx.supabase
    .from("custom_field_definitions")
    .select("position")
    .eq("tenant_id", ctx.tenantId)
    .eq("entity", parsed.data.entity);
  if (siblingsError) return databaseError(siblingsError.code, siblingsError.message);

  const { error } = await ctx.supabase.from("custom_field_definitions").insert({
    tenant_id: ctx.tenantId,
    entity: parsed.data.entity,
    field_type: parsed.data.fieldType,
    label: parsed.data.label,
    help_text: parsed.data.helpText,
    options: parsed.data.options,
    required: parsed.data.required,
    show_in_panel: parsed.data.showInPanel,
    show_in_checkout: parsed.data.showInCheckout,
    show_in_contract: parsed.data.showInContract,
    position: nextCustomFieldPosition((siblings ?? []).map((row) => row.position as number)),
  });
  if (error) return databaseError(error.code, error.message);

  revalidatePath("/", "layout");
  redirect(await localePath(LIST_PATH));
}

export async function updateDefinitionAction(
  definitionId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(definitionId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const parsed = readDefinitionForm(formData);
  if (!parsed.success) return zodErrorToState(parsed.error);

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  // `entity` i `field_type` idą w payloadzie ŚWIADOMIE, mimo że guard bazy
  // odrzuci ich zmianę: formularz ma pokazać odmowę, a nie po cichu pominąć
  // to, co operator wybrał. Cichy filtr byłby ekranem, który mówi
  // „zapisano" i nie zapisał tego, co widać.
  const { data, error } = await ctx.supabase
    .from("custom_field_definitions")
    .update({
      entity: parsed.data.entity,
      field_type: parsed.data.fieldType,
      label: parsed.data.label,
      help_text: parsed.data.helpText,
      options: parsed.data.options,
      required: parsed.data.required,
      show_in_panel: parsed.data.showInPanel,
      show_in_checkout: parsed.data.showInCheckout,
      show_in_contract: parsed.data.showInContract,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return databaseError(error.code, error.message);
  // Pusty wynik przy braku błędu = polityka UPDATE odfiltrowała wiersz
  // (członek bez roli właściciela) albo pola nie ma. Rozróżnienia nie
  // robimy — obie odpowiedzi są dla operatora tym samym.
  if (!data || data.length === 0) return { formError: NOT_OWNER };

  revalidatePath("/", "layout");
  return { success: "saved" };
}

/** Archiwizacja i jej cofnięcie. Usunięcia nie ma i nie będzie (0057). */
export async function toggleArchiveAction(
  definitionId: string,
  archive: boolean,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(definitionId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data, error } = await ctx.supabase
    .from("custom_field_definitions")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .select("id");
  if (error) return databaseError(error.code, error.message);
  if (!data || data.length === 0) return { formError: NOT_OWNER };

  revalidatePath("/", "layout");
  return { success: archive ? "archived" : "restored" };
}

/**
 * Przesunięcie o jedno miejsce.
 *
 * PRZENUMEROWANIE GĘSTE (0, 1, 2, …) docelowej kolejności, a nie zamiana
 * dwóch pozycji. Zamiana wygląda taniej, ale ma dziurę: przy REMISIE pozycji
 * (dwa pola z `position = 0` — po imporcie, po surowym PATCH-u albo po zapisie
 * dwóch właścicieli naraz) zamiana wpisuje obu te same wartości co przedtem,
 * a ekran melduje „przesunięto" i nie przesuwa niczego. Przenumerowanie
 * remisy USUWA, więc każde kolejne kliknięcie działa.
 *
 * Zapisów jest tyle, ile wierszy realnie zmieniło pozycję (typowo dwa).
 * Nie jest to jedna transakcja — a to jest świadoma granica: pozycja jest
 * porządkiem prezentacji, nie danymi rozliczeniowymi, a przerwanie w połowie
 * daje kolejność nieoczekiwaną, nigdy niespójną (i naprawia się samo przy
 * następnym kliknięciu, bo numeracja jest gęsta).
 */
export async function moveDefinitionAction(
  definitionId: string,
  direction: "up" | "down",
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(definitionId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data: current, error: readError } = await ctx.supabase
    .from("custom_field_definitions")
    .select("id, entity, position")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id.data)
    .maybeSingle();
  if (readError) return databaseError(readError.code, readError.message);
  if (!current) return { formError: NOT_FOUND };

  const { data: siblings } = await ctx.supabase
    .from("custom_field_definitions")
    .select("id, position")
    .eq("tenant_id", ctx.tenantId)
    .eq("entity", current.entity as string)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const ordered = siblings ?? [];
  const index = ordered.findIndex((row) => row.id === current.id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  // Skraj listy to nie błąd — przycisk jest tam i tak wygaszony, a akcja
  // wywołana wprost (surowo) ma po prostu nic nie zrobić.
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return { success: "moved" };

  const reordered = [...ordered];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved!);

  // Piszemy WYŁĄCZNIE wiersze, których pozycja realnie się zmienia.
  const writes: Array<[string, number]> = reordered
    .map((row, target): [string, number] => [row.id as string, target])
    .filter(([rowId, target]) => {
      const before = ordered.find((row) => row.id === rowId);
      return (before?.position as number) !== target;
    });

  for (const [rowId, position] of writes) {
    const { data: moved, error } = await ctx.supabase
      .from("custom_field_definitions")
      .update({ position })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", rowId)
      .select("id");
    if (error) return databaseError(error.code, error.message);
    // Zero wierszy przy braku błędu = polityka UPDATE odfiltrowała zapis
    // (członek bez roli właściciela). Milczące „przesunięto" byłoby ekranem,
    // który potwierdza czynność, jakiej nie wykonał — a przy zamianie pozycji
    // dodatkowo groziłoby zapisem POŁOWY operacji.
    if (!moved || moved.length === 0) return { formError: NOT_OWNER };
  }

  revalidatePath("/", "layout");
  return { success: "moved" };
}

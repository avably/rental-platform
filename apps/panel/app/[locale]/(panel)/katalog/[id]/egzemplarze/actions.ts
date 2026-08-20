"use server";

/**
 * ZBIORCZY ZAPIS EGZEMPLARZY (U8b, ADR-146).
 *
 * Do U8b każdy egzemplarz był OSOBNYM formularzem z własnym „Zapisz", własnym
 * „Usuń" i powtórzonym tym samym zdaniem pomocy — przy dwunastu sztukach
 * dwanaście identycznych akapitów i dwanaście osobnych zapisów. Teraz cała
 * tabela jedzie jednym submitem, wzorem edytora progów cenowych
 * (`../progi/actions.ts`).
 *
 * ================== DWIE PUŁAPKI, KTÓRE REFAKTOR MUSIAŁ PRZEŻYĆ ==================
 *
 * 1. DELETE NA `product_units` JEST OWNER-ONLY. Polityka `tenant_delete`
 *    (0007) ma `and app.is_tenant_owner()` — inaczej niż `pricing_tiers`,
 *    gdzie kasuje każdy członek. DELETE spoza uprawnień NIE zgłasza błędu:
 *    dosięga zero wierszy i wygląda jak sukces. `.select("id")` po każdym
 *    usunięciu zamienia to ciche nic w czytelną odmowę — i ten mechanizm
 *    z poprzedniej wersji akcji ZOSTAJE, bo zbiorczy zapis ma dokładnie tę
 *    samą pułapkę, tylko trudniejszą do zauważenia (jedno „Zapisano" nad
 *    całą tabelą łatwo przykryłoby zgubione usunięcie).
 *
 * 2. `order_items_unit_fk` NIE MA `ON DELETE` (0007). Usunięcie egzemplarza
 *    wiszącego na zamówieniu leci błędem 23503, którego poprzedni `mapDbError`
 *    nie znał — operator zobaczyłby surowy komunikat PostgREST o nazwie
 *    więzu. Mapowanie niżej mówi mu, co się stało I co z tym zrobić.
 *
 * ================== KOLEJNOŚĆ I ROZSTRZYGNIĘCIE O CZĘŚCIOWEJ AWARII ==================
 *
 * NAJPIERW zapisy (UPDATE/INSERT), POTEM usunięcia — i nieudane usunięcie
 * NIE cofa zapisów. Uzasadnienie: PostgREST nie daje transakcji (ta sama
 * granica, którą opisuje `../progi/actions.ts`), a jedyną alternatywą byłoby
 * odrzucenie CAŁEJ partii, gdy pracownik bez roli właściciela spróbuje zdjąć
 * jeden egzemplarz. Wtedy kara za brak uprawnienia spadałaby na wszystkie
 * jego poprawki naraz — przepisane numery seryjne, okna serwisowe — i to
 * przy operacji, którą i tak trzeba powtórzyć u właściciela.
 *
 * CENĄ tej decyzji jest obowiązek GŁOŚNEJ odmowy: wynik z nieudanym
 * usunięciem NIGDY nie jest sukcesem. Wraca `formError` wymieniający
 * egzemplarze Z NAZWY i powód, a `revalidatePath` przywraca je do tabeli —
 * operator widzi zarówno komunikat, jak i to, że sprzęt nadal tam stoi.
 * Ciche zgubienie usunięcia jest defektem, nie kompromisem.
 */
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { AuthError } from "@/lib/auth";
import { unitIdsSchema, unitsSchema, uuidSchema } from "@/lib/catalog-validation";
import type { FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

/** Wiersz egzemplarza po walidacji — kształt wspólny dla insertu i update'u. */
type UnitRow = ReturnType<typeof unitsSchema.parse>[number];

function unitPayload(row: UnitRow) {
  return {
    serial_number: row.serialNumber,
    unavailable_from: row.unavailableFrom,
    unavailable_to: row.unavailableTo,
    unavailable_reason: row.unavailableReason,
  };
}

/**
 * Komunikaty bazy, których PostgREST nie umie przełożyć na nic czytelnego.
 *
 * 23505 — częściowy unikat `product_units_serial_key` (ten sam numer seryjny
 * w obrębie produktu). 23503 — `order_items_unit_fk` bez `ON DELETE`:
 * egzemplarz wisi na zamówieniu i baza broni historii przed dziurą.
 */
function mapDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Egzemplarz z tym numerem seryjnym już istnieje dla tego produktu.";
  }
  if (error.code === "23503") {
    return "Egzemplarz jest przypisany do zamówienia - najpierw zdejmij go z tego zamówienia.";
  }
  return error.message;
}

/** Nazwa egzemplarza w komunikacie: numer seryjny albo pozycja w tabeli. */
function unitLabel(serialNumber: string | null, position: number): string {
  const trimmed = serialNumber?.trim();
  return trimmed ? `„${trimmed}”` : `egzemplarz nr ${position} (bez numeru seryjnego)`;
}

/**
 * Błędy Zod z TABELI wierszy → komunikat wskazujący WIERSZ.
 *
 * `zodErrorToState` klucza po `path[0]`, a przy tablicy `path[0]` jest
 * indeksem liczbowym — komunikat wylądowałby w zbiorczym `formError` bez
 * informacji, o którą z dwunastu sztuk chodzi. Numerujemy od 1, bo operator
 * liczy wiersze na ekranie, nie w tablicy.
 */
function unitsErrorToState(error: z.ZodError): FormState {
  const issue = error.issues[0]!;
  const index = typeof issue.path[0] === "number" ? issue.path[0] : null;
  return {
    formError: index === null ? issue.message : `Egzemplarz nr ${index + 1}: ${issue.message}`,
  };
}

export async function saveUnitsAction(
  productId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { formError: id.error.issues[0]!.message };

  const rows = unitsSchema.safeParse(formData.get("units"));
  if (!rows.success) return unitsErrorToState(rows.error);

  const removed = unitIdsSchema.safeParse(formData.get("removedUnitIds"));
  if (!removed.success) return { formError: removed.error.issues[0]!.message };

  const removedIds = [...new Set(removed.data)];
  const keptIds = new Set(
    rows.data.map((row) => row.id).filter((value): value is string => typeof value === "string"),
  );
  // Ten sam egzemplarz w obu listach = błąd klienta, nie decyzja operatora.
  // Zgadywanie intencji („chyba chciał usunąć") kasowałoby sprzęt na domysł.
  if (removedIds.some((removedId) => keptIds.has(removedId))) {
    return { formError: "Ten sam egzemplarz jest jednocześnie zapisywany i usuwany." };
  }

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // Stan sprzed zapisu: daje NAZWY do komunikatów o odmowie (po nieudanym
  // DELETE nie ma czego odczytać) i pozwala odrzucić identyfikatory spoza
  // tego produktu, zanim dotkną bazy.
  const { data: existingData, error: existingError } = await ctx.supabase
    .from("product_units")
    .select("id, serial_number")
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", id.data);
  if (existingError) return { formError: existingError.message };

  const existing = new Map(
    ((existingData ?? []) as { id: string; serial_number: string | null }[]).map((unit) => [
      unit.id,
      unit.serial_number,
    ]),
  );

  // --- 1. ZAPISY -----------------------------------------------------------

  const inserts = rows.data.filter((row) => row.id == null);
  if (inserts.length > 0) {
    const { error } = await ctx.supabase.from("product_units").insert(
      inserts.map((row) => ({
        tenant_id: ctx.tenantId,
        product_id: id.data,
        ...unitPayload(row),
      })),
    );
    if (error) {
      revalidatePath("/", "layout");
      return { formError: mapDbError(error) };
    }
  }

  // UPDATE idzie wierszami, a nie jednym `upsert`: każdy wiersz ma inne
  // wartości, a `upsert` po kluczu głównym WSKRZESIŁBY egzemplarz usunięty
  // w międzyczasie przez kogoś innego (INSERT … ON CONFLICT wstawia, gdy
  // konfliktu nie ma). `.select("id")` odróżnia „zapisano" od „nie było
  // czego zapisać" — RLS przy UPDATE nie zgłasza błędu, tylko nie dosięga
  // wiersza. Egzemplarzy na produkt są dziesiątki, nie tysiące.
  for (const [index, row] of rows.data.entries()) {
    if (row.id == null) continue;
    const { data, error } = await ctx.supabase
      .from("product_units")
      .update(unitPayload(row))
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", id.data)
      .eq("id", row.id)
      .select("id");
    if (error) {
      revalidatePath("/", "layout");
      return { formError: `${unitLabel(row.serialNumber, index + 1)}: ${mapDbError(error)}` };
    }
    if (!data || data.length === 0) {
      revalidatePath("/", "layout");
      return {
        formError: `Nie zapisano zmian dla ${unitLabel(row.serialNumber, index + 1)} - egzemplarz już nie istnieje.`,
      };
    }
  }

  // --- 2. USUNIĘCIA --------------------------------------------------------

  const refusals: string[] = [];
  for (const [index, removedId] of removedIds.entries()) {
    const label = unitLabel(existing.get(removedId) ?? null, index + 1);
    const { data, error } = await ctx.supabase
      .from("product_units")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", id.data)
      .eq("id", removedId)
      .select("id");
    if (error) {
      refusals.push(`${label}: ${mapDbError(error)}`);
      continue;
    }
    if (!data || data.length === 0) {
      // Zero wierszy przy DELETE to ODMOWA RLS (usuwanie wymaga roli
      // właściciela) albo egzemplarz, którego już nie ma. Panel nie zna
      // różnicy — i nie udaje, że zna.
      refusals.push(
        `${label}: nie usunięto - usuwanie egzemplarzy wymaga roli właściciela albo egzemplarz już nie istnieje.`,
      );
    }
  }

  revalidatePath("/", "layout");

  if (refusals.length > 0) {
    return {
      formError: `Zapisano zmiany w danych egzemplarzy, ale NIE usunięto: ${refusals.join(" ")}`,
    };
  }

  return { success: "saved" };
}

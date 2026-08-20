"use server";

/**
 * Zespół tenanta — odczyt listy i USUNIĘCIE członka (L4, ADR-105).
 *
 * Do L4 panel umiał tylko dodawać ludzi do organizacji: polityka RLS
 * `tenant_delete` na `public.members` istniała od 0001_core.sql, ale nie było
 * ani jednej linijki aplikacji, która by z niej korzystała. Odebranie komuś
 * dostępu wymagało wejścia do bazy.
 *
 * Bramka roli jest DWUWARSTWOWA i to nie jest nadmiarowość: `requireMember("owner")`
 * daje czytelny komunikat zamiast surowego błędu PostgREST, a polityki RLS
 * bronią tej samej granicy przed żądaniem, które nasz kod omija. Guard
 * ostatniego ownera siedzi jeszcze niżej — w triggerze bazy (0051), bo
 * i on musi obowiązywać poza aplikacją.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { requireMember } from "@/lib/supabase-server";
import { removeMemberSchema } from "@/lib/validation";

export interface TeamMemberState {
  error?: string;
  success?: string;
  /**
   * Ustawiane, gdy owner usunął SAMEGO SIEBIE — ekran ma wtedy przestać
   * udawać, że użytkownik dalej jest w organizacji.
   */
  selfRemoved?: boolean;
}

/** SQLSTATE guardu ostatniego ownera (0051) — standardowy check_violation. */
const LAST_OWNER_SQLSTATE = "23514";

/**
 * Usunięcie członka z organizacji.
 *
 * Tenant bierze się WYŁĄCZNIE z claimu JWT — formularz niesie sam identyfikator
 * usuwanej osoby, więc nie ma pola, którym dałoby się wskazać cudzą organizację.
 *
 * Odmowa guardu ostatniego ownera (23514 z triggera) wraca jako zdanie po
 * polsku, a nie jako kod błędu bazy: operator ma się dowiedzieć, CO zrobić
 * (najpierw dodaj drugiego właściciela), a nie że coś się wywaliło.
 */
export async function removeMemberAction(
  _prevState: TeamMemberState,
  formData: FormData,
): Promise<TeamMemberState> {
  const parsed = removeMemberSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  const { data: removed, error } = await ctx.supabase
    .from("members")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");

  if (error) {
    if (error.code === LAST_OWNER_SQLSTATE) {
      return {
        error:
          "Organizacja musi mieć co najmniej jednego właściciela. Dodaj drugiego właściciela, " +
          "zanim usuniesz tego.",
      };
    }
    return { error: `Nie udało się usunąć osoby z zespołu: ${error.message}` };
  }
  // Pusty wynik to nie sukces: albo wiersza nie ma, albo RLS go nie dosięgła.
  if (!removed || removed.length === 0) {
    return { error: "Nie znaleziono tej osoby w zespole - odśwież stronę." };
  }

  const selfRemoved = parsed.data.userId === ctx.user.id;
  if (selfRemoved) {
    // Claim `tenant_id` żyje w JWT do wygaśnięcia tokenu (ADR-105 D4), więc
    // sama sesja usuwającego przetrwałaby własne usunięcie. Wylogowanie
    // unieważnia token odświeżający i kończy tę sesję od razu.
    await ctx.supabase.auth.signOut();
  }

  revalidatePath("/", "layout");
  return {
    success: selfRemoved
      ? "Opuszczono organizację. Zaloguj się ponownie, żeby wybrać inną."
      : "Osoba została usunięta z zespołu.",
    ...(selfRemoved ? { selfRemoved: true } : {}),
  };
}

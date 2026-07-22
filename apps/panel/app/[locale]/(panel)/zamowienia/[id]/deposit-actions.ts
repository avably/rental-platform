"use server";

/**
 * Akcje rozliczeń kaucji (Zadanie 5). Wzorzec zamowienia/actions.ts:
 * walidacja Zod PRZED Supabase, guard requireMember (obie role — rejestracja
 * zdarzeń kaucji to praca lady), mutacje klientem z sesją. Bramkami są RLS
 * (0007) i trigger deposit_events_gate + CHECK z 0011 — salda liczone w JS
 * to wygoda UI, autorytatywna odmowa przychodzi z bazy kodem 23514.
 *
 * ADR-027: rozliczenie, które sprowadza saldo do zera przy pobraniach > 0,
 * ustawia payment_status='deposit_refunded' („kaucja rozliczona" —
 * niezależnie od proporcji zwrotów i potrąceń). Bramka spójności tego
 * przejścia stoi w bazie od 0015/0030 (reguła B: saldo 0 przy pobraniach > 0).
 *
 * OBIEG RĘCZNY JEST TU BEZ ZMIAN OD FAZY 1 (ADR-035) i to jest decyzja,
 * nie zaniechanie. Operator, który oddał gotówkę do ręki, REJESTRUJE fakt,
 * przy którym był — nie ma tam żadnego dostawcy, którego można by zapytać
 * o potwierdzenie, i wprowadzanie tam stanu „w toku" byłoby wymyślaniem
 * niepewności, której nie ma. Kaucja online (Z5, ADR-069) dokłada DRUGĄ
 * ścieżkę zwrotu obok tej, a nie zamiast niej.
 */
import { createDepositRefund, readDepositRefund } from "@avably/core";
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { requestDepositRefund } from "@/lib/deposit-refund";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import {
  depositCollectSchema,
  depositDeductSchema,
  depositRefundSchema,
  type DeductionReasonCode,
} from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

import { depositTotals, isDepositSettled, type DepositEventRow } from "./deposit";

/** Kody bramek 0011 — mapowane na komunikaty dla operatora. */
const PG_DEPOSIT_GATE = "23514";
const PG_ORDER_MISSING = "23503";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

interface DepositEventInput {
  orderId: string;
  kind: DepositEventRow["kind"];
  amountGrosze: number;
  reasonCode?: DeductionReasonCode | null;
  reason?: string | null;
}

async function insertDepositEvent(input: DepositEventInput): Promise<FormState> {
  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // `.select("id")` po mutacji: RLS nie zgłasza odmowy, dosięga zero wierszy
  // — pusty wynik musi być błędem, nie cichym sukcesem.
  const { data, error } = await ctx.supabase
    .from("deposit_events")
    .insert({
      tenant_id: ctx.tenantId,
      order_id: input.orderId,
      kind: input.kind,
      amount_grosze: input.amountGrosze,
      reason_code: input.reasonCode ?? null,
      reason: input.reason ?? null,
      created_by: ctx.user.id,
    })
    .select("id");
  if (error) {
    if (error.code === PG_DEPOSIT_GATE) {
      return {
        formError:
          "Rozliczenie przekracza dostępne saldo kaucji — odśwież stronę i spróbuj ponownie.",
      };
    }
    if (error.code === PG_ORDER_MISSING) {
      return { formError: "Zamówienie nie istnieje albo zostało usunięte." };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) {
    return { formError: "Nie udało się zapisać zdarzenia kaucji." };
  }

  // ADR-027: warunek liczony na świeżym odczycie rejestru (nie na danych
  // z formularza) — bramka 0011 gwarantuje, że saldo nie jest ujemne, więc
  // „saldo 0 przy pobraniach > 0" jest jednoznaczne.
  if (input.kind !== "collected") {
    const { data: events, error: eventsError } = await ctx.supabase
      .from("deposit_events")
      .select("kind, amount_grosze")
      .eq("tenant_id", ctx.tenantId)
      .eq("order_id", input.orderId);
    if (!eventsError && events && isDepositSettled(depositTotals(events as Pick<DepositEventRow, "kind" | "amount_grosze">[]))) {
      const { error: statusError } = await ctx.supabase
        .from("orders")
        .update({ payment_status: "deposit_refunded" })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", input.orderId)
        .neq("payment_status", "deposit_refunded");
      if (statusError) {
        // Zdarzenie JEST zapisane — mówimy dokładnie, co się nie udało,
        // zamiast udawać pełny sukces albo pełną porażkę.
        return {
          formError:
            "Zdarzenie kaucji zapisane, ale nie udało się oznaczyć płatności jako rozliczonej — odśwież stronę.",
        };
      }
    }
  }

  revalidatePath("/", "layout");
  return { success: input.kind };
}

export async function collectDepositAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = depositCollectSchema.safeParse({
    orderId: str(formData.get("orderId")),
    amount: str(formData.get("amount")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);
  return insertDepositEvent({
    orderId: parsed.data.orderId,
    kind: "collected",
    amountGrosze: parsed.data.amountGrosze,
  });
}

/**
 * Zwrot pełny i częściowy to jedna akcja: pełny niesie kwotę salda
 * widzianego przez operatora (hidden input — optymistyczna współbieżność
 * jak expectedFrom w zmianie statusu). Jeśli saldo w międzyczasie zmalało,
 * nadmiar autorytatywnie odrzuca trigger 0011.
 *
 * ROZGAŁĘZIENIE NA OBIEG (Z5, ADR-069). Ta sama akcja obsługuje dwa
 * ZUPEŁNIE różne zdarzenia świata:
 *
 *   manual — operator oddał gotówkę i to REJESTRUJE. Wiersz powstaje od
 *            razu, bo pieniądze już zmieniły właściciela,
 *   stripe — operator ZLECA zwrot dostawcy. Wiersz powstaje dopiero po
 *            ODCZYCIE potwierdzającym, a do tego czasu zwrot ma stan
 *            pośredni („zwrot w toku"), który nie udaje żadnego z dwóch
 *            wyników.
 *
 * OBIEG CZYTAMY Z BAZY, NIE Z FORMULARZA. Pole ukryte w przeglądarce jest
 * deklaracją klienta, a od tej jednej wartości zależy, czy w ogóle ruszamy
 * cudze pieniądze — to nie jest rozstrzygnięcie do oddania przeglądarce.
 */
export async function refundDepositAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = depositRefundSchema.safeParse({
    orderId: str(formData.get("orderId")),
    amount: str(formData.get("amount")),
  });
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
    // Sesja bez tenanta nie ma czyjej kaucji zwracać. Jawna odmowa zamiast
    // `!` — na ścieżce ruszającej pieniądze zgadywanie typu jest zbyt tanie.
    return { formError: "Sesja nie wskazuje najemcy — zaloguj się ponownie." };
  }

  const { data: order, error } = await ctx.supabase
    .from("orders")
    .select("payment_provider")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (error || !order) {
    return { formError: "Zamówienie nie istnieje albo zostało usunięte." };
  }

  if ((order as { payment_provider: string }).payment_provider !== "stripe") {
    return insertDepositEvent({
      orderId: parsed.data.orderId,
      kind: "refunded",
      amountGrosze: parsed.data.amountGrosze,
    });
  }

  const outcome = await requestDepositRefund(
    {
      db: ctx.supabase,
      createRefund: (params) => createDepositRefund(params),
      readRefund: (refundId, connectedAccountId) =>
        readDepositRefund(refundId, { connectedAccountId }),
    },
    {
      tenantId,
      orderId: parsed.data.orderId,
      amountGrosze: parsed.data.amountGrosze,
      actorId: ctx.user.id,
    },
  );

  // Odświeżamy WE WSZYSTKICH trzech przypadkach: także zwrot odrzucony
  // zostawia ślad w rejestrze żądań, który operator ma zobaczyć na ekranie.
  revalidatePath("/", "layout");

  if (outcome.status === "settled") return { success: "refunded" };
  // `notice`, nie `formError`: zwrot w toku nie jest porażką i nie wolno
  // zapraszać operatora do ponowienia (patrz FormState.notice).
  if (outcome.status === "pending") return { notice: outcome.reason };
  return { formError: outcome.reason };
}

export async function deductDepositAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = depositDeductSchema.safeParse({
    orderId: str(formData.get("orderId")),
    amount: str(formData.get("amount")),
    reasonCode: str(formData.get("reasonCode")),
    reason: str(formData.get("reason")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);
  return insertDepositEvent({
    orderId: parsed.data.orderId,
    kind: "deducted",
    amountGrosze: parsed.data.amountGrosze,
    reasonCode: parsed.data.reasonCode,
    reason: parsed.data.reason,
  });
}

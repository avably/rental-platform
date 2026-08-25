"use server";

/**
 * Akcje rozliczeń kaucji (Zadanie 5, uproszczenie D7/N5). Wzorzec
 * zamowienia/actions.ts: walidacja Zod PRZED Supabase, guard requireMember
 * (obie role — rozliczenie kaucji to praca lady), mutacje klientem z sesją.
 * Bramkami są RLS (0007) i trigger deposit_events_gate + CHECK z 0011 —
 * salda liczone w JS to wygoda UI, autorytatywna odmowa przychodzi z bazy
 * kodem 23514.
 *
 * ADR-027: rozliczenie, które sprowadza saldo do zera przy pobraniach > 0,
 * ustawia payment_status='deposit_refunded' („kaucja rozliczona" —
 * niezależnie od proporcji zwrotów i potrąceń). Bramka spójności tego
 * przejścia stoi w bazie od 0015/0030 (reguła B: saldo 0 przy pobraniach > 0).
 *
 * ================== CO ZMIENIŁO UPROSZCZENIE (D7/N5) ==================
 *
 * Trzy akcje (pobierz / zwróć / potrąć) zeszły do DWÓCH:
 *
 *   collectDepositAction — WYŁĄCZNIE obieg ręczny. W obiegu dostawcy kaucja
 *     księguje się sama, z tego samego potwierdzonego odczytu, z którego
 *     bierze się `paid` (lib/stripe-webhook.ts) — ręczne pobranie byłoby tam
 *     drugim pobraniem tej samej kaucji w rejestrze,
 *   settleDepositAction — JEDNA decyzja operatora: „ile zatrzymujemy i ile
 *     wraca", czyli potrącenie i zwrot w jednym żądaniu.
 *
 * Rozdział na dwa żądania (najpierw potrącenie, potem zwrot reszty) był nie
 * tylko niewygodny: między nimi mieściła się cała klasa stanów pośrednich,
 * w których potrącenie jest zaksięgowane, a zwrot nie — czyli rejestr mówi
 * „zabraliśmy klientowi kaucję" i nic tego nie prostuje aż do następnego
 * kliknięcia człowieka.
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
import { assertClosableOrder } from "@/lib/closing";
import { settleDepositIfComplete } from "@/lib/deposit-booking";
import { requestDepositRefund } from "@/lib/deposit-refund";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { depositCollectSchema, type DeductionReasonCode } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

import { type DepositEventRow } from "./deposit";
import { depositSettleSchema } from "./deposit-settle";

/** Kody bramek 0011 — mapowane na komunikaty dla operatora. */
const PG_DEPOSIT_GATE = "23514";
const PG_ORDER_MISSING = "23503";
/**
 * 23P01 — bramka 0034 (ADR-072): rejestr pokazuje inne saldo niż to, wobec
 * którego operator podjął decyzję. Przegrana ścieżka dwukliku wychodzi TĘDY,
 * bez ani jednego wiersza w rejestrze.
 *
 * NIE eksportowane, i to nie jest przeoczenie: plik ma dyrektywę `"use server"`,
 * a w takim module KAŻDY eksport musi być funkcją asynchroniczną. Wyeksportowana
 * stała nie wywala pojedynczego importu — unieważnia CAŁY zbiór eksportów modułu
 * („The module has no exports at all"), więc `page.tsx` przestaje widzieć akcje.
 * Typecheck, lint i vitest tego nie łapią; łapie dopiero `next build`.
 */
const PG_STALE_BALANCE = "23P01";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

interface DepositEventInput {
  kind: DepositEventRow["kind"];
  amountGrosze: number;
  reasonCode?: DeductionReasonCode | null;
  reason?: string | null;
  /**
   * Saldo, które wołający ZASTAŁ podejmując tę decyzję (0034, ADR-072).
   * Pomijane wyłącznie tam, gdzie decyzji wobec salda nie było — czyli przy
   * pobraniu, którego bramka i tak nie sprawdza.
   */
  expectedBalanceGrosze?: number | null;
}

/** Komunikat odmowy bazy → zdanie, które operator ma po co przeczytać. */
function gateMessage(code: string | undefined, fallback: string): string {
  if (code === PG_DEPOSIT_GATE) {
    return "Rozliczenie przekracza dostępne saldo kaucji - odśwież stronę i spróbuj ponownie.";
  }
  if (code === PG_ORDER_MISSING) return "Zamówienie nie istnieje albo zostało usunięte.";
  return fallback;
}

/**
 * Wstawia zdarzenia kaucji obiegu RĘCZNEGO JEDNYM poleceniem i domyka oś
 * rozliczenia.
 *
 * DLACZEGO JEDNO POLECENIE, A NIE PĘTLA. Potrącenie i zwrot z jednego modalu
 * to jedna decyzja; wykonane dwoma żądaniami PostgREST mogą rozejść się
 * w połowie (potrącenie przeszło, zwrot odrzucony bramką) i zostawić rejestr
 * w stanie, którego operator nie zamawiał. Tablica wierszy jest dla
 * PostgREST-a JEDNYM `INSERT`-em, czyli jedną transakcją: albo oba wiersze,
 * albo żaden. Bramka 0011 widzi przy tym wiersze wstawione wcześniej TYM SAMYM
 * poleceniem (reguły widoczności triggerów, uzasadnienie w nagłówku 0011),
 * więc suma jest sprawdzana na komplecie, a nie na połowie.
 *
 * DEKLARACJA SALDA (0034, ADR-072) jedzie na KAŻDYM wierszu rozliczenia i jest
 * NARASTAJĄCA — z tej samej reguły widoczności: drugi wiersz pary zastaje
 * saldo pomniejszone już o pierwszy, więc deklaruje właśnie tamto. To ona
 * odbija drugie żądanie dwukliku, którego bramka salda z 0011 przepuszcza,
 * ilekroć obie kopie mieszczą się w pobraniu.
 */
async function insertDepositEvents(
  orderId: string,
  events: readonly DepositEventInput[],
  options?: {
    /**
     * Odmowa POBRANIA na zamówieniu anulowanym (U3, audyt W4): anulowany
     * najem nie ma z czego brać kaucji — pobranie „na zapas" produkowałoby
     * saldo, którego jedynym dalszym losem jest zwrot. Dotyczy WYŁĄCZNIE
     * pobrania; rozliczenie (zwrot/potrącenie trzymanego salda) na
     * anulowanym zamówieniu jest legalne i konieczne — cudze pieniądze
     * nie znają statusu zamówienia.
     */
    refuseCancelledOrder?: boolean;
  },
): Promise<FormState> {
  // Opt-in okna domykania (ADR-138): pobranie ręczne i rozliczenie kaucji
  // to SEDNO całego trybu — cudzych pieniędzy nie wolno zamrozić
  // bezterminowo. Zbiór pilnowany predykatem na argumencie.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
  const tenantId = ctx.tenantId;
  if (!tenantId) {
    return { formError: "Sesja nie wskazuje najemcy - zaloguj się ponownie." };
  }

  if (options?.refuseCancelledOrder) {
    const { data: statusRow } = await ctx.supabase
      .from("orders")
      .select("order_status")
      .eq("tenant_id", tenantId)
      .eq("id", orderId)
      .maybeSingle();
    if (!statusRow) {
      return { formError: "Zamówienie nie istnieje albo zostało usunięte." };
    }
    if ((statusRow as { order_status: string }).order_status === "cancelled") {
      return {
        formError: "Zamówienie jest anulowane - pobranie kaucji nie jest już możliwe.",
      };
    }
  }

  // `.select("id")` po mutacji: RLS nie zgłasza odmowy, dosięga zero wierszy
  // — pusty wynik musi być błędem, nie cichym sukcesem.
  const { data, error } = await ctx.supabase
    .from("deposit_events")
    .insert(
      events.map((event) => ({
        tenant_id: tenantId,
        order_id: orderId,
        kind: event.kind,
        amount_grosze: event.amountGrosze,
        reason_code: event.reasonCode ?? null,
        reason: event.reason ?? null,
        expected_balance_grosze: event.expectedBalanceGrosze ?? null,
        created_by: ctx.user.id,
      })),
    )
    .select("id");

  if (error?.code === PG_STALE_BALANCE) {
    // Rejestr ruszył się pod decyzją — ANI JEDEN wiersz nie wszedł. Błąd
    // wraca przy POLU salda, a nie zbiorczo: to ono jest nieaktualne, a modal
    // ma po czym poznać, że pokazać zdanie o odświeżeniu, nie o kwocie.
    // Revalidate JEST tu potrzebne — ekran pod modalem pokazuje starą liczbę,
    // a operator ma zobaczyć tę, wobec której będzie decydował ponownie.
    revalidatePath("/", "layout");
    return { fieldErrors: { balanceGrosze: error.message } };
  }
  if (error) return { formError: gateMessage(error.code, error.message) };
  if (!data || data.length !== events.length) {
    return { formError: "Nie udało się zapisać zdarzeń kaucji." };
  }

  // ADR-027: warunek liczony na ŚWIEŻYM odczycie rejestru (nie na danych
  // z formularza) — bramka 0011 gwarantuje, że saldo nie jest ujemne, więc
  // „saldo 0 przy pobraniach > 0" jest jednoznaczne. Ta sama funkcja domyka
  // oś w obiegu dostawcy i w webhooku — jedna reguła, trzy wołających.
  if (events.some((event) => event.kind !== "collected")) {
    const settlement = await settleDepositIfComplete(ctx.supabase, tenantId, orderId);
    if (!settlement.ok) {
      // Zdarzenia SĄ zapisane — mówimy dokładnie, co się nie udało, zamiast
      // udawać pełny sukces albo pełną porażkę (ADR-046).
      revalidatePath("/", "layout");
      return {
        formError: `Zdarzenia kaucji zapisane, ale nie udało się oznaczyć płatności jako rozliczonej: ${settlement.reason}`,
      };
    }
  }

  revalidatePath("/", "layout");
  return { success: events[events.length - 1]!.kind };
}

/**
 * Pobranie kaucji — TYLKO obieg ręczny (gotówka, przelew własny).
 *
 * W obiegu dostawcy tej akcji nie ma na ekranie i nie powinno być: kaucja
 * jedzie w tym samym `PaymentIntent` co najem (D1/D4, 0029), więc księguje
 * się sama przy potwierdzeniu płatności — z odnośnikiem intentu, który jest
 * jej dowodem. Ręczny wiersz `manual` dołożony obok podwoiłby saldo
 * i pozwolił zlecić dostawcy zwrot kwoty, której ten nigdy nie pobrał.
 */
export async function collectDepositAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = depositCollectSchema.safeParse({
    orderId: str(formData.get("orderId")),
    amount: str(formData.get("amount")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);
  return insertDepositEvents(
    parsed.data.orderId,
    [{ kind: "collected", amountGrosze: parsed.data.amountGrosze }],
    // U3 (audyt W4): anulowany najem nie pobiera kaucji — patrz opcja.
    { refuseCancelledOrder: true },
  );
}

/**
 * ROZLICZENIE KAUCJI JEDNYM RUCHEM: potrącenie (opcjonalne) i zwrot reszty.
 *
 * ROZGAŁĘZIENIE NA OBIEG (Z5, ADR-069). Ta sama akcja obsługuje dwa
 * ZUPEŁNIE różne zdarzenia świata:
 *
 *   manual — operator oddał gotówkę i to REJESTRUJE. Wiersze powstają od
 *            razu, bo pieniądze już zmieniły właściciela,
 *   stripe — operator ZLECA zwrot dostawcy. Wiersz zwrotu powstaje dopiero
 *            po ODCZYCIE potwierdzającym, a do tego czasu zwrot ma stan
 *            pośredni („zwrot w toku"), który nie udaje żadnego z wyników.
 *
 * OBIEG CZYTAMY Z BAZY, NIE Z FORMULARZA. Pole ukryte w przeglądarce jest
 * deklaracją klienta, a od tej jednej wartości zależy, czy w ogóle ruszamy
 * cudze pieniądze — to nie jest rozstrzygnięcie do oddania przeglądarce.
 *
 * ROZLICZENIE SAMYM POTRĄCENIEM (operator zatrzymuje całą kaucję) nie idzie
 * do dostawcy w ŻADNYM obiegu: nie ma żadnego przelewu do zlecenia, więc obie
 * gałęzie sprowadzają się do wpisu w rejestrze.
 */
export async function settleDepositAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = depositSettleSchema.safeParse({
    orderId: str(formData.get("orderId")),
    balanceGrosze: str(formData.get("balanceGrosze")),
    refundAmount: str(formData.get("refundAmount")),
    deductAmount: str(formData.get("deductAmount")),
    deductReasonCode: str(formData.get("deductReasonCode")),
    deductReason: str(formData.get("deductReason")),
    refundNote: str(formData.get("refundNote")),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);
  const { orderId, balanceGrosze, refundGrosze, deduction, refundNote } = parsed.data;

  // Opt-in okna domykania (ADR-138) — jak w insertDepositEvents: rozliczenie
  // kaucji (także zwrot u dostawcy) MUSI działać w oknie, na zamrożonym zbiorze.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, orderId);
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const tenantId = ctx.tenantId;
  if (!tenantId) {
    // Sesja bez tenanta nie ma czyjej kaucji zwracać. Jawna odmowa zamiast
    // `!` — na ścieżce ruszającej pieniądze zgadywanie typu jest zbyt tanie.
    return { formError: "Sesja nie wskazuje najemcy - zaloguj się ponownie." };
  }

  const { data: order, error } = await ctx.supabase
    .from("orders")
    .select("payment_provider")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    return { formError: "Zamówienie nie istnieje albo zostało usunięte." };
  }
  const online = (order as { payment_provider: string }).payment_provider === "stripe";

  // --- Obieg ręczny ORAZ rozliczenie samym potrąceniem: sam rejestr ---
  //
  // TA GAŁĄŹ JEST TĄ, KTÓREJ 0032 NIE OBEJMUJE. Nie powstaje tu żaden wiersz
  // `deposit_refunds` (bo nie ma o co prosić dostawcy), więc unikat jednego
  // zwrotu w locie nie ma czego serializować, a bramka salda z 0011 przepuszcza
  // dwie kopie tego samego rozliczenia, ilekroć obie mieszczą się w pobraniu.
  // Serializatorem jest deklaracja salda z 0034 (ADR-072), NARASTAJĄCA po
  // wierszach w kolejności, w jakiej widzi je bramka.
  if (!online || refundGrosze === 0) {
    const events: DepositEventInput[] = [];
    let expected = balanceGrosze;
    if (deduction) {
      events.push({
        kind: "deducted",
        amountGrosze: deduction.amountGrosze,
        reasonCode: deduction.reasonCode,
        reason: deduction.reason,
        expectedBalanceGrosze: expected,
      });
      expected -= deduction.amountGrosze;
    }
    if (refundGrosze > 0) {
      events.push({
        kind: "refunded",
        amountGrosze: refundGrosze,
        reason: refundNote,
        expectedBalanceGrosze: expected,
      });
    }
    return insertDepositEvents(orderId, events);
  }

  // --- Obieg dostawcy: potrącenie i zwrot w JEDNEJ sekwencji ---
  //
  // Potrącenie jedzie WEWNĄTRZ requestDepositRefund, za unikatem jednego
  // zwrotu w locie (0032, ADR-070) — inaczej dwuklik zaksięgowałby je dwa
  // razy, a policzony od starego salda zwrot rozbiłby się o bramkę 0011 już
  // po wyjściu pieniędzy. Uzasadnienie: `deduction` w DepositRefundInput.
  //
  // Deklaracja salda (0034) jedzie tu WYŁĄCZNIE na wierszu potrącenia —
  // jedynym, który powstaje ZANIM cokolwiek wyjdzie do klienta. Wiersz zwrotu
  // księguje się po potwierdzonym przelewie i deklaracji nie dostaje: bramka,
  // która odmawia zapisu faktu dokonanego, produkuje stan „pieniądze u klienta,
  // rejestr mówi że nie" (uzasadnienie: nagłówek 0034).
  const outcome = await requestDepositRefund(
    {
      db: ctx.supabase,
      createRefund: (params) => createDepositRefund(params),
      readRefund: (refundId, connectedAccountId) =>
        readDepositRefund(refundId, { connectedAccountId }),
    },
    {
      tenantId,
      orderId,
      amountGrosze: refundGrosze,
      actorId: ctx.user.id,
      deduction,
      expectedBalanceGrosze: balanceGrosze,
      refundNote,
    },
  );

  // Odświeżamy WE WSZYSTKICH trzech przypadkach: także zwrot odrzucony
  // zostawia ślad w rejestrze żądań, który operator ma zobaczyć na ekranie.
  revalidatePath("/", "layout");

  // Potrącenie ZOSTAJE zaksięgowane także wtedy, gdy zwrot padł — jest
  // naszym roszczeniem wobec kaucji, którą już mamy, a nie skutkiem
  // przelewu. Milczenie o tym kazałoby operatorowi wpisać je drugi raz.
  const kept =
    outcome.deductionGrosze > 0 ? "Potrącenie zapisane. " : "";

  if (outcome.status === "settled") return { success: "refunded" };
  // `notice`, nie `formError`: zwrot w toku nie jest porażką i nie wolno
  // zapraszać operatora do ponowienia (patrz FormState.notice).
  if (outcome.status === "pending") return { notice: `${kept}${outcome.reason}` };
  // NIEOKREŚLONA awaria (ADR-269, Finding 2): przelew MÓGŁ wyjść. `notice`, nie
  // `formError` — bo `formError` zaprasza do poprawienia i ponowienia, a tu
  // ponowienie oddałoby kaucję drugi raz. Wiersz żądania został `requested`
  // („w locie”), więc kolejny zwrot i tak odbije się od unikatu 0032 do czasu
  // ręcznego uzgodnienia z dostawcą.
  if (outcome.status === "indeterminate") return { notice: `${kept}${outcome.reason}` };
  // Odmowa bramki 0034 wraca przy POLU salda — tak samo jak na torze rejestru.
  // Żaden przelew tą ścieżką nie wyszedł: potrącenie stoi PRZED `createRefund`,
  // a `kept` jest wtedy z definicji puste.
  if (outcome.staleBalance) return { fieldErrors: { balanceGrosze: outcome.reason } };
  return { formError: `${kept}${outcome.reason}` };
}

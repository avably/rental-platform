/**
 * Decyzja rekoncyliacyjna dla płatności, która utknęła w `pending`
 * (L11, ADR-104). Moduł CZYSTY: zero sieci, zero bazy, zero zegara bez
 * możliwości podmiany — dokładnie jak `webhook.ts`, i z tego samego powodu.
 *
 * ================== PO CO OSOBNA DECYZJA OBOK `settlementVerdict` ==========
 *
 * `settlementVerdict` odpowiada na pytanie „co ten odczyt znaczy dla osi
 * `payment_status`" i jest JEDYNYM tłumaczeniem odczytu na naszą oś — ten
 * moduł go NIE dubluje i nie ma prawa zacząć. Odpowiada na pytanie o jeden
 * krok wcześniejsze: „czy pętla ma w tej chwili w ogóle coś zrobić".
 *
 * Różnica jest konkretna i dotyczy jednego statusu. Dla webhooka
 * `requires_payment_method` znaczy „próba płatności odpadła" — bo webhook
 * dowiaduje się o tym stanie ZDARZENIEM, czyli po próbie, którą dostawca
 * właśnie odrzucił. Pętla nie ma zdarzenia i nie wie, czy próba w ogóle
 * była: `requires_payment_method` to także status ŚWIEŻO ZAŁOŻONEGO
 * intentu, którego klient jeszcze nie dotknął. Gdyby pętla użyła tu
 * werdyktu webhooka wprost, oznaczałaby jako nieudane każde zamówienie,
 * przy którym klient poszedł zrobić kawę między kliknięciem „Zapłać"
 * a wpisaniem numeru karty.
 *
 * Dlatego dla tych stanów pętla CZEKA — i dopiero po progu wygaszenia
 * anuluje płatność u dostawcy, żeby dopiero potem cokolwiek zapisać.
 *
 * ================== WIEK LICZY SIĘ Z ODCZYTU ==================
 *
 * `read.createdAtSeconds` pochodzi z `GET /v1/payment_intents/{id}`, nie
 * z `orders.created_at` ani `updated_at`. To nie jest drobiazg: rekord
 * zamówienia bywa stary, a płatność przy nim — założona przed minutą
 * (klient wrócił po tygodniu i właśnie zaczął płacić). Decyzja oparta na
 * wieku REKORDU wygasiłaby taką płatność w trakcie jej wpisywania. Wiek
 * rekordu rozstrzyga wyłącznie o tym, KIEDY ZAPYTAĆ dostawcę (karencja
 * niżej) — nigdy o tym, co zapisać.
 */
import type { PaymentStatus } from "../rental/order-status";
import { settlementVerdict } from "./webhook";
import type { IntentRead } from "./types";

/**
 * Karencja: płatność młodsza niż kwadrans NIE jest sprawdzana przez pętlę.
 *
 * Webhook jest ścieżką pierwszego wyboru i ma dostać swoją szansę — dostawca
 * ponawia nieudane dostawy przez kilkadziesiąt minut. Pętla bez karencji
 * ścigałaby się z nim o ten sam zapis przy KAŻDEJ płatności, zamiast
 * sprzątać po tych nielicznych, przy których webhook nie dojechał.
 * (Sam wyścig rozstrzygnąłby compare-and-set na statusie, ale bezcelowe
 * odpytywanie dostawcy przy każdym koszyku to koszt bez zysku.)
 */
export const RECONCILIATION_GRACE_SECONDS = 15 * 60;

/**
 * Próg twardego wygaszenia płatności czekającej na akcję klienta.
 *
 * Doba, nie godzina: klient bywa wraca do porzuconego koszyka wieczorem
 * tego samego dnia, a wygaszona płatność wymaga od niego przejścia
 * checkoutu od nowa. Doba jest też granicą, po której `pending` na osi
 * płatności zaczyna realnie kosztować — blokuje operatorowi anulowanie
 * zamówienia, a temu zamówieniu blokuje egzemplarz w kalendarzu.
 */
export const ABANDONED_INTENT_SECONDS = 24 * 60 * 60;

/**
 * Statusy dostawcy, w których piłka jest po stronie KLIENTA, a intent wciąż
 * żyje i da się nim zapłacić.
 *
 * `requires_action` (3-D Secure w toku) świadomie NIE jest na tej liście:
 * tam klient jest w środku uwierzytelnienia u swojego banku, a nieudane
 * uwierzytelnienie i tak przeniesie intent w `requires_payment_method`.
 * Anulowanie płatności w trakcie potwierdzania jej przez bank to najgorszy
 * moment, jaki da się wybrać.
 */
export const CUSTOMER_ACTION_INTENT_STATUSES = [
  "requires_payment_method",
  "requires_confirmation",
] as const;

export function isCustomerActionPending(status: string): boolean {
  return (CUSTOMER_ACTION_INTENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Najmłodszy moment zapisu zamówienia, który pętla jeszcze bierze pod uwagę.
 * Wołający porównuje z nim `orders.updated_at` — czyli chwilę OSTATNIEJ
 * zmiany wiersza, a nie jego narodzin: to zmiana wiązała płatność
 * z zamówieniem (0029) i to od niej liczy się szansa webhooka.
 */
export function reconciliationCutoff(now: Date): Date {
  return new Date(now.getTime() - RECONCILIATION_GRACE_SECONDS * 1000);
}

/**
 * Co pętla ma zrobić z tą płatnością.
 *
 * `expire` NIE jest zapisem stanu — to polecenie „anuluj u dostawcy, potem
 * odczytaj ponownie i dopiero z TAMTEGO odczytu wyprowadź status". Kolejność
 * jest istotą poprawności: zapis `payment_failed` przed anulowaniem zostawia
 * okno, w którym klient płaci sekundę później, a my mamy już zapisaną
 * nieudaną płatność przy pobranych pieniądzach.
 */
export type ReconciliationDecision =
  | { action: "settle"; status: PaymentStatus; reason: string }
  | { action: "expire"; reason: string }
  | { action: "skip"; reason: string };

/**
 * Wyprowadza decyzję WYŁĄCZNIE z odczytu u dostawcy i z zegara.
 *
 * Sygnatura jest częścią bariery — tak jak przy `settlementVerdict`: funkcja
 * nie przyjmuje ani wiersza zamówienia, ani jego dat, więc nie da się przez
 * pomyłkę oprzeć decyzji na wieku rekordu. Dostaje `expectedGrosze` (sumę
 * policzoną przez NASZ serwer), `expectedCurrency` (walutę UTRWALONĄ na
 * zamówieniu — `orders.currency`, 0049/ADR-103, ta sama para, z której
 * intent POWSTAŁ) i `now`. Porównanie waluty wykonuje `settlementVerdict`
 * — jedyne tłumaczenie odczytu na naszą oś; ten moduł go nie dubluje.
 */
export function reconciliationDecision(
  read: IntentRead,
  expectedGrosze: number,
  expectedCurrency: string,
  now: Date,
): ReconciliationDecision {
  if (isCustomerActionPending(read.status)) {
    const ageSeconds = Math.floor(now.getTime() / 1000) - read.createdAtSeconds;

    // Brak wiarygodnego czasu powstania (dostawca nie podał pola) NIE jest
    // podstawą do wygaszenia. `createdAtSeconds === 0` dałoby wiek liczony
    // od 1970 i wygasiłoby KAŻDĄ taką płatność natychmiast — czyli brak
    // dowodu zadziałałby jak dowód najmocniejszy z możliwych.
    if (read.createdAtSeconds <= 0 || ageSeconds < ABANDONED_INTENT_SECONDS) {
      return {
        action: "skip",
        reason: `Płatność w stanie ${read.status} czeka na akcję klienta — próg wygaszenia jeszcze nie minął.`,
      };
    }

    return {
      action: "expire",
      reason: `Płatność w stanie ${read.status} wisi ponad ${Math.floor(ABANDONED_INTENT_SECONDS / 3600)} h — wygaszenie u dostawcy przed zapisem stanu.`,
    };
  }

  // Wszystko poza czekaniem na klienta tłumaczy JEDYNE tłumaczenie, jakie
  // mamy — to samo, którego używa webhook: trzy warunki na `paid`, w tym
  // zgodność WALUTY (K3/ADR-103). Rozjazd waluty daje `null` z powodem —
  // pętla go nie interpretuje, tylko zostawia stan i zapisuje powód.
  const verdict = settlementVerdict(read, expectedGrosze, expectedCurrency);
  if (verdict.status === null) {
    return { action: "skip", reason: verdict.reason };
  }
  return { action: "settle", status: verdict.status, reason: verdict.reason };
}

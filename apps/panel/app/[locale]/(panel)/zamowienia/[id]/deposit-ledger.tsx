/**
 * Chronologia rejestru kaucji (ADR-204).
 *
 * ================== DLACZEGO TO NIE JEST TABELA ==================
 *
 * Ta sama klasa defektu, którą ADR-188 zdjął z przesyłek: prymityw `Table`
 * owija treść w `overflow-x-auto`, więc tabela, która się nie mieści,
 * NIE WYGLĄDA na taką, która się nie mieści — nadmiar chowa się w
 * przewijaniu bez żadnego wizualnego znaku. Rozpychaczem jest tu
 * NIEOGRANICZONY tekst operatora: kolumna `reason` (powód potrącenia) nie
 * ma limitu długości, a operator wkleja w nią protokoły szkody i
 * identyfikatory zgłoszeń serwisowych. Do tego dochodzi odnośnik dowodowy
 * u dostawcy płatności (`provider_reference`, ADR-069) — pojedynczy token
 * bez spacji. Komórka tabeli z `whitespace-nowrap` (prymityw `TableCell`)
 * nie zawija ŻADNEGO z nich, a `table-layout: auto` liczy szerokość od
 * treści — czyli od danych, na które nie mamy wpływu.
 *
 * Stąd te same dwa wnioski co w ADR-188:
 *
 * 1. Progi `md:`/`lg:` są bezużyteczne — reagują na szerokość OKNA, a
 *    problemem jest szerokość KOLUMNY treści (sufit ~752 px niezależnie od
 *    okna). Siatka liczy liczbę torów z faktycznej szerokości rodzica
 *    (`repeat(auto-fit, minmax(min(16rem,100%), 1fr))`).
 * 2. Wiersz zdarzenia kaucji jest KARTĄ: zdarzenie i kwota w nagłówku,
 *    pola (data, saldo) w siatce, powód potrącenia w polu na CAŁĄ
 *    szerokość karty (`col-span-full`) — to zdanie, nie token, więc dostaje
 *    najdłuższą dostępną linię i zawija się w dół, nie w bok.
 *
 * ŻADNA informacja nie znika — karta niesie komplet dawnych pięciu kolumn
 * (data, zdarzenie, kwota, powód, saldo) plus odnośnik obiegu, bez chowania
 * czegokolwiek za rozwinięciem czy przewijaniem. Bardzo długi powód rośnie
 * W DÓŁ (zawijanie), nigdy w bok i nigdy nie jest ucinany: rejestr jest
 * dowodem w sporze z klientem, a dowód przycięty do wielokropka przestaje
 * nim być.
 *
 * Geometrię pilnuje pomiarem `packages/e2e/tests/08-kaucja-w-kolumnie.spec.ts`,
 * kompletność — `apps/panel/test/kaucja-rejestr-kompletnosc.test.tsx`.
 */
import { formatMoney, type CurrencyCode } from "@avably/core";
import { getTranslations } from "next-intl/server";

import type { DepositEventRow } from "./deposit";

/**
 * Pole karty: mikro-etykieta nad wartością, jak w liście przesyłek.
 *
 * `min-w-0` to połowa mechaniki mieszczenia się: bez niego domyślna
 * `min-width: auto` zabrania polu zejść poniżej własnej treści i to ONA
 * zamienia „za wąsko" w „wystaje poza kolumnę". Drugą połową jest
 * `break-words` — dla wartości będących JEDNYM długim słowem (identyfikator
 * wklejony w powód potrącenia nie ma spacji, więc bez łamania rozpychałby
 * kartę).
 */
function DepositField({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Powód potrącenia dostaje CAŁĄ szerokość karty: to proza operatora,
   * nie token — im dłuższa linia, tym mniej rzędów zajmuje. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div data-deposit-field className={wide ? "col-span-full min-w-0" : "min-w-0"}>
      <dt className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

export async function DepositLedger({
  events,
  balances,
  currency,
  locale,
  timestamp,
}: {
  events: DepositEventRow[];
  /** Saldo PO każdym zdarzeniu — indeksy równoległe do `events`
   * (runningBalances w ./deposit). */
  balances: number[];
  /** Waluta ZAMÓWIENIA (0049/ADR-103) — kwoty rejestru mówią nią, a nie
   * bieżącym ustawieniem najemcy. */
  currency: CurrencyCode;
  locale: string;
  timestamp: Intl.DateTimeFormat;
}) {
  const t = await getTranslations("orders.deposit");

  return (
    <ul data-deposit-ledger className="flex min-w-0 flex-col gap-2">
      {events.map((event, index) => (
        <li
          key={event.id}
          data-deposit-event
          data-deposit-kind={event.kind}
          className="border-border bg-card flex min-w-0 flex-col gap-3 rounded-md border px-3.5 py-3"
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[15px] leading-[22px] font-medium">
              {t(`kinds.${event.kind}`)}
            </span>
            {/* Znak niesie kierunek tak samo jak dawna kolumna „Kwota":
                pobranie zwiększa saldo, zwrot i potrącenie je zmniejszają. */}
            <span className="text-[15px] leading-[22px] font-medium tabular-nums tracking-[0.01em]">
              {event.kind === "collected" ? "+" : "−"}
              {formatMoney(event.amount_grosze, currency, locale)}
            </span>
            {/* Odnośnik u dostawcy jest DOWODEM tego wiersza — w sporze
                z klientem to po nim odnajduje się przelew (ADR-069).
                Pokazujemy go, zamiast trzymać wyłącznie w bazie; token bez
                spacji, więc `break-words` jest obowiązkowe. */}
            {event.provider === "stripe" ? (
              <span className="text-muted-foreground min-w-0 text-xs break-words">
                {t("providerOnline")}
                {event.provider_reference ? ` · ${event.provider_reference}` : null}
              </span>
            ) : null}
          </div>

          {/*
            Siatka SAMOROZKŁADAJĄCA SIĘ, bez ani jednego progu `md:`/`lg:`
            (mechanika ADR-188). `auto-fit` liczy liczbę kolumn z FAKTYCZNEJ
            szerokości karty; `min(16rem, 100%)` domyka konstrukcję od dołu:
            przy karcie węższej niż 16 rem tor zwęża się do jej szerokości
            zamiast wystawać.
          */}
          <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-x-6 gap-y-3">
            <DepositField label={t("colDate")}>
              <span className="tabular-nums tracking-[0.01em]">
                {timestamp.format(new Date(event.created_at))}
              </span>
            </DepositField>
            <DepositField label={t("colBalance")}>
              <span className="tabular-nums tracking-[0.01em]">
                {formatMoney(balances[index]!, currency, locale)}
              </span>
            </DepositField>
            <DepositField label={t("colReason")} wide>
              {event.reason_code ? t(`reasonCodes.${event.reason_code}`) : null}
              {event.reason_code && event.reason ? " — " : null}
              {event.reason ?? (event.reason_code ? null : "—")}
            </DepositField>
          </dl>
        </li>
      ))}
    </ul>
  );
}

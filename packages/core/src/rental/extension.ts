/**
 * Wycena przedłużenia najmu (Zadanie 6). Czysta funkcja: dopłata to
 * RÓŻNICA wyceny całego nowego okresu (start..newEndDate) i całego
 * dotychczasowego (start..endDate) — nie „cena dodatkowych dni osobno",
 * bo progi liczą się od długości całego najmu (semantyka calculatePrice).
 *
 * Różnica może wyjść ujemna: monotoniczność progów jest świadomie
 * niewymuszana (ADR-022 — cennik chroni widocznością, nie walidacją),
 * więc dłuższy najem bywa tańszy. Zwracamy uczciwą różnicę; co z nią
 * zrobić, decyduje warstwa wywołująca (panel dopisuje ją do sumy — ADR-029).
 *
 * Kaucja NIE zmienia się przy przedłużeniu — dopłata dotyczy wyłącznie
 * najmu, stąd różnica liczona na rentalGrosze, nigdy na totalGrosze.
 *
 * Skrócenie terminu (newEndDate <= endDate) to jawny błąd: jest poza
 * zakresem Zadania 6 (rozliczenie nadpłaty to inna decyzja produktowa).
 */
import { rentalDaysInclusive, type IsoDate } from "./dates";
import { calculatePrice, type PriceParams } from "./pricing";

export interface ExtensionQuote {
  newEndDate: IsoDate;
  additionalDays: number;
  additionalRentalGrosze: number;
}

export function quoteExtension(
  order: { startDate: IsoDate; endDate: IsoDate },
  newEndDate: IsoDate,
  params: PriceParams,
): ExtensionQuote {
  // rentalDaysInclusive waliduje obie daty (kształt + istnienie w kalendarzu).
  const currentDays = rentalDaysInclusive(order.startDate, order.endDate);
  const newDays = rentalDaysInclusive(order.startDate, newEndDate);

  if (newDays <= currentDays) {
    throw new RangeError(
      `Przedłużenie wymaga daty po obecnym końcu najmu: otrzymano ${newEndDate} przy końcu ${order.endDate}`,
    );
  }

  const current = calculatePrice(order.startDate, order.endDate, params);
  const next = calculatePrice(order.startDate, newEndDate, params);

  return {
    newEndDate,
    additionalDays: newDays - currentDays,
    additionalRentalGrosze: next.rentalGrosze - current.rentalGrosze,
  };
}

"use client";

/**
 * DOSTĘPNOŚĆ NA KAFLU KATALOGU (faza 5, ADR-180).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Katalog nie mówił o dostępności NIC. Klient wybierał termin w powłoce
 * (ADR-179), przeglądał listę i dowiadywał się, czego w tym terminie nie ma,
 * dopiero po wejściu w sprzęt — albo, przy pełnym koszyku, dopiero z panelu
 * konfliktu. Dwa kliknięcia po informację, którą sklep miał już w ręku.
 *
 * ==================== DLACZEGO KONTEKST, A NIE PROPS ====================
 *
 * Kafel rysuje się w CZTERECH miejscach (siatka i lista sekcji strukturalnej,
 * sekcja v1, element katalogu na płótnie v2), a przez każde z nich prowadzi
 * inny łańcuch propsów: renderer → rejestr układów → komponent sekcji → kafel.
 * Przewleczenie liczby tą drogą znaczyłoby cztery nowe parametry w kontrakcie
 * pakietu i cztery miejsca, w których nowy układ sekcji zapomni ją podać —
 * po cichu, bo brak liczby na kaflu niczego nie wywraca.
 *
 * Kontekst odwraca ten koszt: kafel PYTA o liczbę, a odpowiada mu ta
 * powierzchnia, która wie. Brak dostawcy jest stanem legalnym i domyślnym —
 * płótno kreatora ani miniatura szablonu nie mają terminu, więc nie mają też
 * o czym mówić.
 *
 * ==================== BRAK TERMINU TO BRAK INFORMACJI ====================
 *
 * Kafel bez terminu nie pisze „dostępne". Milczy. To jest rozstrzygnięcie,
 * a nie oszczędność: „dostępne" bez terminu jest zdaniem, którego nikt nie
 * sprawdził, a klient odczyta je jako obietnicę. Tak samo milczy pozycja
 * NIEOBECNA w odpowiedzi — brak klucza znaczy „nie wiem", nigdy „zero"
 * (dokładnie ta sama umowa, co przy `dayUnits` kalendarza).
 *
 * ==================== WYŁĄCZNIE LICZBY (ADR-042) ====================
 *
 * Do kafla trafia LICZBA WOLNYCH SZTUK i nic poza nią. Ani kto zarezerwował,
 * ani na kiedy, ani które egzemplarze — te pytania nie mają w tej warstwie
 * odpowiedzi, bo nie ma ich już w odpowiedzi bazy.
 *
 * ==================== ZERO KLAS W TYM PLIKU ====================
 *
 * Klasę podaje WOŁAJĄCY (props `className`), a nie ten moduł, i to jest
 * warunek, pod którym kontrakt ról (`structured-role-usage.test.tsx`) w ogóle
 * ma sens: skanuje on źródła komponentów sekcji, a domknięcie importów sięga
 * wyłącznie ich katalogu. Klasa namalowana TUTAJ byłaby rolą poza skanem —
 * czyli dokładnie tą dziurą, przed którą tamten kontrakt broni. Ta sama
 * zasada, co przy `../links`, `../image-url` i `../site-icons`.
 *
 * ==================== BRAK SZTUK MÓWI SŁOWAMI, NIE KOLOREM ====================
 *
 * Zero i liczba dodatnia dostają tę SAMĄ rolę tekstu, a różnią się treścią.
 * Kolor sygnału błędu byłby na kaflu nową rolą motywu (`dangerText`), której
 * sekcja sprzętu nie deklaruje — a przy okazji jedynym nośnikiem informacji
 * dla kogoś, kto go nie rozróżnia (WCAG 1.4.1).
 */
import { createContext, useContext } from "react";

/** Etykiety i liczby dla kafli — komplet, którego pakiet nie ma skąd wziąć sam. */
export interface SiteProductAvailability {
  /**
   * `product_id` → liczba WOLNYCH sztuk w wybranym terminie. Pozycja
   * nieobecna = brak informacji o niej (kafel milczy), a nie zero.
   */
  units: Readonly<Record<string, number>>;
  /** Etykieta liczby dodatniej; interpolacja `{units}`. */
  available: string;
  /** Etykieta zera — osobna, bo „wolne: 0 szt." czyta się jak usterka. */
  unavailable: string;
}

/**
 * `null` = ta powierzchnia nie zna terminu (płótno kreatora, miniatura,
 * katalog przed wyborem terminu). Kafel milczy.
 */
const SiteProductAvailabilityContext = createContext<SiteProductAvailability | null>(null);

export function SiteProductAvailabilityProvider({
  value,
  children,
}: {
  value: SiteProductAvailability | null;
  children: React.ReactNode;
}) {
  return (
    <SiteProductAvailabilityContext.Provider value={value}>
      {children}
    </SiteProductAvailabilityContext.Provider>
  );
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/**
 * ZNACZNIK DOSTĘPNOŚCI POZYCJI — jedna linia na kaflu albo NIC.
 *
 * Stoi w każdym układzie kafla, żeby dostępność nie zależała od tego, który
 * układ sekcji operator wybrał: klient, który przełączy sekcję z siatki na
 * listę, nie ma prawa stracić informacji o tym, co jest wolne.
 */
export function SiteProductAvailabilityMark({
  productId,
  className,
}: {
  productId: string;
  /** Klasa roli podana przez kafel — patrz „ZERO KLAS" w nagłówku pliku. */
  className?: string;
}) {
  const availability = useContext(SiteProductAvailabilityContext);
  if (availability === null) return null;

  const units = availability.units[productId];
  if (units === undefined) return null;

  return (
    <span
      data-products-availability={productId}
      data-products-availability-units={units}
      className={className}
    >
      {units === 0 ? availability.unavailable : interpolate(availability.available, { units })}
    </span>
  );
}

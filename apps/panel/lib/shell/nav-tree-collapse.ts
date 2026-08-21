/**
 * Stan rozwinięcia gałęzi drzewa nawigacji (akordeon sidebara, ADR-231).
 *
 * BEZ MIGRACJI I BEZ BAZY: „która gałąź rozwinięta" to stan interfejsu jednego
 * urządzenia, więc mieszka w CIASTECZKU, nie w kolumnie tenanta. Ciasteczko,
 * a nie `localStorage`, bo drzewo renderuje SERWER (layout czyta ciasteczko
 * i podaje `expanded` do `SidebarNav`) — render od razu oddaje poprawny stan
 * rozwinięcia, więc gałąź nie mruga zwinięta/rozwinięta przy każdej nawigacji.
 * Ten sam wzorzec co `launch-guide-collapse.ts`; różnica jedna: tu wartością
 * jest ZBIÓR identyfikatorów gałęzi rozwiniętych, nie pojedyncza flaga.
 *
 * Domyślnie (brak ciasteczka) wszystkie gałęzie ZWINIĘTE — poza tą, która
 * zawiera trasę aktywną: tę `SidebarNav` rozwija zawsze (operator widzi, gdzie
 * stoi), niezależnie od zapamiętanego zbioru. Zwięzłość drzewa jest sensem
 * przebudowy, więc pierwsze wejście pokazuje kompaktowe drzewo, a nie płaską
 * listę wszystkiego.
 *
 * Nie jest poświadczeniem — nic wrażliwego, więc `HttpOnly` byłoby tylko
 * przeszkodą (przełącznik zapisuje je z klienta).
 */

export const NAV_TREE_COOKIE = "avably-nav";
export const NAV_TREE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Zbiór rozwiniętych gałęzi z surowej wartości ciasteczka. Format: identyfikatory
 * gałęzi rozdzielone przecinkiem (`"storeSection,settings"`). Puste / brak =
 * zbiór pusty (wszystko zwinięte).
 */
export function expandedBranchesFrom(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

/** Serializacja zbioru do wartości ciasteczka (kolejność bez znaczenia). */
export function serializeExpandedBranches(expanded: Iterable<string>): string {
  return [...new Set(expanded)].join(",");
}

/**
 * Zapis zbioru rozwiniętych gałęzi do ciasteczka (klient). Świadomie w module,
 * nie w komponencie: `SidebarNav` przekazuje przełącznik jako prop do `NavBranch`,
 * a reguła `react-hooks/immutability` nie pozwala mutować `document.cookie` w
 * funkcji, która ucieka poza komponent. Tu, w zwykłym module, mutacja jest
 * legalna (jak odczyt ciasteczka po stronie klienta w `lib/theme.ts`).
 */
export function persistExpandedBranches(expanded: Iterable<string>): void {
  document.cookie = `${NAV_TREE_COOKIE}=${serializeExpandedBranches(expanded)}; path=/; max-age=${NAV_TREE_MAX_AGE_SECONDS}; samesite=lax`;
}

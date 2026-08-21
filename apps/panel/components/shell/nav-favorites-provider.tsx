"use client";

import { createContext, useCallback, useContext, useRef, useState, useTransition } from "react";

import { setNavFavoritesAction } from "@/lib/actions/nav-favorites";
import { knownFavoriteIds } from "@/lib/shell/nav";

/**
 * Stan ULUBIONYCH nawigacji (ADR-232) — WSPÓLNE źródło dla dwóch powierzchni:
 * gwiazdek w drzewie (sidebar/szuflada) i chipów w pasku na górze. Bez wspólnego
 * kontekstu przypięcie gwiazdką nie odświeżyłoby paska (i odwrotnie), bo obie
 * powierzchnie żyją w różnych gałęziach drzewa layoutu.
 *
 * OPTYMISTYCZNIE Z COFNIĘCIEM (wzorzec pigułki terminu / przełącznika
 * organizacji): każdy ruch (przypnij/odepnij/przestaw) NAJPIERW zmienia stan
 * lokalny, a `setNavFavoritesAction` utrwala CAŁĄ nową listę; przy odmowie
 * (`ok:false`) stan wraca do poprzedniego — kontrolka, która po odmowie
 * zostaje w nowej pozycji, kłamie o zapisanym stanie.
 *
 * SSR-SPÓJNE: `initialFavorites` (znane, w kolejności) przychodzi z JEDNEGO
 * fail-silent odczytu layoutu, więc pierwszy render gwiazdek i chipów jest od
 * razu poprawny (zero flash-a, hydracja bez rozjazdu).
 */
export interface NavFavoritesContextValue {
  /** Znane id ulubionych, w kolejności paska. */
  favorites: string[];
  isFavorite: (id: string) => boolean;
  /** Przypnij, jeśli nie ma; odepnij, jeśli jest (dokłada na koniec). */
  toggle: (id: string) => void;
  /** Ustaw nową kolejność (drag&drop w pasku). */
  reorder: (ids: string[]) => void;
  /** Zapis w toku — do wygaszenia kontrolek podczas utrwalania. */
  pending: boolean;
}

// Domyślnie `null`: komponenty renderowane BEZ providera (kontrakty powłoki
// bez ulubionych) widzą brak kontekstu i nie malują gwiazdek — dlatego star
// nie zmienia liczby ikon w suitach, które providera nie stawiają.
const NavFavoritesContext = createContext<NavFavoritesContextValue | null>(null);

/** Kontekst ulubionych albo `null`, gdy powierzchnia stoi poza providerem. */
export function useNavFavorites(): NavFavoritesContextValue | null {
  return useContext(NavFavoritesContext);
}

export function NavFavoritesProvider({
  initialFavorites,
  children,
}: {
  initialFavorites: string[];
  children: React.ReactNode;
}) {
  // Przycinamy do ZNANYCH już na wejściu (layout podaje przefiltrowane, ale
  // provider gwarantuje niezmiennik sam — gwiazdki i pasek zawsze zgodne).
  const [favorites, setFavorites] = useState<string[]>(() => knownFavoriteIds(initialFavorites));
  const [pending, startTransition] = useTransition();
  // Ref trzyma ZAWSZE najświeższą listę, żeby szybkie kolejne ruchy składały
  // się poprawnie (setState jest asynchroniczny, a toggle liczy next z bieżącej).
  const currentRef = useRef<string[]>(favorites);

  const commit = useCallback(
    (next: string[]) => {
      const previous = currentRef.current;
      const cleaned = knownFavoriteIds(next);
      currentRef.current = cleaned;
      setFavorites(cleaned);
      startTransition(async () => {
        const result = await setNavFavoritesAction(cleaned);
        if (!result.ok) {
          currentRef.current = previous;
          setFavorites(previous);
        }
      });
    },
    [],
  );

  const toggle = useCallback(
    (id: string) => {
      const current = currentRef.current;
      const next = current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
      commit(next);
    },
    [commit],
  );

  const reorder = useCallback((ids: string[]) => commit(ids), [commit]);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  return (
    <NavFavoritesContext.Provider
      value={{ favorites, isFavorite, toggle, reorder, pending }}
    >
      {children}
    </NavFavoritesContext.Provider>
  );
}

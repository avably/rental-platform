# Restyling P7 — spójność ekranów i mobile UX panelu

**Data:** 2026-07-21

**Stan bazowy:** `origin/main` `eba9ae3` (P1–P6)

**Zakres:** `apps/panel/**` i dokumentacja; `packages/ui` wyłącznie, gdy istniejące API okaże się niewystarczające

## Cel

P7 domyka różnice widoczne dopiero podczas przechodzenia między ekranami panelu i podczas pracy na telefonie. Każdy ekran ma korzystać z tej samej geometrii treści, jednego tytułu strony w belce, systemowych pól wyboru oraz wspólnej nawigacji mobilnej. Zmiana nie dodaje funkcji domenowych i nie zmienia actions, zapytań ani walidacji.

## Stan zastany

Inwentaryzacja `origin/main` wykazała:

- 17 wystąpień `max-w-*` w grupie `(panel)`, z czego część steruje szerokością całych ekranów (`max-w-sm`, `max-w-lg`, `max-w-2xl`, `max-w-4xl`, `max-w-5xl`, `max-w-6xl`), a część jedynie szerokością formularza lub pola;
- 12 natywnych elementów `<select>` w `(panel)/**`;
- H1 renderowane zarówno przez treść ekranów, jak i komponent `ScreenHeader`, podczas gdy topbar używa zwykłego akapitu;
- `DateRangeField` przekazuje do `Calendar` stałe `numberOfMonths={2}`;
- mobilny shell ma drawer, lecz nie ma stałej nawigacji dolnej, a język i wylogowanie zajmują miejsce w topbarze.

Istniejący `@avably/ui` już udostępnia kompletny Radix `Select` z propem `name` na korzeniu oraz `Calendar` przyjmujący `numberOfMonths`. Projekt nie wymaga więc z założenia zmiany pakietu UI ani nowej zależności.

## Rozważone warianty

### 1. Centralizacja w shellu — wybrany

Layout grupy `(panel)` jest jedynym właścicielem szerokości, paddingu i rezerwy pod mobilny bottom bar. Topbar wyznacza H1 na podstawie trasy. Ekrany zachowują tylko kontekstowe H2, linki powrotu i akcje nad treścią.

Zalety: jedno źródło prawdy, mała powierzchnia regresji, stabilny render serwerowy i kontrakty pilnujące granicy odpowiedzialności. Wada: trzeba konsekwentnie usunąć stare kontenery z wielu ekranów.

### 2. Normalizacja lokalna

Każdy ekran dostałby te same klasy kontenera i własną logikę nagłówka. Diff byłby mechaniczny, lecz reguła nadal byłaby powielona w wielu plikach. Kontrakt wykrywałby odstępstwa, ale nie usuwał ich źródła.

### 3. Dynamiczny topbar przez kontekst klientowy

Ekrany rejestrowałyby w shellu dokładny tytuł i akcje. Pozwalałoby to pokazywać numer zamówienia lub nazwę produktu bezpośrednio w belce, ale wymagałoby dodatkowego stanu klientowego, synchronizacji po nawigacji i obsługi przejściowego tytułu. To zbyt duża złożoność dla pakietu spójności.

## Architektura i komponenty

### Jeden kontener

`apps/panel/app/[locale]/(panel)/layout.tsx` otrzyma pojedynczy kontener treści `mx-auto w-full max-w-6xl` z paddingiem `px-4 py-4 md:px-6 md:py-6`. Maksymalna szerokość obejmuje padding, dzięki czemu wszystkie trasy mają identyczny zewnętrzny prostokąt na desktopie i ten sam odstęp od krawędzi na mobile.

Treść mobilna dostanie dodatkowy padding dolny równy wysokości bottom bara, jego pionowym odstępom oraz `env(safe-area-inset-bottom)`. Desktop od `md` zachowuje obecną geometrię pionową i nie rezerwuje miejsca pod ukryty bar.

Kontenery całych ekranów tracą `mx-auto`, `w-full` i `max-w-*`. Ograniczenia szerokości wewnętrznych formularzy i pojedynczych pól mogą zostać tylko na jawnej whitelistcie kontraktu z komentarzem opisującym, dlaczego nie są kontenerem strony. Preferowany jest brak wyjątków dla plików `page.tsx`; wyjątki dotyczą wyłącznie precyzyjnych elementów formularza, jeśli pełna szerokość pogorszyłaby użyteczność.

### Jeden tytuł strony

`PanelTopbar` renderuje semantyczny `<h1>` zamiast `<p>`. Tytuł pochodzi z istniejącego dopasowania `matchNavItem` i tłumaczeń `nav.*`:

- trasa główna i jej podstrony używają nazwy sekcji, np. `/zamowienia` oraz `/zamowienia/[id]` mają H1 „Zamówienia”;
- dashboard używa etykiety istniejącego placeholdera;
- statyczne trasy spoza nawigacji (`/historia-emaili`, `/organizacja/nowa`, `/bezpieczenstwo/wyzwanie`) są rozwiązywane przez jawny rejestr tytułów tras w `lib/shell/nav.ts` i klucze `nav.*`; nieznana trasa używa `nav.panelNavigation`, więc H1 nigdy nie znika.

Na podstronach numer zamówienia, nazwa produktu lub nazwa operacji pozostają nad treścią jako H2. Na ekranach głównych powtórzony tytuł znika całkowicie. `ScreenHeader` przestaje być źródłem H1; pozostaje właścicielem linku powrotu, kontekstowego H2 i wiersza akcji.

Akcje stron stoją spójnie w pierwszym wierszu treści. Nie są przenoszone do topbara, ponieważ często zależą od danych serwerowych ekranu, a shell nie powinien dostać nowego kanału stanu klientowego.

### Selecty systemowe

Każdy natywny `<select>` w `(panel)/**` zostanie zastąpiony zestawem `Select`, `SelectTrigger`, `SelectValue`, `SelectContent` i `SelectItem` z `@avably/ui`. Korzeń otrzyma identyczne `name`, `defaultValue` albo kontrolowane `value` oraz identyczne wartości elementów jak dotychczas.

Radix Select tworzy ukryty element formularza, gdy podano `name`, dlatego server actions otrzymają ten sam `FormData`. Warunkiem odbioru jest jednak rzeczywisty submit filtra klienta na liście zamówień: wybór musi zmienić parametr `klient`, wysłać formularz i odfiltrować wynik. Otwarta lista musi być treścią Radix, nie systemowym pickerem przeglądarki.

### Mobilny bottom bar

Nowy komponent shella jest widoczny wyłącznie poniżej `md`. Zawiera:

1. Zamówienia — `id: orders`, `/zamowienia`;
2. Katalog — `id: catalog`, `/katalog`;
3. Nowe zamówienie — CTA wykorzystujące `id: orders`, `/zamowienia/nowe`;
4. Menu — przycisk otwierający istniejący drawer, nie pozycja domenowa.

Pozycje domenowe są rozwiązywane przez identyfikatory z `PANEL_NAV_ITEMS`; komponent nie utrzymuje drugiej kopii etykiet sekcji ani luźnych obiektów nawigacji. CTA może zmienić `href` na trasę zagnieżdżoną, ale nadal dziedziczy tożsamość pozycji `orders`. Aktywność używa tego samego `matchNavItem` i `aria-current="page"` co sidebar.

Bar ma `position: fixed`, górny obrys `border-border`, tło tokenowe, brak cienia i padding `env(safe-area-inset-bottom)`. CTA używa limonki wyłącznie z nośnikiem zapewniającym kontrast. Struktura istniejącego `<nav data-panel-nav>` i kontrakt 1 placeholder + 9 pozycji + 3 grupy pozostają nietknięte.

### Mobilny topbar i drawer

Poniżej `md` topbar zawiera wyłącznie hamburger, H1 i `ThemeToggle`. Sygnet, przełącznik języka, e-mail użytkownika i wylogowanie nie zajmują miejsca w belce mobilnej.

Drawer dostaje dolną sekcję oddzieloną obrysem. Sekcja zawiera `LocaleSwitcher` oraz ten sam formularz POST `logoutAction`; logika wylogowania nie zmienia się. Na desktopie topbar nadal pokazuje e-mail, język, motyw i wylogowanie.

Bottom bar i hamburger otwierają ten sam kontrolowany `Sheet`. Istniejący `MobileNav` pozostaje jedynym właścicielem stanu `open` i renderuje oba przyciski otwarcia oraz bottom bar; przycisk Menu wywołuje `setOpen(true)`. Nie powstaje drugi drawer, globalne zdarzenie ani nowy kontekst aplikacji.

### Responsywny kalendarz

`DateRangeField` wylicza liczbę miesięcy przez hook oparty na `window.matchMedia("(min-width: 768px)")` i przekazuje ją jako prop `numberOfMonths`:

- poniżej `md`: 1;
- od `md`: 2, czyli stan obecny desktopu.

Hook musi mieć stabilny snapshot serwerowy i poprawnie reagować na zmianę szerokości. Drugi miesiąc nie jest renderowany na mobile, a nie tylko ukryty klasą CSS. `Calendar` w `@avably/ui` nie wymaga rozszerzenia.

## Przepływ danych i błędy

P7 nie zmienia actions, zapytań, walidatorów ani kształtu `FormData`. Wszystkie selecty zachowują nazwy i wartości, pola dat zachowują dwa ukryte stringi ISO, a bottom bar używa istniejącego routera i istniejącej definicji nawigacji.

Brak dopasowania trasy nie może usunąć H1: topbar zawsze renderuje bezpieczną etykietę shella. Brak JavaScriptu nie może zmienić kontraktu wysyłki formularza po stronie serwera; Radix wymaga JavaScriptu do interakcji, ale ukryte pole formularza pozostaje jedynym transportem wartości po wyborze.

## Kontrakty i weryfikacja

### Testy automatyczne

- skan wszystkich plików `(panel)/**` zakazuje tekstu `<select`;
- skan plików ekranów zakazuje `max-w-*` poza precyzyjną whitelistą elementów wewnętrznych;
- test renderu tras nawigacji wymaga dokładnie jednego H1;
- test bottom bara sprawdza, że każdy użyty identyfikator domenowy istnieje w `PANEL_NAV_ITEMS`, CTA wskazuje zagnieżdżoną trasę orders, a Menu pozostaje kontrolką;
- test responsywnego pola dat sprawdza przekazanie 1 miesiąca dla mobile i 2 dla desktopu;
- istniejące kontrakty sidebara, aktywnej pozycji, shella, dat, katalogu i zamówień pozostają zielone.

### Mutacje po commicie

Każda mutacja musi dać niepusty `git diff --stat`, czerwony test z czytelnym komunikatem, a następnie zostać przywrócona:

1. wstawienie natywnego `<select>` w dowolnym ekranie;
2. dodanie drugiego H1 do ekranu;
3. dodanie lokalnego `max-w-*` do pliku ekranu;
4. dodanie bottom-bar itemu z identyfikatorem spoza `PANEL_NAV_ITEMS`.

### Dowody przeglądarkowe

Na porcie 3048, z osobnym seedem `p7-`:

- 390 px, light i dark: lista zamówień z bottom barem, poprawne `aria-current`, otwarty drawer z językiem i wylogowaniem, kalendarz jednego miesiąca, otwarty Radix Select oraz dokładnie jeden H1;
- 1440 px: wszystkie trasy nawigacji mają identyczny computed width kontenera, desktopowy topbar bez regresji i kalendarz dwóch miesięcy;
- tabela raportu zawiera szerokości przed/po oraz computed `width`, `max-width`, paddingi, pozycję bottom bara, górny obrys i safe-area;
- konsola pozostaje czysta poza znanym blokowaniem chunków `loading.tsx` przez CSP w trybie deweloperskim.

## Dokumentacja i granice

Ten sam PR dodaje ADR-060, aktualizuje sekcję modułu panelu i dopisuje wpis na górze dziennika budowy. ADR opisze standard kontenera, semantykę H1, zakaz natywnych selectów, decyzję o akcjach nad treścią, bottom bar jako rozszerzenie zamówione poza artefaktem oraz responsywny kalendarz.

Poza zakresem pozostają migracje, nowe zależności, zmiany logiki domenowej, storefront, `packages/pdf`, poprawianie znanego artefaktu CSP oraz przebudowa prymitywów UI, jeśli istniejące API spełni kontrakt.

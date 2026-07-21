# Avably — system wdrożeniowy, faza 2

**Data:** 2026-07-20  
**Status:** projekt zatwierdzony w rozmowie; specyfikacja do przeglądu użytkownika  
**Kierunek:** wyłącznie „Sygnał operacyjny”  
**Zakres:** samowystarczalny artefakt referencyjny, tokeny, znaki, ekrany i motion; bez zmiany produkcyjnego panelu i bez backendu dashboardu

## 1. Cel

Przekształcić wybrany kierunek z fazy 1 w egzekwowalny system wizualny, który
da się bezpośrednio przenieść do Next.js, Tailwind CSS v4 i shadcn/ui. Wynik ma
pokazać system na realistycznych ekranach produktu, a nie tylko jako planszę
próbek. Ma również rozwiązać wykryty w fazie 1 problem niewystarczającego
kontrastu limonki.

Faza 2 nie wdraża jeszcze nowego wyglądu do aplikacji. Dostarcza kompletny,
działający offline dokument referencyjny oraz kod tokenów i SVG gotowy do
późniejszego przeniesienia. Nie powstaje backend dashboardu ani fałszywe dane
analityczne.

## 2. Decyzje wiążące i nadrzędność ustaleń

- Wraca wyłącznie „Sygnał operacyjny”. „Papier roboczy” i „Czarna rama” nie
  występują nawet jako porównanie ani wariant poboczny.
- Rytm prezentacji pozostaje: biel → prawie czerń → limonkowa bramka.
- Zatwierdzone logo z fazy 1 jest zamrożone: litery `#0B1017`, promień kropki
  `15 px`, kropka cięższa i przesunięta o `0.5 px` w górę, grupa znaku
  skorygowana optycznie o `2 px` w lewo. Nie wolno ponownie zmieniać krzywych,
  kerningu ani proporcji kapsuły.
- Safiro Medium pozostaje próbką marki. Do czasu dostarczenia pełnej rodziny
  brakujące wagi komunikacji marketingowej obsługuje Manrope. Nie wolno
  deklarować Manrope jako Safiro ani syntetyzować pogrubień lub kursywy.
- Ustalenie użytkownika z rozmowy zastępuje pierwotny zapis briefu:
  **Geist Mono nie jest używany nigdzie**. Cały panel, sklep publiczny, dane,
  identyfikatory, kwoty i daty korzystają z Geist Sans.
- Dashboard może istnieć w przyszłości, lecz obecnie nie ma backendu. Faza 2
  pokazuje uczciwy placeholder bez KPI. Domyślnym wejściem pozostaje lista
  zamówień.
- Empty state oraz 404 mogą być bardziej dowcipne i zaskakujące niż reszta
  systemu. Humor nie wchodzi do błędów płatności, bezpieczeństwa, utraty danych
  ani operacji destrukcyjnych.
- Zaokrąglenia korzystają z wariantu „Operator”: bardziej miękkie niż w fazie
  1, nadal wyglądające jak narzędzie pracy.

## 3. Artefakty

Implementacja tej specyfikacji tworzy:

1. `docs/branding/2026-07-20-avably-faza-2-system.html` — jeden plik HTML,
   wszystkie style, fonty, SVG i ewentualne sterowanie osadzone lokalnie;
   zero żądań sieciowych.
2. `scripts/verify-branding-phase2.mjs` — kontrakt sprawdzający zawartość,
   dostępność, wartości i samowystarczalność dokumentu.
3. Kartę prowadzącą do fazy 2 w `docs/dokumentacja/hub.html`.

Nie wolno w tej fazie modyfikować `apps/panel`, `apps/storefront` ani
`packages/ui`. Kod tokenów i znaków jest prezentowany w artefakcie jako
kopiowalny materiał wdrożeniowy.

## 4. Fundament wizualny

### 4.1. Paleta bazowa

Siedem zatwierdzonych wartości pozostaje bez zmian:

| Rola | HEX | Zastosowanie |
|---|---|---|
| `canvas` | `#F4F6F5` | tło robocze jasnego panelu |
| `surface` | `#FFFFFF` | karty, tabele, popovery |
| `ink` | `#0B1017` | tekst, główna akcja, ciemne nośniki |
| `muted` | `#55616D` | tekst drugorzędny |
| `border` | `#7E8994` | granice i kontrolki wymagające `3:1` |
| `lime` | `#EAFFA4` | sygnał marki na nośniku |
| `dot` | `#A8C743` | wyłącznie kropka w zatwierdzonych znakach marki |

Dodatkowy kolor systemowy:

| Rola | HEX | Kontrast na bieli | Kontrast na canvas | Kontrast na lime |
|---|---|---:|---:|---:|
| `signal-strong` | `#5F7500` | `5.21:1` | `4.80:1` | `4.80:1` |

`signal-strong` służy wyłącznie małym znacznikom bez tekstu, które muszą być
widoczne samodzielnie: znacznikowi zaznaczonego wiersza i małej ikonie
sygnałowej. Nie zastępuje bazowej limonki w logo i dużych polach marki.

### 4.2. System nośników limonki

Limonka `#EAFFA4` ma `1.09:1` na bieli i około `1.00:1` na canvas, dlatego nie
może sama oznaczać stanu na tych powierzchniach. Obowiązuje jedna reguła dla
całego systemu:

1. **Pole z tekstem:** limonkowe wypełnienie zawsze ma tekst lub ikonę w
   `#0B1017` (`17.57:1`) oraz obrys `#0B1017`, jeżeli granica pola niesie
   znaczenie.
2. **Mały znacznik bez tekstu:** używa `signal-strong #5F7500`, nigdy bazowej
   limonki.
3. **Focus na jasnym tle:** semantyczną granicą jest wewnętrzny pierścień
   `2 px #0B1017`; limonkowy halo `3 px` jest dodatkowym sygnałem marki.
4. **Focus na ciemnym tle:** limonka może być samodzielnym pierścieniem, bo
   ma `17.57:1` na `#0B1017`.
5. **Główna akcja w jasnym motywie:** tło `#0B1017`, tekst `#FFFFFF`
   (`19.08:1`). Limonka nie jest jasnym primary buttonem na bieli.
6. **Główna akcja w ciemnym motywie:** tło `#EAFFA4`, tekst `#0B1017`
   (`17.57:1`). Tutaj powierzchnia limonkowa ma wystarczający kontrast z tłem.
7. `dot #A8C743` może wystąpić tylko wewnątrz zatwierdzonego znaku marki:
   pełnego logotypu, sygnetu lub faviconu `24 px` i większego. Nigdy nie
   występuje samodzielnie i nie oznacza statusu, zaznaczenia, sukcesu ani
   dostępności.

### 4.3. Kolory funkcjonalne

Jasne chipsy statusów:

| Ton | Tło | Tekst i obrys | Kontrast tekstu na tle |
|---|---|---|---:|
| neutralny | `#EDF0EE` | `#3F4A54` | `7.89:1` |
| uwaga | `#FFF3D6` | `#8A5A00` | `5.37:1` |
| pozytywnie zamknięty | `#E6F6EC` | `#17643A` | `6.42:1` |
| problem | `#FCE9E6` | `#A93226` | `5.66:1` |

Ciemne chipsy statusów:

| Ton | Tło | Tekst | Obrys | Kontrast tekstu na tle |
|---|---|---|---|---:|
| neutralny | `#202A33` | `#D5DADD` | `#7E8994` | `10.35:1` |
| uwaga | `#3A2C10` | `#FFD37A` | `#D79A2B` | `9.60:1` |
| pozytywnie zamknięty | `#133323` | `#8DE0B0` | `#4FAE77` | `8.80:1` |
| problem | `#3A1E1B` | `#FFAEA4` | `#E06A5E` | `8.57:1` |

Destructive nie korzysta z zieleni, ikony potwierdzenia ani copy typu
„gotowe”. Zawsze ma czerwony ton, czasownik opisujący skutek i — przy skutku
nieodwracalnym — osobne potwierdzenie.

### 4.4. Wykresy

W artefakcie wykresy występują tylko jako demonstracja przyszłego systemu i
placeholder dashboardu. Nie przedstawiają faktycznych danych produktu.

Jasny motyw: `#0067A5`, `#A85C00`, `#007C6B`, `#7A5195`, `#B23A48`. Każdy
kolor ma co najmniej `5.00:1` na bieli z wyjątkiem tych o jeszcze wyższym
kontraście; wszystkie przekraczają `3:1` jako linie lub słupki.

Ciemny motyw: `#4DB4FF`, `#FFB85C`, `#43C9AD`, `#C493E0`, `#FF7F8C`.
Najniższy kontrast na `#111820` przekracza `7.3:1`.

Paleta miesza błękit, pomarańcz, teal, fiolet i róż/czerwień oraz różnicuje
jasność. Weryfikacja obejmuje symulację protanopii i deuteranopii; serie mają
dodatkowo różne dash patterns lub markery, więc kolor nie jest jedynym
rozróżnieniem.

## 5. Tokeny shadcn/Tailwind v4

Artefakt pokazuje dwa kompletne bloki `:root` i `.dark`. Każda wartość jest
zapisana w OKLCH, a komentarz na tej samej linii zawiera odpowiadający jej
HEX. OKLCH należy wyliczyć programowo z poniższych wartości sRGB — nie wolno
wpisywać ręcznych przybliżeń.

### 5.1. Mapa jasnego motywu

| Tokeny | HEX |
|---|---|
| `--background` | `#F4F6F5` |
| `--foreground` | `#0B1017` |
| `--card`, `--popover` | `#FFFFFF` |
| `--card-foreground`, `--popover-foreground` | `#0B1017` |
| `--primary` | `#0B1017` |
| `--primary-foreground` | `#FFFFFF` |
| `--secondary` | `#E7EBE8` |
| `--secondary-foreground` | `#0B1017` |
| `--muted` | `#E9ECEA` |
| `--muted-foreground` | `#55616D` |
| `--accent` | `#EAFFA4` |
| `--accent-foreground` | `#0B1017` |
| `--destructive` | `#A93226` |
| `--destructive-foreground` | `#FFFFFF` |
| `--border`, `--input` | `#7E8994` |
| `--ring` | `#0B1017` |
| `--chart-1` | `#0067A5` |
| `--chart-2` | `#A85C00` |
| `--chart-3` | `#007C6B` |
| `--chart-4` | `#7A5195` |
| `--chart-5` | `#B23A48` |
| `--sidebar` | `#FFFFFF` |
| `--sidebar-foreground` | `#0B1017` |
| `--sidebar-primary` | `#0B1017` |
| `--sidebar-primary-foreground` | `#FFFFFF` |
| `--sidebar-accent` | `#EAFFA4` |
| `--sidebar-accent-foreground` | `#0B1017` |
| `--sidebar-border` | `#7E8994` |
| `--sidebar-ring` | `#0B1017` |

Komponent korzystający z `--accent` na jasnym tle musi dodać ciemny obrys,
tekst albo znacznik zgodnie z systemem nośników. Sam token tła nie jest
semantyką.

### 5.2. Mapa ciemnego motywu

| Tokeny | HEX |
|---|---|
| `--background` | `#0B1017` |
| `--foreground` | `#F4F6F5` |
| `--card`, `--popover`, `--sidebar` | `#111820` |
| `--card-foreground`, `--popover-foreground`, `--sidebar-foreground` | `#F4F6F5` |
| `--primary` | `#EAFFA4` |
| `--primary-foreground` | `#0B1017` |
| `--secondary`, `--muted` | `#1A232C` |
| `--secondary-foreground` | `#F4F6F5` |
| `--muted-foreground` | `#B8C0C5` |
| `--accent`, `--sidebar-accent` | `#263016` |
| `--accent-foreground`, `--sidebar-accent-foreground` | `#EAFFA4` |
| `--destructive` | `#FF8A7A` |
| `--destructive-foreground` | `#0B1017` |
| `--border`, `--input` | `#7E8994` |
| `--ring` | `#EAFFA4` |
| `--chart-1` | `#4DB4FF` |
| `--chart-2` | `#FFB85C` |
| `--chart-3` | `#43C9AD` |
| `--chart-4` | `#C493E0` |
| `--chart-5` | `#FF7F8C` |
| `--sidebar-primary` | `#EAFFA4` |
| `--sidebar-primary-foreground` | `#0B1017` |
| `--sidebar-border` | `#7E8994` |
| `--sidebar-ring` | `#EAFFA4` |

`--accent #263016` jest w ciemnym motywie wyłącznie subtelnym tłem. Aktywna
pozycja nawigacji dodaje `2 px` limonkowego znacznika i `aria-current`, a
zaznaczony wiersz dodaje ten sam widoczny znacznik. Tło o niskim kontraście
nie może samodzielnie oznaczać stanu.

### 5.3. Promienie

| Token | Wartość | Użycie |
|---|---:|---|
| `--radius` | `1rem` / `16 px` | baza systemu |
| `--radius-sm` | `0.625rem` / `10 px` | chipsy, małe elementy |
| `--radius-md` | `0.75rem` / `12 px` | pola, przyciski, filtry |
| `--radius-lg` | `1rem` / `16 px` | karty, tabela jako powierzchnia |
| `--radius-xl` | `1.25rem` / `20 px` | dialogi i duże warstwy |

Wiersze tabeli nie stają się osobnymi kapsułami. Zaokrąglona jest zewnętrzna
powierzchnia tabeli; wnętrze zachowuje rytm siatki.

## 6. Typografia

### 6.1. Granice rodzin

- Safiro Medium 500: wyłącznie marketing Avably, demonstracja znaku i duże
  nagłówki brandowe.
- Manrope 400/600/700: tymczasowe uzupełnienie brakujących wag komunikacji
  marketingowej. Każde użycie w próbniku jest podpisane prawdziwą rodziną.
- Geist Sans 400/500/600: cały panel, publiczny sklep, tabele, formularze,
  etykiety, numery, kody, daty i kwoty.
- Geist Mono: zakaz użycia, importu i deklaracji `font-family`.
- Dane w Geist Sans używają `font-variant-numeric: tabular-nums`; numery
  zamówień mogą dostać wagę 500 i tracking `0.01em`, ale nie krój mono.
- Publiczny sklep nie ładuje Safiro ani Manrope nawet wtedy, gdy te fonty są
  osadzone globalnie w dokumencie referencyjnym. Kontrakt sprawdza font w
  obrębie makiety sklepu, nie tylko obecność fontów w pliku.

### 6.2. Skala

| Stopień | Rodzina / waga | Rozmiar / line-height | Tracking | Użycie |
|---|---|---|---|---|
| Brand display XL | Safiro 500 | `64/68 px` | `-0.03em` | hero marketingowy |
| Brand display L | Safiro 500 | `48/52 px` | `-0.025em` | sekcje brandowe |
| Marketing title | Manrope 700 | `36/42 px` | `-0.02em` | brakująca cięższa waga |
| Product page | Geist Sans 600 | `28/34 px` | `-0.02em` | tytuł ekranu |
| Product section | Geist Sans 600 | `20/26 px` | `-0.01em` | nagłówek sekcji |
| Body | Geist Sans 400 | `15/22 px` | `0` | główna treść |
| Body small | Geist Sans 400 | `14/20 px` | `0` | opisy i tabela |
| Table emphasis | Geist Sans 500 | `14/20 px` | `0` | klient, kwota, status |
| Data | Geist Sans 500 | `14/20 px` | `0.01em` | ID, daty, kwoty; cyfry tabelaryczne |
| Label | Geist Sans 500 | `13/18 px` | `0` | etykiety formularzy |
| Micro label | Geist Sans 600 | `11/14 px` | `0.08em` | wersaliki nad wartością |
| Button | Geist Sans 600 | `14/20 px` | `0` | kontrolki |

Na ekranie `390 px` display skaluje się płynnie, lecz żadna treść panelu nie
spada poniżej `13 px`.

## 7. Odstępy i gęstość

Skala odstępów: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px`.

- Wiersz gęstej tabeli: `52 px` minimum, bez pionowego paddingu udającego
  kartę.
- Odstęp między chipsami dwóch osi: `8 px`.
- Sekcja detalu: `24–32 px` między grupami; pary etykieta–wartość używają
  `6–8 px` wewnątrz.
- Pole formularza: `44 px` minimum wysokości, label `8 px` nad polem.
- Karta: `20–24 px` paddingu; dialog i duża warstwa: `24–32 px`.
- Sidebar: grupy oddzielone `20–24 px`, pozycje nawigacji `40 px` minimum.

## 8. Architektura panelu

### 8.1. Nawigacja i wejście

Lista zamówień pozostaje ekranem startowym. Sidebar zawiera dziewięć realnych
pozycji, pogrupowanych funkcjonalnie: Zamówienia, Katalog, Strona sklepu,
Domeny, E-maile, Dostawy, Zespół, Organizacja, Bezpieczeństwo.

Artefakt dodaje ponad nimi pozycję „Dashboard” z etykietą `Wkrótce`. Jest to
placeholder przyszłej funkcji, nie dziesiąty działający moduł. Może prowadzić
do ekranu placeholdera, ale nie staje się domyślnym wejściem.

Aktywna pozycja na jasnym tle używa limonkowego tła, tekstu `ink` i
obowiązkowego lewego znacznika `2 px signal-strong`. Znacznik ma `4.80:1` na
limonce i pozostaje widoczny bez tekstu. Sama limonka nigdy nie jest jedyną
informacją o aktywności.

### 8.2. Lista zamówień

To ekran rozstrzygający. Pokazuje minimum 12 realistycznych wierszy i kolumny:

- identyfikator `ZAM/2026/0714`;
- klient;
- sprzęt budowlany lub eventowy;
- termin dzienny;
- kwota w złotych;
- status zamówienia;
- status płatności;
- opcjonalne wejście do akcji wiersza.

Nagłówek tabeli jest przyklejony, filtry są zwarte, a kwoty i daty korzystają
z cyfr tabelarycznych Geist Sans. W jednym wierszu widać dwie osie statusu.
Wysyłka pojawia się jako trzecia oś tylko w kontekście dostawy lub detalu.

Na mobile tabela pozostaje tabelą i przewija się poziomo wewnątrz własnej
powierzchni. Strona jako całość nie może przekraczać viewportu.

### 8.3. Szczegół zamówienia

Detal jest przestronniejszy niż lista. Lewa kolumna zawiera pozycje, historię
i dane klienta. Boczna kolumna zawiera płatność, kaucję, dostawę oraz działania.
Wartości są prezentowane jako mikroetykieta wersalikowa nad wartością, nie jako
osobna tabela dla każdego zestawu.

### 8.4. Formularz produktu

Etykieta znajduje się nad polem. Pole ma delikatne tło canvas i cienki obrys
`border`, dzięki czemu granica nadal przekracza `3:1`. Focus korzysta z
ciemnego pierścienia i limonkowego halo. Stan błędu ma czerwony obrys, ikonę i
konkretny komunikat pod polem. Pokazane są również hover, disabled, loading i
stan poprawny bez polegania na zielonej kropce.

### 8.5. Placeholder dashboardu

Ekran używa copy:

- tytuł: `Tu będzie centrum dowodzenia.`;
- opis: `Dashboard czeka na dane. Do tego czasu najwięcej dzieje się w zamówieniach.`;
- CTA: `Przejdź do zamówień`.

Może zawierać zaokrąglone szkielety jednego wykresu liniowego i jednego
słupkowego, lecz bez liczb, trendów, procentów i nazw metryk sugerujących
istniejący backend.

### 8.6. Empty, loading i 404

Empty state zamówień używa copy `Podejrzanie spokojnie. Dodaj pierwsze
zamówienie.` oraz jednego primary CTA `Dodaj zamówienie`. Może mieć link
drugorzędny do katalogu.

404 używa copy `Ta strona wyjechała bez protokołu wydania.` oraz CTA
`Wróć do zamówień`.

Oba ekrany mogą wykorzystać jednorazową choreografię pełnego logo. Kropka
może na moment przesunąć się w obrębie znaku, lecz nie staje się osobną ikoną
statusu. Loading zachowuje finalną geometrię i nie skacze po załadowaniu.

### 8.7. Publiczny sklep

Makieta sklepu ma własny, spokojniejszy charakter klienta i korzysta wyłącznie
z Geist Sans. Nie występują w niej Safiro, Manrope ani elementy wewnętrznej
nawigacji panelu. Zachowuje dostępne komponenty rezerwacji, ale nie udaje
konkretnej marki klienta ani nie wymyśla faktów o wypożyczalni.

### 8.8. Dark mode

Ciemna lista zamówień używa neutralnej niemal czerni, nie granatowej ramy.
Zachowuje tę samą gęstość, kolejność danych i dwa chipsy statusu. Nie jest
osobnym kierunkiem wizualnym, tylko równoważnym trybem tego samego systemu.

## 9. Statusy

Kolor koduje cztery znaczenia, a konkretną wartość zawsze niesie tekst na
chipsie. Osie rozróżnia pozycja i podpis kolumny, nie dodatkowy kolor.

### 9.1. Mapowanie

| Oś | Wartość | Ton |
|---|---|---|
| zamówienie | `pending` | uwaga |
| zamówienie | `reserved` | neutralny |
| zamówienie | `ready_for_pickup` | uwaga |
| zamówienie | `picked_up` | neutralny |
| zamówienie | `returned` | pozytywnie zamknięty |
| zamówienie | `cancelled` | problem |
| płatność | `unpaid` | uwaga |
| płatność | `pending` | neutralny |
| płatność | `paid` | pozytywnie zamknięty |
| płatność | `manual` | uwaga |
| płatność | `completed` | pozytywnie zamknięty |
| płatność | `deposit_refunded` | pozytywnie zamknięty |
| płatność | `refunded` | neutralny |
| płatność | `cancelled` | problem |
| przesyłka | `created` | neutralny |
| przesyłka | `in_progress` | neutralny |
| przesyłka | `in_transit` | neutralny |
| przesyłka | `delivered` | pozytywnie zamknięty |
| przesyłka | `cancelled` | problem |
| przesyłka | `returned_to_sender` | problem |

Chip ma wysokość `28–30 px`, promień `10 px`, obrys `1 px`, tekst Geist Sans
500 i padding poziomy `10 px`. Nie używa pełnego pill radius. Długie etykiety
nie są skracane do niezrozumiałych ikon.

## 10. System znaku

### 10.1. Logotyp

Pełny logotyp pozostaje dokładnie zatwierdzonym wariantem z fazy 1. Artefakt
pokazuje go na bieli, canvas, prawie czarnym tle i w limonkowej bramce.

### 10.2. Sygnet

Sygnet jest skrótem zatwierdzonego znaku, nie nowym logo: wykorzystuje
oryginalny kontur litery `A` z wordmarku oraz kropkę, zamknięte w krótszej
limonkowej kapsule. Nie wolno rysować nowej litery ani zmieniać kształtu
kropki. Wariant mono korzysta z jednej barwy i negatywu.

### 10.3. Favicon

- `24 px` i większy: uproszczony sygnet `kropka + A`.
- `16 px`: wariant zastępczy bez osobnej kropki — ciemne pole z negatywowym
  `A`. Zapobiega zniknięciu kropki po rasteryzacji i odbarwieniu.
- Artefakt pokazuje podgląd `16 px`, `24 px`, grayscale i oba motywy.

### 10.4. Reguły

- Minimalna szerokość pełnego logo w interfejsie: `120 px`.
- Minimalny rozmiar sygnetu: `24 px`; poniżej obowiązuje favicon fallback.
- Pole ochronne pełnego logo: co najmniej jedna średnica kropki z każdej
  strony kapsuły.
- Dozwolone tła: biel, canvas, `ink` i spokojne neutralne fotografie wyłącznie
  pod warunkiem zachowania kontrastu całej kapsuły.
- Każdy wariant jest pokazany jako kopiowalny, samodzielny kod SVG.

## 11. System ruchu

| Rola | Czas | Zastosowanie |
|---|---:|---|
| fast | `160 ms` | hover i press |
| UI | `240 ms` | focus, active, rozwinięcie |
| confirmation | `320–480 ms` | zapis i jednorazowa zmiana statusu |
| reveal | `600–720 ms` | wejście ekranu lub sekcji |
| delight | `700–1200 ms` | empty, 404, dashboard placeholder |
| logo | `6000 ms` | demonstracja pełnego znaku |
| ad | `8000 ms` | reklama social |
| ambient rail | `16000 ms` | jedyny ciągły ruch LP |

- UI nie ma ciągłego pulsowania, pływających kart ani animowanych błędów.
- Landing zachowuje jeden ciągły, liniowy rail danych. Pozostałe elementy
  wykonują jednorazowy reveal.
- Reklamy `1:1` i `4:5` mają ośmiosekundową sekwencję oraz czytelny statyczny
  plateau między `72%` i `92%`.
- Empty, 404 i placeholder dashboardu mogą być bardziej ekspresyjne, ale
  animują się raz i nie blokują CTA.
- `prefers-reduced-motion: reduce` pokazuje kompletny stan końcowy bez pętli i
  bez uciętej treści.
- Hover oraz `focus-within` pauzują pętle demonstracyjne. Ukryta lub poza
  viewportem animacja nie powinna zużywać zasobów.
- Ruch korzysta głównie z `opacity`, `transform` i kontrolowanego `clip-path`.
  Nie używa blur, sprężynowania, parallaxu ani przewijania sterowanego ruchem.

## 12. Struktura strony HTML

Dokument ma wyglądać jak działający produkt i płynnie przejść przez:

1. białe otwarcie z zatwierdzonym logo, zakresem i kluczową regułą nośników;
2. fundamenty: paleta, kontrast, typografia, odstępy i promienie;
3. znaki, favicony, warianty mono i kopiowalne SVG;
4. placeholder dashboardu;
5. jasną listę co najmniej 12 zamówień;
6. szczegół zamówienia;
7. formularz produktu z focus i błędem;
8. loading, empty i 404;
9. publiczny sklep w Geist Sans;
10. ciemną listę zamówień;
11. czarną sekcję motion z panelem, landingiem i reklamami social;
12. limonkową bramkę z tokenami, kontraktami i twardymi zakazami.

Wszystkie dane demonstracyjne są po polsku: złotówki, daty dzienne,
identyfikatory `ZAM/2026/####`, sprzęt budowlany i eventowy. Nie pojawiają się
opinie klientów, liczby wdrożeń, nagrody, konkurenci, misja, archetyp ani
fabularna opowieść o marce.

## 13. Stany komponentów

Każdy kluczowy komponent pokazuje co najmniej: default, hover, focus, active,
disabled, loading oraz błąd, jeśli błąd ma sens dla komponentu.

- Primary button: ink/white w jasnym motywie, lime/ink w ciemnym.
- Secondary: neutralne tło, ink/foreground i obrys `border`.
- Destructive: jawny czerwony ton, czasownik opisujący skutek, brak zielonego
  potwierdzenia.
- Input: canvas fill, cienki border, ciemny focus ring i lime halo.
- Selected row: w jasnym motywie subtelne limonkowe tło z `signal-strong`, a w
  ciemnym `#263016` z limonkowym markerem; w obu przypadkach marker jest
  samodzielnie widocznym nośnikiem.
- Active filter: lime fill, ink text/icon i ink border.
- Skeleton: geometria odpowiada finalnym elementom; reduced motion bez shimmer.

## 14. Twarde zakazy

1. `#EAFFA4` nie może samodzielnie oznaczać aktywnego stanu na `#FFFFFF` ani
   `#F4F6F5`; wymagany jest ink carrier albo `signal-strong`.
2. `#A8C743` nie może występować poza zatwierdzonym pełnym logo, sygnetem lub
   faviconem `24 px` i większym; nie może być statusem, wskaźnikiem sukcesu,
   kontrolką ani znacznikiem zaznaczenia.
3. W produkcie i publicznym sklepie nie wolno używać Geist Mono, Safiro ani
   Manrope; obowiązuje Geist Sans.
4. Nie wolno używać gradientów, glassmorphismu, blur, cieni unoszących karty
   ani ilustracji 3D.
5. Status nie może być samą kolorową kropką lub ikoną; musi zawierać tekst
   konkretnej wartości.
6. Nie wolno pokazywać dashboardowych KPI, trendów ani procentów bez danych z
   backendu. Placeholder pozostaje jawnie placeholderem.
7. Poza rail LP i demonstracyjną reklamą nie wolno dodawać nieskończonej
   animacji. Każda dopuszczona pętla ma pauzę po hover/focus i statyczny
   odpowiednik reduced-motion.

## 15. Kontrast i dostępność

Artefakt zawiera tabelę każdej realnie użytej pary foreground/background oraz
każdego obrysu względem sąsiadującego tła. Wartości są liczone z faktycznych
kolorów CSS, nie wpisywane jako dekoracyjny tekst.

- zwykły tekst: minimum `4.5:1`;
- duży tekst: minimum `3:1`;
- obrys, focus, znacznik i granica kontrolki: minimum `3:1`;
- informacja nigdy nie zależy wyłącznie od koloru;
- wszystkie interaktywne elementy są osiągalne klawiaturą i mają widoczny
  focus;
- dokument zachowuje logiczną strukturę nagłówków i landmarków;
- SVG mają właściwe `aria-label` albo są jawnie dekoracyjne;
- motion respektuje ustawienia systemowe i nie ukrywa treści.

Para niespełniająca progu blokuje odbiór artefaktu; nie może zostać jedynie
opisana jako wyjątek. Wyłączenie znaku firmowego z WCAG dotyczy tylko samego
logo, nie sygnetu użytego jako interaktywna kontrolka.

## 16. Weryfikacja i kryteria odbioru

### 16.1. Kontrakt automatyczny

Verifier sprawdza co najmniej:

- jeden offline HTML, brak zewnętrznych `http`, zewnętrznych fontów i assetów;
- obecność wszystkich wymaganych tokenów w `:root` i `.dark`, z OKLCH i
  komentarzem HEX;
- dokładną obecność siedmiu kolorów bazowych bez podmiany;
- brak `@font-face` i deklaracji `font-family` dla Geist Mono oraz brak
  Safiro/Manrope w subtree publicznego sklepu; sam tekst zakazu może wymieniać
  nazwę nieużywanej rodziny;
- minimum 12 bezpośrednich wierszy tabeli oraz status zamówienia i status
  płatności w każdym z tych wierszy;
- 6 statusów zamówienia, 8 płatności i 6 wysyłki w macierzy referencyjnej;
- dashboard bez liczb KPI i jawnie oznaczony jako przyszły;
- komplet znaków i kopiowalnych bloków SVG;
- dokładne promienie `10/12/16/20 px` i wszystkie wymagane stany;
- wyliczone kontrasty z faktycznych wartości oraz brak par poniżej progu;
- reduced motion, pauzę klawiaturową i brak nieautoryzowanych pętli;
- siedem twardych zakazów oraz właściwy rytm sekcji.

### 16.2. QA wizualne

- szerokości `390`, `1024` i `1440 px`;
- brak poziomego overflow strony; tabela przewija się tylko we własnej ramie;
- poprawne fonty i brak syntetycznych wag;
- czytelność faviconu w `16 px` i grayscale;
- jasna oraz ciemna lista mają identyczną hierarchię i gęstość;
- statusy pozostają rozróżnialne w protanopii, deuteranopii i grayscale;
- focus jest widoczny na każdym tle;
- wersja reduced-motion zachowuje kompletny, nieucięty układ;
- empty/404 pozostają zabawne, lecz CTA jest natychmiast czytelne.

### 16.3. Testy repozytorium

Po implementacji muszą przejść: verifier fazy 2 w trybie pełnym i
artifact-only, kontrola składni skryptu, `git diff --check` oraz istniejący
zestaw testów repozytorium. Integracje wymagające zewnętrznych usług mogą być
jawnie pominięte zgodnie z obecną konwencją projektu; nie wolno ukrywać innych
niepowodzeń.

## 17. Definicja ukończenia

Faza 2 jest ukończona dopiero wtedy, gdy:

1. artefakt wygląda jak jeden spójny produkt, nie katalog luźnych próbek;
2. lista 12 zamówień działa jako ekran rozstrzygający w obu motywach;
3. każdy semantyczny sygnał limonkowy ma policzony, widoczny nośnik;
4. panel, dane i sklep używają wyłącznie Geist Sans;
5. placeholder dashboardu nie udaje istniejącej analityki;
6. empty i 404 dostarczają kontrolowanego zaskoczenia bez naruszania
   dostępności;
7. tokeny, statusy, SVG, kontrasty i motion są kopiowalne oraz egzekwowalne;
8. automatyczne testy, wizualne breakpointy i niezależny review nie zgłaszają
   problemów Critical ani Important.

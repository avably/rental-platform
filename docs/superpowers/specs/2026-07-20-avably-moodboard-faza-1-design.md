# Avably — moodboard wdrożeniowy, faza 1

**Data:** 2026-07-20
**Status:** zatwierdzony kierunek do implementacji fazy 1, rozszerzony o LP, social media i motion
**Zakres:** jeden samodzielny plik HTML; przekrojowy branding z ruchem, bez tokenów i ekranów fazy 2

## 1. Cel

Przygotować jedną stronę porównawczą, która pozwoli wybrać systemową rolę
limonki i ciemnego koloru w całym brandingu Avably. Strona ma porównywać trzy
realne decyzje projektowe na identycznym materiale: w interfejsie, na landing
page i w postach social media, a nie trzy odcienie tej samej palety. Każdy
kierunek pokazuje również spójny, delikatny język animacji.

Po oddaniu strony praca zatrzymuje się. Tokeny produkcyjne, kompletny system
znaku oraz ekrany produktu należą do fazy 2 i nie powstają przed wyborem
jednego wariantu przez właściciela produktu.

## 2. Materiał wejściowy i decyzje wiążące

- Logo źródłowe: `/Users/godekmaciej/Desktop/Frame 2610196.svg`, format
  `348 × 93`, tło `#EAFFA4`, kropka `#A8C743`, litery `#122035`.
- Próbka Safiro: prawdziwy Safiro Medium w formacie WOFF2, deklarowany
  wyłącznie jako waga 500. Nie wolno rozszerzać zakresu tej odmiany na inne
  wagi ani używać syntetycznego pogrubienia lub kursywy.
- Brakujące wagi marki pokazuje Manrope na licencji OFL 1.1: 400, 600 i 700.
  Każda próbka ma być podpisana jako zamiennik, a nie jako Safiro.
- W realnych elementach interfejsu nagłówek marki korzysta wyłącznie z
  Safiro Medium 500. Manrope służy w fazie 1 do porównania brakujących wag,
  nie do mieszania rodzin w jednym nagłówku.
- Geist Sans obsługuje treść, etykiety, tabele i kontrolki. Geist Mono
  obsługuje identyfikatory, daty, liczby i kwoty.
- Kolor tekstu i ramy ma wyglądać jak czerń. Kolorem fazy 1 jest niemal
  czarny, neutralnie granatowy `#0B1017`, nie obecny `#122035`.
  Jego kontrast wynosi `17.57:1` na `#EAFFA4`, `19.08:1` na bieli i `9.92:1`
  na `#A8C743`.
- Produkt i dokument są dwujęzyczne docelowo, lecz moodboard jest po polsku.
  Próbki uwzględnią co najmniej jeden dłuższy tekst, aby nie optymalizować
  układu tylko pod krótkie etykiety.

## 3. Trzy kierunki

### 3.1. Sygnał operacyjny — rekomendowany

Jasna, chłodna i prawie achromatyczna baza. Limonka występuje tylko jako
sygnał: główna akcja, widoczny focus, aktywny filtr lub wąski znacznik
zaznaczonego wiersza. Powierzchnie tabel pozostają białe, a statusy inne niż
akcja marki używają neutralnych obrysów lub osobnych kolorów semantycznych.

- **Zysk:** najwyższa skanowalność gęstych tabel i najmniejsze zmęczenie przy
  wielogodzinnej pracy.
- **Koszt:** marka jest najbardziej dyskretna poza nagłówkami i nawigacją.

### 3.2. Papier roboczy

Ciepła, złamana biel tworzy tło dokumentowe. Limonka może pojawić się jako
ograniczone pole w nagłówku modułu, krótkim komunikacie albo etykiecie, ale
nigdy pod akapitem i nigdy jako tło całej strony. Tabela nadal ma neutralną,
jasną powierzchnię.

- **Zysk:** mniej techniczny, spokojniejszy pierwszy kontakt bez ozdobności.
- **Koszt:** mniejsza ostrość podziału powierzchni; granice tabel wymagają
  staranniejszej kontroli kontrastu.

### 3.3. Czarna rama

Niemal czarny kolor buduje stałą ramę nawigacji i nagłówka, a obszar roboczy
pozostaje jasny. Limonka jest wskaźnikiem aktywnej sekcji, focusu i głównej
akcji, nie dużym tłem treści.

- **Zysk:** najsilniejsza rozpoznawalność oraz wyraźna orientacja w panelu.
- **Koszt:** największy ciężar wizualny; rama nie może wejść do gęstej części
  roboczej ani zmniejszyć powierzchni danych.

## 4. Struktura strony HTML

Docelowy artefakt:
`docs/branding/2026-07-20-avably-faza-1-moodboard.html`.

Plik ma zawierać, w tej kolejności:

1. Krótki nagłówek techniczny z nazwą fazy, zakresem i logo wejściowym.
2. Porównanie logo przed i po subtelnej korekcie.
3. Trzy kierunki ustawione obok siebie na szerokim ekranie i jeden pod drugim
   na wąskim ekranie.
4. W każdym kierunku: nazwa, decyzja, zysk, koszt, pasek palety, wartości HEX,
   próbka nagłówka oraz ten sam wiersz zamówienia.
5. Sekcję „Branding w użyciu” z osobną, pełnowymiarową planszą dla każdego
   kierunku. Każda plansza zawiera tę samą makietę hero LP, kwadratowy post
   social `1:1` oraz pionowy post `4:5`; zastosowania są animowane na żywo.
6. Sekcję „Motion system” z zasadą ruchu logotypu, czasami, easingiem,
   mikrointerakcjami UI, sekwencją LP i storyboardem animowanych reklam.
7. Wspólną próbkę typografii: nagłówek, akapit, małą tabelę oraz zestaw wag
   Manrope 400 / Safiro Medium 500 / Manrope 600 / Manrope 700 z jawnym
   podpisem rodzin.
8. Zestawienie kontrastów wszystkich par tekst–tło i obrys–tło faktycznie
   użytych na stronie.
9. Sekcję „Czego tu nie ma i dlaczego”.
10. Jednozdaniową instrukcję wyboru wariantu i wyraźną informację, że faza 2
   nie została rozpoczęta.

Każdy kierunek pokazuje identyczne dane demonstracyjne. Dzięki temu różnica
wynika z systemu wizualnego, nie z atrakcyjniejszej treści lub innej gęstości.
Dane są podpisane jako demonstracyjne i korzystają wyłącznie z pól już
obecnych w produkcie: klient, sprzęt, termin, kwota i status. Wspólny wiersz
ma wartości: `ZAM/2026/0714`, `Anna Kowalska`, `Nagrzewnica 20 kW`,
`20–22.07.2026`, `1 199,00 zł`, `Do wydania`.

### 4.1. Zastosowania brandingu na LP i w social media

Porównanie kanałów nie zostaje ściśnięte do trzech małych kart. Po syntetycznym
porównaniu kierunków pojawiają się trzy poziome plansze, po jednej dla każdego
kierunku. Na szerokim ekranie makieta LP zajmuje około `60%` planszy, a dwa
formaty social pozostałe `40%`. Poniżej `980 px` wszystkie trzy zastosowania
układają się pionowo.

Każda plansza pokazuje identyczną treść i hierarchię. Nie zmieniają się copy,
liczba elementów, proporcje ani dane demonstracyjne. Zmieniają się wyłącznie
role koloru, konstrukcja powierzchni, rytm typograficzny i sposób prowadzenia
oka właściwy dla danego kierunku.

Makieta landing page ma proporcję `16:10` i jest podpisana jako podgląd pola
`1440 × 900 px`. Zawiera logo, prostą nawigację, CTA oraz fragment panelu z tym
samym demonstracyjnym zamówieniem. Copy jest oparte wyłącznie na funkcjach
oznaczonych jako działające w aktualnym materiale sprzedażowym:

- nadtytuł: `System dla wypożyczalni sprzętu`;
- nagłówek: `Prowadź wynajem. Przyjmuj rezerwacje online.`;
- treść: `Rezerwacje, dostępność sprzętu, kaucje, kurier i e-maile w jednym
  panelu. Do tego własna strona sklepu z rezerwacją online — bez instalacji i
  bez informatyka.`;
- informacja cenowa: `199 zł miesięcznie`;
- główne CTA: `Zapisz się na listę oczekujących`;
- drugie CTA: `Zobacz, jak działa`.

Pierwszy post ma proporcję `1:1` i podpis `1080 × 1080 px`. Pokazuje produktową
obietnicę kontroli dostępności:

- nagłówek: `Jeden egzemplarz. Jeden termin. Jedna rezerwacja.`;
- treść: `Avably pilnuje dostępności sprzętu także wtedy, gdy dwóch pracowników
  lub dwóch klientów klika w tej samej chwili.`;
- CTA: `Zapisz się na listę oczekujących`.

Drugi post ma proporcję `4:5` i podpis `1080 × 1350 px`. Pokazuje połączenie
sklepu i panelu:

- nagłówek: `Klient rezerwuje online. Zamówienie od razu trafia do panelu.`;
- treść: `Każda wypożyczalnia dostaje własny adres sklepu i edytor strony.
  Klient wybiera sprzęt i termin, a obie strony dostają potwierdzenie e-mailem.`;
- CTA: `Zapisz się na listę oczekujących`.

Social media nie korzystają ze zdjęć stockowych ani ilustracji 3D. Charakter
budują logo, typografia, kontrolowana limonka, kropka jako sygnał oraz fragmenty
realnego interfejsu. Dzięki temu plansza testuje właściwy system marki, a nie
atrakcyjność przypadkowej fotografii.

### 4.2. Motion system — „sygnał operacyjny”

Ruch jest częścią brandingu, ale nie może spowalniać pracy ani stale domagać
się uwagi. Jego wspólną metaforą jest kropka z logo: sygnał, który pojawia się,
prowadzi wzrok do zmiany i wraca do spoczynku. Ruch nie kopiuje efektów innej
marki; wykorzystuje podobną zasadę płynnej, warstwowej narracji, lecz opiera ją
na danych wypożyczalni i geometrii Avably.

Rozważono trzy poziomy intensywności. Same mikrointerakcje UI byłyby zbyt
mało widoczne w brandingu marketingowym. Ciągłe orbity, duże wstęgi tekstu i
parallax dałyby mocniejszy efekt, lecz byłyby zbyt ekspresyjne dla narzędzia
operacyjnego. Wybrany wariant pośredni łączy krótkie mikrointerakcje, jeden
spokojny ruch ambientowy na LP i czytelną pętlę demonstracyjną w reklamie.

Globalne wartości demonstracyjne:

| Rola | Wartość |
|---|---|
| Fast interaction | `160ms` |
| UI state | `240ms` |
| Reveal | `720ms` |
| Logo signal | `6000ms` |
| Ad sequence | `8000ms` |
| Ambient rail | `16000ms` |
| Ease out | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Ease standard | `cubic-bezier(0.2, 0.7, 0.2, 1)` |

#### Logotyp

- Przy pierwszym pojawieniu kapsuła i litery odsłaniają się przez `opacity`
  oraz przesunięcie nie większe niż `8 px` w `720ms`.
- Kropka pokonuje krótką drogę `12 px` do swojej pozycji i skaluje się z
  `0.84` do `1`. Po wejściu pozostaje nieruchoma przez co najmniej `88%`
  sześciosekundowego cyklu; pojedynczy oddech nie przekracza skali `1.08`.
- Krzywe liter, kerning, kapsuła i proporcje znaku nie morfują, nie obracają
  się i nie sprężynują.

#### Interfejs

- Hover, focus i active korzystają z `160–240ms`; zmieniają kolor, opacity
  oraz pozycję znacznika maksymalnie o `4 px`.
- Wiersz zamówienia nie pływa. Limonkowy znacznik skaluje się na osi pionowej,
  a zmieniony status dostaje jedno wejście `720ms`, po czym pozostaje statyczny.
- Focus zachowuje podwójny, dostępny obrys. Animacja nie jest jedynym nośnikiem
  informacji o stanie.

#### Landing page

- Nagłówek oraz fragment panelu odsłaniają się maską i przesunięciem do `8 px`.
- Jedynym ciągłym ruchem jest cienka „szyna operacyjna” z identyfikatorem,
  terminem i statusem zamówienia. Przesuwa się liniowo w `16000ms`, bez efektu
  parallax i zatrzymuje na hover lub focus-within.
- Kropka logo może przejąć rolę wskaźnika na szynie, ale nie opuszcza kapsuły
  w stałym nagłówku nawigacji.

#### Animowane reklamy social

Oba formaty są ośmiosekundową pętlą demonstracyjną z długim momentem spoczynku:

1. `0–12%`: logo i kropka wchodzą;
2. `12–34%`: odsłania się nagłówek;
3. `34–54%`: pojawia się fragment produktu lub połączenie sklep → panel;
4. `54–72%`: limonka podkreśla status oraz CTA;
5. `72–92%`: pełna kompozycja pozostaje nieruchoma i czytelna;
6. `92–100%`: szybkie, łagodne wygaszenie do kolejnego cyklu.

Post `1:1` akcentuje blokadę podwójnej rezerwacji przez jeden znacznik, który
zatrzymuje się przy właściwym egzemplarzu. Post `4:5` pokazuje przejście
zamówienia ze sklepu do panelu poprzez ruch kropki po prostej linii. Animacje
działają wyłącznie przez `transform`, `opacity` i zmianę płaskiego koloru;
nie używają blur, deformacji ani gwałtownego skalowania.

#### Różnica między kierunkami

- Sygnał operacyjny prowadzi kropkę po prostych osiach i używa precyzyjnego
  reveal znacznika.
- Papier roboczy odsłania treść jak przesuwaną linię dokumentu i ogranicza ruch
  do krótkiego uniesienia `6 px`.
- Czarna rama przesuwa limonkowy wskaźnik po nawigacji, po czym otwiera jasne
  pole pracy; ciemna rama sama pozostaje nieruchoma.

#### Dostępność ruchu

- `@media (prefers-reduced-motion: reduce)` usuwa wszystkie pętle i przejścia,
  pokazując od razu końcową, kompletną kompozycję.
- Hover oraz `focus-within` zatrzymują pętle reklam i szynę danych.
- Ruch nie zmienia układu, nie przewija strony, nie przechwytuje scrolla i nie
  ukrywa treści potrzebnej do wykonania działania.

## 5. Korekta logo w fazie 1

Koncepcja znaku, proporcja płótna i kształt kapsuły pozostają bez zmian.
Wariant „po” wprowadza tylko:

- zmianę liter z `#122035` na `#0B1017`;
- przesunięcie całej grupy kropka + logotyp o `2 px` w lewo, aby wyrównać
  optycznie marginesy wewnątrz kapsuły: źródłowe skrajne punkty grupy dają
  `45 px` z lewej i `40.8 px` z prawej, a korekta z większą kropką daje
  odpowiednio `42.5 px` i `42.8 px`;
- zwiększenie promienia kropki z `14.5 px` do `15 px` i przesunięcie jej
  środka o `0.5 px` w górę;
- zachowanie istniejących krzywych liter i kerningu; faza 1 nie zmienia
  konturów logotypu.

Uzasadnienie prezentowane pod porównaniem: „Nieco cięższa i wyżej ustawiona
kropka oraz prawie czarny logotyp równoważą długi wyraz bez zmiany koncepcji
znaku.” Oryginał i korekta muszą wystąpić w tym samym rozmiarze.

## 6. Typografia i egzekwowalna granica

- `Safiro Medium 500`: wyłącznie nazwy stron i nagłówki głosu Avably w panelu,
  na LP lub w materiałach social media.
- `Manrope 400/600/700`: podpisany zamiennik brakujących wag tylko w próbniku
  fazy 1.
- `Geist Sans 400/500/600`: cała treść narzędzia, nawigacja, formularze,
  etykiety, tabele i opisy.
- `Geist Mono 400/500`: identyfikatory, kwoty, daty, liczby i kody.
- Storefront klienta nie jest częścią artefaktu fazy 1. W fazie 2 pozostaje
  całkowicie bez Safiro i korzysta z fontów otwartej licencji.

Reguła code review dla dalszej implementacji: import lub `@font-face` Safiro
może istnieć wyłącznie w aplikacji panelu i marketingu; `packages/ui` oraz
tenantowy storefront nie mogą zawierać pliku, nazwy rodziny ani zmiennej
odwołującej się do Safiro.

## 7. Palety i kontrast

Każdy wariant zachowuje trzy wartości marki: `#EAFFA4`, `#A8C743` i
`#0B1017`. Różnica między wariantami wynika z roli koloru i konstrukcji
powierzchni, nie z podmiany limonki na podobny odcień.

### Sygnał operacyjny

| Rola | HEX |
|---|---|
| Canvas | `#F4F6F5` |
| Surface | `#FFFFFF` |
| Ink | `#0B1017` |
| Muted text | `#55616D` |
| Essential border | `#7E8994` |
| Brand lime | `#EAFFA4` |
| Logo dot | `#A8C743` |

### Papier roboczy

| Rola | HEX |
|---|---|
| Canvas | `#FAF8F0` |
| Surface | `#FFFFFF` |
| Ink | `#0B1017` |
| Muted text | `#625E54` |
| Essential border | `#858078` |
| Brand lime | `#EAFFA4` |
| Logo dot | `#A8C743` |

### Czarna rama

| Rola | HEX |
|---|---|
| Shell | `#0B1017` |
| Shell secondary | `#171D25` |
| Canvas | `#F4F5F2` |
| Surface | `#FFFFFF` |
| Ink | `#0B1017` |
| Shell text | `#F7F8F5` |
| Shell muted text | `#B7C0C8` |
| Essential border | `#828C96` |
| Brand lime | `#EAFFA4` |
| Logo dot | `#A8C743` |

Minimalne kontrasty dla używanych ról są już rozstrzygnięte:

| Para | Kontrast |
|---|---:|
| `#0B1017` / `#F4F6F5` | `17.58:1` |
| `#55616D` / `#FFFFFF` | `6.33:1` |
| `#55616D` / `#F4F6F5` | `5.83:1` |
| `#7E8994` / `#FFFFFF` | `3.56:1` |
| `#7E8994` / `#F4F6F5` | `3.28:1` |
| `#0B1017` / `#FAF8F0` | `17.94:1` |
| `#625E54` / `#FFFFFF` | `6.46:1` |
| `#625E54` / `#FAF8F0` | `6.08:1` |
| `#858078` / `#FFFFFF` | `3.92:1` |
| `#858078` / `#FAF8F0` | `3.69:1` |
| `#F7F8F5` / `#0B1017` | `17.90:1` |
| `#F7F8F5` / `#171D25` | `15.90:1` |
| `#B7C0C8` / `#0B1017` | `10.35:1` |
| `#B7C0C8` / `#171D25` | `9.19:1` |
| `#828C96` / `#FFFFFF` | `3.42:1` |
| `#828C96` / `#F4F5F2` | `3.12:1` |
| `#0B1017` / `#EAFFA4` | `17.57:1` |
| `#0B1017` / `#A8C743` | `9.92:1` |

Limonka sama nie może być jedynym obrysem focusu na jasnym tle: jej kontrast
z bielą wynosi tylko `1.09:1`. Jasne warianty używają więc podwójnego focusu,
w którym ciągła linia `#0B1017` zapewnia wymaganą granicę, a limonka jest
drugim, rozpoznawalnym sygnałem. Na ciemnej ramie limonka osiąga `17.57:1`.

Każda para przewidziana do użycia zostanie policzona algorytmem WCAG 2.x na
podstawie względnej luminancji sRGB. Para niespełniająca `4.5:1` dla zwykłego
tekstu albo `3:1` dla dużego tekstu, focusu, obrysu i innych elementów UI nie
trafi do artefaktu. Limonka nie jest używana jako kolor drobnego tekstu na
jasnym tle.

## 8. „Czego tu nie ma i dlaczego”

Sekcja odrzuca wprost:

- gradienty — utrudniają utrzymanie jednej wartości kontrastu;
- glassmorphism i półprzezroczyste powierzchnie — osłabiają hierarchię danych;
- cienie na zwykłych kartach i wierszach — interfejs rozdzielają obrysy oraz
  odstępy; cień zostaje wyłącznie poza zakresem fazy 1 dla nakładek;
- ilustracje 3D i dekoracyjne maskotki — nie pomagają wykonać operacji;
- zdjęcia stockowe — utrudniałyby ocenę samego systemu marki i wprowadzały
  niepotwierdzony kontekst klienta;
- scroll hijacking, parallax, sprężynujące elementy i bezustanny ruch wielu
  warstw — obniżają kontrolę oraz czytelność narzędzia operacyjnego;
- duże limonkowe tła — kolor ma sygnalizować, nie pokrywać ekran;
- nadmierne kapsuły w UI — kapsuła należy do logo, nie staje się domyślnym
  kształtem każdej kontrolki;
- Safiro w storefroncie klienta — narusza granicę licencyjną i miesza głos
  platformy z głosem wypożyczalni.

## 9. Technika wykonania

- Jeden dokument HTML z całym CSS w elemencie `<style>`.
- Logo jako inline SVG; żadnych odwołań do plików SVG lub PNG.
- Safiro, Manrope, Geist Sans i Geist Mono jako WOFF2 osadzone przez base64 w
  `@font-face`; zero żądań sieciowych po otwarciu pliku.
- Brak bibliotek, frameworków, skryptów analitycznych i JavaScriptu. Motion
  powstaje wyłącznie w CSS przez `@keyframes`, transition i media query.
- Semantyczne elementy HTML, `lang="pl"`, poprawna kolejność nagłówków,
  tekstowe etykiety próbek kolorów i tabele z nagłówkami.
- Istniejący `docs/dokumentacja/hub.html` otrzymuje wyłącznie odnośnik do
  moodboardu zgodnie z zasadami repo; nie jest drugim artefaktem wizualnym.
- Układ trzech kolumn na ekranie co najmniej `1180 px`: trzy kolumny po
  `360 px`, dwie przerwy po `20 px` i boczne marginesy po `30 px`. Poniżej tej
  szerokości warianty układają się pionowo bez poziomego przewijania strony.
- Plansze „Branding w użyciu” wykorzystują osobny breakpoint `980 px`, aby
  makieta LP oraz oba posty zachowały czytelną hierarchię i prawidłowe
  proporcje bez sztucznego pomniejszania tekstu.

## 10. Weryfikacja

Przed oddaniem artefaktu należy:

1. Sprawdzić, że plik otwiera się bez serwera i nie wykonuje żądań sieciowych.
2. Potwierdzić przez `document.fonts.check`, że wszystkie osadzone odmiany są
   dostępne i że żadna waga nie jest syntetyzowana.
3. Policzyć i wypisać kontrasty każdej rzeczywiście użytej pary.
4. Zweryfikować wizualnie szeroki ekran z trzema kolumnami oraz widok mobilny.
5. Porównać logo przed i po w rozmiarze natywnym oraz pomniejszonym, bez
   oceniania jeszcze favikony 16 px, która należy do fazy 2.
6. Sprawdzić, że każdy wariant zawiera tę samą treść, komplet wymaganych pól,
   tę samą makietę LP i oba formaty social media.
7. Zweryfikować proporcje `16:10`, `1:1` i `4:5` oraz czytelność zastosowań przy
   szerokościach `1440 px`, `1024 px` i `390 px`.
8. Sprawdzić wszystkie trzy warstwy motion: mikrointerakcję UI, szynę LP oraz
   pełną ośmiosekundową pętlę obu reklam.
9. Włączyć `prefers-reduced-motion: reduce` i potwierdzić, że treść pozostaje
   kompletna, a pętle, transition i automatyczny ruch są wyłączone.
10. Sprawdzić, że copy marketingowe opisuje wyłącznie działające funkcje i nie
   zawiera fikcyjnych klientów, wyników, opinii, nagród ani płatności online.
11. Sprawdzić, że w dokumencie nie ma gradientów, zewnętrznych URL-i zasobów,
   nazw innych produktów ani niepotwierdzonych twierdzeń o Avably.

## 11. Poza zakresem

Faza 1 nie zmienia `packages/ui`, aplikacji panelu, storefrontu, tokenów ani
produkcyjnych plików logo. Makiety LP i social media są przekrojowym podglądem
pełnego brandingu, a nie gotową kampanią, eksportami produkcyjnymi ani strategią
publikacji. Motion pokazuje zachowanie i timing, ale nie jest jeszcze biblioteką
produkcyjnych komponentów. Faza 1 nie definiuje kompletnego dark mode, wykresów,
stanów komponentów ani skali typograficznej. Te elementy wchodzą dopiero do
fazy 2 po wskazaniu jednego z trzech kierunków.

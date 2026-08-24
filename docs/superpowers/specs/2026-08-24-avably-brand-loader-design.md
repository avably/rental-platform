# Avably Brand Loader — projekt wdrożenia

**Data:** 2026-08-24

**Status:** kierunek wizualny zatwierdzony w rozmowie; specyfikacja przed implementacją

**Gałąź:** `codex/avably-motion-loader`, oparta na `origin/main` po scaleniu brandingu #383

## Cel

Wprowadzić do panelu rozpoznawalny loader Avably, który komunikuje rzeczywiste oczekiwanie, a nie dekoruje stany bez danych. Loader ma działać w dwóch skalach:

- pełne logo dla blokującego ładowania tras i dużych regionów;
- kompaktowy atom 24–28 px dla wybranych, dłuższych operacji lokalnych.

Praca kończy się na osobnej gałęzi. Bez merge'a, pushu, PR-a i deployu w zakresie tej sesji.

W rozmowie określenie „empty state” dotyczyło miejsc, które podczas pobierania danych wyglądają jak pusta przestrzeń. W kodzie rozdzielamy je precyzyjnie: rzeczywiste `loading` dostaje loader, natomiast właściwy empty state po zakończonym pobieraniu pozostaje statycznym komunikatem „brak danych”.

## Ustalenia z researchu

1. Ruch ma wynikać z geometrii znaku. Koło jest pierwszą klatką kapsuły, a nie osobnym efektem nałożonym na logo.
2. Element wchodzący wyhamowuje. Ruch wewnątrz kadru używa krzywej standardowej i zachowuje ciągłość przestrzenną.
3. Loader pojawia się dopiero po progu antymigotania 200 ms. Krótkie odpowiedzi nie powinny błyskać znakiem.
4. Animacja nie może blokować zakończenia żądania. Jeśli dane przyjdą wcześniej, UI przechodzi do treści bez czekania na pełną sekwencję.
5. `prefers-reduced-motion: reduce` pokazuje natychmiast statyczny stan końcowy i wyłącza pętlę.
6. Prawdziwy empty state oznacza brak danych. Nie wolno umieszczać w nim nieskończonego loadera, bo sugerowałby, że dane nadal nadchodzą.

Źródła kierunku: Material Motion — duration/easing, Apple HIG — loading, MDN — `prefers-reduced-motion`, LogoLounge 2025 — motion jako zachowanie marki.

## Zatwierdzony flow

### Pełny loader

1. Na środku rośnie idealne jasne koło `#EAFFA4`.
2. W środku pojawia się kropka `#A8C743` i wykonuje dwa miękkie sygnały.
3. Koło rozszerza wyłącznie szerokość przy stałej wysokości. Promień końców pozostaje równy połowie wysokości, więc forma płynnie staje się kapsułą — bez skalowania osi X gotowego prostokąta i bez deformacji narożników.
4. W tym samym ruchu kropka przesuwa się ze środka na zatwierdzoną pozycję po lewej.
5. Litery `a–v–a–b–l–y` pojawiają się krótką falą od lewej do prawej. Używają wyłącznie oryginalnych wypełnionych krzywych — bez obrysu, stroke draw i optycznego pogrubienia.
6. Logo pozostaje w stanie końcowym. Co 3,6 s kropka wykonuje subtelny podwójny oddech; kapsuła i wordmark nie wracają do początku.

Sekwencja wejścia trwa około 2,2 s po progu 200 ms. Ambient loop zaczyna się dopiero po jej zakończeniu.

### Loader kompaktowy

Mały wariant zachowuje pierwsze dwa etapy: jasne koło rośnie, kropka pojawia się i daje dwa sygnały. Nie próbuje wciskać wordmarku w 24 px. Po wejściu pozostaje atomem koło+kropka i używa tej samej pętli co 3,6 s.

## Architektura

### `BrandWordmark`

Krzywe Safiro zostaną wydzielone z `BrandLogo` do współdzielonego, wewnętrznego komponentu `BrandWordmark`. Statyczne logo i loader renderują dokładnie te same sześć ścieżek. Nie powstaje druga kopia geometrii wordmarku.

Loader jest kontekstowym komponentem interfejsu, a nie nową wersją znaku. Pliki SVG/PNG, favicony oraz statyczne użycia `BrandLogo` i `BrandSymbol` pozostają nieruchome i bez zmian.

### `BrandLoader`

Nowy panelowy komponent w `apps/panel/components/shell/brand-loader.tsx`:

- `variant="full" | "compact"`;
- obowiązkowy `label` dla czytnika;
- opcjonalnie widoczna etykieta w pełnym wariancie;
- `role="status"`, jeden komunikat, brak podwójnego live regionu;
- grafika pod `aria-hidden="true"`;
- markery `data-brand-loader`, `data-brand-loader-variant`, `data-brand-loader-*` do testów i QA.

Ruch żyje w `apps/panel/app/globals.css`, na istniejących tokenach `--motion-*` i nazwanych easingach. Komponent nie potrzebuje klientowego JavaScriptu ani biblioteki animacji.

Ambient loop jest wąskim wyjątkiem tylko dla kropki wewnątrz `BrandLoader`. Nie zmienia kontraktu `LoadingRail` ani globalnej zasady, że skeletony, szyny i pozostałe przejścia nie mogą zapętlać animacji w nieskończoność.

### Integracja z ekranami ładowania

1. `SkeletonScreen` zachowuje niewidoczną rezerwę geometrii, więc wejście danych nadal nie powoduje CLS.
2. Widoczna `LoadingRail` i dolny tekst zostają zastąpione centralnym pełnym `BrandLoader` z tym samym komunikatem i18n.
3. Cztery istniejące granice `loading.tsx` — zamówienia lista/szczegół i klienci lista/szczegół — dostają loader automatycznie przez `SkeletonScreen`.
4. Powstaje ogólna granica `apps/panel/app/[locale]/(panel)/loading.tsx` dla tras bez dedykowanego skeletonu. Dedykowane, bliższe granice nadal wygrywają i zachowują rezerwę geometrii.

### Pierwsze użycie kompaktowe

Kompaktowy wariant wejdzie do `BillingPortalButton`, ponieważ generowanie sesji dostawcy i przejście na zewnętrzny portal jest operacją blokującą, która może trwać zauważalnie długo. Przycisk nadal ma `disabled` i `aria-busy`; loader stoi przy widocznym komunikacie przekierowania.

Nie zastępujemy nim wszystkich wielokropków w przyciskach. Krótkie zapisy formularzy pozostają przy istniejącym `Button loading`, aby marka nie pulsowała przy każdej drobnej mutacji.

## Audyt miejsc użycia

### Wdrożyć teraz

- wszystkie route-level loading states panelu przez dedykowane skeletony i ogólną granicę segmentu;
- oczekiwanie na portal rozliczeniowy — wariant kompaktowy;
- galeria design systemu jako dokumentacja obu wariantów i reduced motion.

### Kandydaci po obserwacji produkcyjnej

- przekierowanie checkoutu do operatora płatności w storefront;
- polling wyniku płatności, gdy nie ma mierzalnego procentu;
- długie przygotowanie eksportu lub dokumentu, jeśli operacja nie ma własnego postępu.

### Nie używać

- prawdziwe empty states zamówień, klientów i katalogu;
- brak wyników filtrowania;
- autosave kreatora i krótkie akcje przycisków;
- uploady oraz eksporty z mierzalnym postępem — tam właściwy jest determinate progress;
- favicon, statyczne logo w nawigacji i stały sygnet.

## Dostępność i zachowanie

- jeden `role="status"` na instancję;
- etykiety wyłącznie z i18n;
- `prefers-reduced-motion: reduce` wyłącza intro i ambient loop, pokazując pełne statyczne logo lub kompaktowy atom;
- brak migania do zera: dwa sygnały schodzą jedynie do około 74% skali i 74% opacity;
- pętla nie zmienia geometrii kontenera ani położenia wordmarku;
- loader nie przechwytuje fokusu i nie blokuje anulowania/nawigacji poza istniejącą semantyką operacji.

## Testy i QA

1. Test kontraktu geometrii: początek jest kołem 1:1, stan końcowy ma zatwierdzone 348:93, kropkę i sześć oryginalnych ścieżek.
2. Test flow CSS: wejście ma jedną iterację i `both`; tylko ambient kropki ma `infinite`; istnieje próg 200 ms.
3. Test reduced motion: brak animacji, statyczny stan końcowy widoczny.
4. Test `SkeletonScreen`: jedna rola status, loader poza niewidoczną rezerwą, brak starej szyny.
5. Test ogólnej granicy panelu i pierwszego użycia compact.
6. Aktualizacja galerii/kontraktu design systemu.
7. QA przeglądarkowe desktop 1440 px i mobile 375 px, w zwykłym oraz reduced motion.
8. Pełne: testy panelu, typecheck, lint i build. Integracje DB mogą być pominięte wyłącznie jawnie zgodnie z kontraktem repo.

## Poza zakresem

- merge, push, PR, deploy i czyszczenie cache;
- animowane pliki GIF/MP4/Lottie;
- zmiana statycznego logo, faviconów lub kolorów;
- automatyczne opóźnianie gotowej treści po to, by animacja zdążyła się zakończyć;
- globalna wymiana wszystkich stanów `pending` na brand loader.

# Synchronizacja znaków Avably — specyfikacja

**Data:** 2026-08-24  
**Status:** kierunek zatwierdzony w rozmowie; specyfikacja do przeglądu użytkownika  
**Zakres:** platformowy branding Avably w LP, panelu, ikonach przeglądarki, generatorze marketingowym, dokumentacji marki i paczce handoff  
**Poza zakresem:** Starkit, znaki wgrywane przez tenantów, branding sklepów klientów, ich e-maile i PDF-y, redesign interfejsu, wdrożenie i merge

## 1. Cel

Cały produkt Avably ma korzystać z jednego zatwierdzonego zestawu znaków:

- pełnego logo w limonkowej kapsule na LP, ekranach logowania i w rozwiniętej nawigacji panelu;
- samodzielnego sygnetu w postaci jednej wyśrodkowanej zielonej kropki na ciemnym, zaokrąglonym polu;
- favicon i ikon aplikacji wyprowadzonych z tego samego sygnetu, bez litery `A`.

Zmiana usuwa trzy obecne rozjazdy: przezroczyste wordmarki na LP, sygnet `kropka + A` w panelu i stary trójkątny `favicon.ico`. Obejmuje także źródła generujące pliki marketingowe, aby kolejny build nie przywrócił starych znaków.

## 2. Kanoniczna geometria

### 2.1. Pełne logo

- `viewBox="0 0 348 93"`;
- kapsuła: `348 × 93`, `rx="44"`, kolor `#EAFFA4`;
- kropka: `cx="57.5"`, `cy="46"`, `r="15"`, kolor `#A8C743`;
- wordmark: sześć zatwierdzonych obrysów liter, kolor `#0B1017`, grupa `translate(-2 0)`;
- cztery warianty pełnego logo w handoffie są bajtowo identyczne. Czytelność na jasnym i ciemnym tle zapewnia kapsuła, a nie alternatywny kolor liter;
- wordmark pozostaje zamieniony na krzywe. Repozytorium i paczka nie zawierają pliku fontu Safiro.

Źródłem prawdy dla ścieżek liter jest istniejący `BrandLogo` w `apps/panel/components/shell/brand-mark.tsx`; jego geometria pełnego logo jest już zgodna z zatwierdzonym znakiem i nie będzie przerysowywana.

### 2.2. Sygnet i favicon

- `viewBox="0 0 96 96"`;
- ciemne pole: `96 × 96`, `rx="25"`, kolor `#0B1017`;
- kropka: `cx="48"`, `cy="48"`, `r="25"`, kolor `#A8C743`;
- żadnej litery, ścieżki ani dodatkowego punktu;
- mniejsze formaty zachowują tę samą proporcję: ciemne pole i jedna optycznie wyśrodkowana kropka.

SVG faviconu korzysta z równoważnej geometrii w `viewBox="0 0 32 32"`: pole `rx="7"`, kropka `cx="16"`, `cy="16"`, `r="8"`.

## 3. Powierzchnie produktu

### 3.1. Panel (`apps/panel`)

`BrandLogo` pozostaje wspólnym komponentem pełnego logo na ekranach autoryzacji, w nawigacji mobilnej i rozwiniętym sidebarze. `BrandSymbol` zostaje uproszczony do zatwierdzonego ciemnego pola z jedną kropką. Dotyczy to zwiniętego sidebara i belki superadmina bez zmiany rozmiarów ani układu tych elementów.

Stary `apps/panel/app/favicon.ico` zostaje zastąpiony wielorozmiarowym ICO z kropką. Next otrzyma również konwencjonalne pliki `app/icon.png` (`512 × 512`) i `app/apple-icon.png` (`180 × 180`), z przezroczystym marginesem bezpieczeństwa wokół pola. Nie powstaje manifest PWA, ponieważ aplikacja go obecnie nie używa.

### 3.2. Landing page i marketing (`apps/storefront`)

Stabilne adresy pozostają bez zmian:

- `/forerunner/images/avably-logo-dark.svg`;
- `/forerunner/images/avably-logo-light.svg`;
- `/forerunner/images/avably-favicon.svg`.

Oba pliki `avably-logo-*` dostaną identyczne pełne logo z kapsułą. Dzięki temu nagłówek desktopowy, menu mobilne, stopka, podstrony marketingowe i widget osadzany zostaną podmienione bez modyfikowania ich HTML i bez ryzyka zerwania istniejących odwołań.

Skrypt `apps/storefront/scripts/build-marketing-html.mjs` będzie generował dokładnie te kanoniczne zasoby. Jest to część krytyczna zmiany: obecnie skrypt odtwarza stare przezroczyste wordmarki oraz favicon `kropka + A`, więc samo ręczne nadpisanie plików nie byłoby trwałe.

Storefront otrzyma ten sam zestaw ikon co panel: nowe `app/favicon.ico`, `app/icon.png` i `app/apple-icon.png`. Jawny odnośnik do faviconu SVG w layoutcie pozostaje, a ICO działa jako kompatybilny fallback.

## 4. Paczka logo i dokumentacja marki

Repozytorium dostanie samodzielny handoff pod `docs/branding/avably-logo-kit/`, niezależny od plików runtime. Paczka zawiera:

- pełne logo SVG w wariantach nazwanych dla jasnego i ciemnego użycia;
- sygnet i favicon SVG;
- odpowiadające PNG dla typowych szerokości logo oraz ikon `16`, `24`, `32`, `48`, `180`, `192` i `512` px;
- podgląd zestawu, krótkie README i gotowy ZIP.

Warianty nazwane `dark` i `light` pełnego logo zachowują tę samą geometrię oraz kolory, bo kapsuła jest samowystarczalnym tłem. Pliki aplikacji nie importują niczego z `docs/`; handoff służy ludziom, a zasoby runtime mają własne stabilne lokalizacje.

Artefakt `docs/branding/2026-07-20-avably-faza-2-system.html` zostanie zaktualizowany wyłącznie w miejscach opisujących lub pokazujących sygnet i favikony. Historyczny kontekst fazy 2 pozostaje, ale nie może przedstawiać wycofanej litery `A` jako bieżącego standardu. `scripts/verify-branding-phase2.mjs` zacznie weryfikować nowy znak.

Żywa dokumentacja `docs/dokumentacja/index.html` otrzyma wpis na górze dziennika budowy. Nie powstaje nowy ADR: jest to synchronizacja zatwierdzonego brandingu na istniejących powierzchniach, bez decyzji architektonicznej.

## 5. Kontrakty i testy

Implementacja przebiega test-first. Najpierw czerwone testy przypną nowy kontrakt, potem zmienią się zasoby i komponenty.

1. Test panelowego shella sprawdzi dokładny `viewBox`, kolory, promień pola, pozycję i promień kropki oraz brak jakiejkolwiek ścieżki w `BrandSymbol`.
2. Test zasobów marketingowych sprawdzi identyczność obu pełnych SVG, obecność kapsuły i brak litery/ścieżki w faviconie.
3. Test generatora uruchomi build zasobów i potwierdzi, że wynik zachowuje kanoniczną geometrię zamiast odtwarzać stare znaki.
4. Test ikon rastrowych sprawdzi typ, wymiary i obecność wymaganych rozmiarów ICO; nie będzie opierał się wyłącznie na nazwie pliku.
5. Weryfikator artefaktu marki przypnie nowy sygnet i usunięcie starego wariantu `kropka + A`.
6. Istniejące testy widgetu i szablonu marketingowego nadal potwierdzą stabilne adresy zasobów.

Pełna walidacja obejmie testy istotnych pakietów, typecheck, lint i build obu aplikacji. Testy bazowe przed zmianą przeszły w `8/9` zadań monorepo: panel miał jeden timeout w teście chronionej trasy przy `3199` zaliczonych testach; ten sam przypadek uruchomiony osobno przeszedł (`2` testy, `106` pominiętych). Integracje wymagające lokalnej bazy były pominięte udokumentowaną flagą `ALLOW_INTEGRATION_SKIP=1`.

## 6. Weryfikacja wizualna

Po zmianie trzeba sprawdzić lokalnie:

- LP PL i EN: nagłówek desktopowy, menu mobilne, stopkę i podstrony marketingowe;
- widget osadzany na jasnym i ciemnym tle;
- panel PL i EN: logowanie, rozwinięty i zwinięty sidebar, nawigację mobilną oraz belkę superadmina;
- favicon w kartach `www` i `app`, ikonę Apple oraz zachowanie na jasnym i ciemnym motywie przeglądarki;
- czytelność pełnego logo przy minimalnej szerokości `120 px` i sygnetu przy `24 px`.

Do podsumowania dla PM trafi lista zmienionych powierzchni, wyniki walidacji i ewentualne uwagi cache/deploy. Merge i wdrożenie pozostają po stronie PM.

## 7. Granice bezpieczeństwa zakresu

- Nie zmieniamy repozytorium Starkit ani nie przenosimy do niego kolejnych plików.
- Nie dotykamy logotypów wgrywanych przez tenantów, brandingu ich storefrontów ani logo w tenantowych e-mailach i PDF-ach.
- Nie zmieniamy treści LP, układu panelu, tokenów UI ani fontów.
- Nie usuwamy stabilnych publicznych ścieżek zasobów.
- Nie mergujemy gałęzi i nie uruchamiamy wdrożenia. Praca pozostaje na osobnej gałęzi do przeglądu PM.

## 8. Kryteria odbioru

Zmiana jest gotowa do przekazania PM, gdy:

1. wszystkie platformowe wystąpienia starego `kropka + A`, przezroczystego wordmarku LP i trójkątnego faviconu są zastąpione;
2. pełne logo i sygnet mają dokładnie zatwierdzoną geometrię;
3. ponowny build marketingu nie cofa zasobów;
4. panel i storefront korzystają z tych samych ikon przeglądarki;
5. paczka SVG/PNG/ZIP znajduje się w repozytorium Avably i ma czytelny podgląd;
6. dokument marki, testy i dziennik budowy opisują stan faktyczny;
7. walidacja automatyczna i przegląd wizualny nie wykazują regresji;
8. gałąź pozostaje niepołączona z `main`.

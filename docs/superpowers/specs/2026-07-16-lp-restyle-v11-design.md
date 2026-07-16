# Avably LP waitlisty v1.1 — projekt restylingu i FAQ

Data: 2026-07-16

Gałąź: `feat/lp-restyle-v11`

Zakres: `apps/storefront/**` oraz `docs/**`

## Cel

Nadać istniejącej, zmergowanej LP waitlisty bardziej editorialny charakter bez zmiany jej twierdzeń, formularza, kontraktu `joinWaitlist`, zasad uczciwości ani bramek prawnych. Jedynym nowym elementem treści jest natywne FAQ w języku polskim i angielskim.

## Granice zakresu

- Nie zmieniamy `apps/storefront/lib/waitlist/**`, `apps/storefront/lib/actions/waitlist.ts` ani `packages/**`.
- Nie zmieniamy istniejącego copy, z wyjątkiem dodania FAQ. Teza z `problem.intro` może zmienić położenie, ale nie brzmienie.
- Formularz pozostaje domyślnie wyłączony. Bez `WAITLIST_ENABLED=true` żadne zgłoszenie nie może zostać przyjęte.
- `WAITLIST_ENABLED=true` może zostać ustawione dopiero po opublikowaniu działającej Polityki prywatności.
- Sekcja twórcy pozostaje tekstowa, bez zdjęcia.
- Stockowe zdjęcia sprzętu pozostają placeholderami oznaczonymi do wymiany przed publicznym startem. `docs/assets-sources.md` pozostaje źródłem ich pochodzenia i statusu.
- Nie dodajemy dowodu społecznego, liczb bez pokrycia, dekoracyjnych gradientów, przejmowania scrolla ani nowych zależności.

## Wybrany kierunek

Kierunek „editorial trust”: duża typografia szeryfowa, spokojne ciepłe neutrale, sekcje czytane jak rozdziały i pojedyncza ciemna sekcja poświęcona historii twórcy. Ciemne tło wzmacnia jedyny realny dowód wiarygodności — doświadczenie właściciela wypożyczalni — bez udawania referencji, zdjęcia lub metryk.

Oferta Founders pozostaje na jasnym, ciepłym tle. Dzięki temu precyzyjny warunek cenowy nie jest stylizowany jak agresywna promocja i zachowuje wysoką czytelność.

## Typografia i punkt podmiany fontu

Szeryf: **Lora**, wagi 400 i 500, subset `latin-ext`, ładowany przez `next/font/google`. Lora ma kompletny zestaw polskich znaków, spokojny editorialny rytm i wystarczającą czytelność przy h1 około 56 px oraz h2 około 36 px. Font zostaje pobrany podczas builda i serwowany lokalnie przez Next.js; przeglądarka nie wykonuje żądań do Google Fonts.

Jedynym punktem definicji fontów będzie `apps/storefront/app/fonts.ts`. Moduł wyeksportuje klasy zmiennych CSS dla sans, mono i serif. `app/[locale]/layout.tsx` jedynie dołączy wyeksportowany zestaw klas do `<html>`.

`apps/storefront/app/globals.css` rozszerzy importowaną warstwę tokenów `@avably/ui` o lokalny token Tailwind `--font-serif: var(--font-serif-source), ...`. Nazwa Lora nie pojawi się w JSX ani w klasach komponentów. Komponenty będą używać wyłącznie `font-serif` oraz wspólnych klas skali typograficznej.

Skala nagłówków, wysokość linii, tracking i wagi będą zdefiniowane centralnie w `globals.css`, między innymi jako klasy `landing-display`, `landing-heading` i `landing-statement`. Przyszła podmiana na font premium wymaga wymiany jednej deklaracji w `app/fonts.ts` lub zastąpienia jej pojedynczym `@font-face` wystawiającym tę samą zmienną. JSX i struktura sekcji pozostaną bez zmian.

Pakiet `@avably/ui` nie zostanie zmieniony, ponieważ `packages/**` jest poza pasem tej pracy. Storefront rozszerza jego tokeny lokalnie po `@import "@avably/ui/styles.css"`.

## Paleta i rytm sekcji

Paleta będzie zdefiniowana jako semantyczne tokeny OKLCH w `globals.css`, bez wartości hex w komponentach:

- `landing-paper`: baza oparta na `background`,
- `landing-warm`: ciepły złamany neutral odpowiadający w jasnym motywie około `#F6F6F4`,
- `landing-ink`: ciemny neutral odpowiadający około `#21201E`,
- osobne wartości dark mode utrzymujące hierarchię i kontrast.

Planowany rytm:

1. header — papier,
2. hero — ciemny kalendarz z nakładką,
3. oświadczenie — biały papier,
4. problem i zdjęcia — ciepły neutral,
5. funkcje — naprzemiennie papier i ciepły neutral,
6. historia twórcy — jedna ciemna sekcja,
7. Founders — ciepły neutral,
8. formularz — papier,
9. FAQ — ciepły neutral,
10. stopka — papier.

## Hero

Hero zastąpi układ dwukolumnowy pełnoszerokościową kompozycją. Istniejący wireframe kalendarza zostanie powiększony i ustawiony jako warstwa tła. Nad nim pojawi się jednolita, półprzezroczysta ciemna nakładka bez gradientu.

Copy hero pozostaje bez zmian i będzie wyśrodkowane. H1 użyje szeryfu, wagi 400 i responsywnego rozmiaru około 52–56 px na desktopie. Hero zachowa dokładnie jedno CTA prowadzące do formularza. CTA i kontrolki pozostaną dostępne klawiaturą.

Etykieta „Koncepcja planowanego interfejsu · Dane poglądowe” / „Planned interface concept · Sample data” pozostanie widoczna ponad nakładką lub w czytelnym panelu na tle kalendarza. Wireframe zachowa `role="img"` i lokalizowany opis dostępności.

## Sekcja-oświadczenie

Istniejący tekst `problem.intro` zostanie przeniesiony do osobnej pełnoszerokościowej sekcji między hero a problemem. Nie zmieniamy ani jednego słowa. Sekcja nie zawiera wizuali, ikon ani liczb. Tekst ma dużą szeryfową skalę, dużo światła i szerokość kontrolowaną dla czytelności.

Sekcja problemu zachowa tytuł, flow, zdjęcia, trzy problemy i zamknięcie. Usunięte zostanie jedynie powtórzenie tezy, ponieważ będzie już bezpośrednio nad nią.

## Funkcje, twórca, Founders i formularz

Cztery istniejące funkcje zachowują kolejność i copy. Układy tekst/wireframe nadal naprzemiennie zmieniają strony na desktopie, ale otrzymują większy rytm pionowy, cieplejsze tła, editorialne nagłówki oraz spokojniejsze obramowania.

Historia twórcy staje się jedyną ciemną sekcją. Pozostaje wariantem bez zdjęcia. Tekst i podpis nie zmieniają się. Kolor tekstu, tekstu drugorzędnego, granic i fokusu zostanie sprawdzony oddzielnie względem ciemnego tła.

Oferta Founders zachowuje pełną semantykę: 50% zniżki na obowiązującą cenę planu przez okres aktywnej subskrypcji, dla pierwszych 20 firm przechodzących z waitlisty na płatny plan. CTA nie oznacza płatności ani uruchomienia subskrypcji.

Wszystkie CTA otrzymają pełny promień pigułki. Główne CTA: ciemne tło i jasny tekst. Elementy drugorzędne: ghost-pigułka. Te same zasady obejmą przycisk formularza i akcję edycji odpowiedzi, bez zmiany ich logiki.

## FAQ

FAQ znajdzie się po formularzu, przed stopką. Komponent `apps/storefront/components/faq-accordion.tsx` będzie klientowym, kontrolowanym akordeonem. Każdy nagłówek pytania będzie natywnym przyciskiem z `aria-expanded`, `aria-controls` i widocznym fokusem. Enter i Spacja zadziałają dzięki semantyce `<button>`. Otwarta może być jedna odpowiedź naraz; ponowne użycie przycisku ją zamknie.

### Copy PL

1. **Czy muszę już mieć stronę internetową?**

   Nie. Jedną z planowanych części Avably jest strona wypożyczalni pod własną domeną. Jeśli masz już stronę, sposób przejścia lub połączenia ustalimy dopiero po poznaniu Twojej obecnej konfiguracji.

2. **Ile trwa uruchomienie?**

   Naszym celem jest skrócenie uruchomienia wynajmu online do jednego dnia, ale nie jest to jeszcze gwarantowany czas wdrożenia. Rzeczywisty czas będzie zależał między innymi od wielkości katalogu, dostępnych danych i konfiguracji wypożyczalni. Produkt jest nadal w budowie i zweryfikujemy ten cel z pierwszymi firmami.

3. **Co jest dostępne dzisiaj?**

   Avably jest na wczesnym etapie budowy. Widoki na tej stronie są koncepcjami planowanego interfejsu i używają danych poglądowych. Zapis na waitlistę lub deklaracja pilotażu nie daje natychmiastowego dostępu do gotowej usługi.

4. **Co dokładnie oznacza 50% zniżki dla Founders i jak długo obowiązuje?**

   Pierwsze 20 firm, które przejdą z waitlisty na płatny plan Founders, otrzyma 50% zniżki na obowiązującą cenę planu przez cały okres aktywnej subskrypcji. Sam zapis na waitlistę nie uruchamia płatności ani nie potwierdza miejsca — potwierdzimy je przed startem płatnej usługi.

5. **Co z moimi danymi i kiedy startują zapisy?**

   Formularz nie przyjmie żadnego realnego zgłoszenia, dopóki nie opublikujemy działającej Polityki prywatności. Do tego czasu pola pozostają widoczne, ale wyłączone. Po uruchomieniu zapisów polityka wyjaśni, jakie dane zbieramy, po co ich używamy i jak można wycofać zgodę.

### Copy EN

1. **Do I need to have a website already?**

   No. A rental website on your own domain is one planned part of Avably. If you already have a website, we will only decide how to connect or replace it after understanding your current setup.

2. **How long will setup take?**

   Our goal is to reduce the time needed to start taking rentals online to one day, but this is not yet a guaranteed setup time. The actual timeline will depend on factors such as catalogue size, available data and the rental business’s configuration. The product is still being built, and we will validate this goal with the first businesses.

3. **What can I use today?**

   Avably is at an early stage of development. The screens on this page are planned interface concepts and use sample data. Joining the waitlist or expressing interest in the pilot does not provide immediate access to a finished service.

4. **What exactly does the 50% Founding discount mean, and how long does it last?**

   The first 20 businesses that move from the waitlist to a paid Founding plan will receive 50% off the current plan price for as long as their subscription remains active. Joining the waitlist does not start a payment or confirm a place; we will confirm places before the paid service launches.

5. **What happens to my data, and when will sign-ups open?**

   The form will not accept any real submission until a working Privacy Policy has been published. Until then, its fields remain visible but disabled. Once sign-ups open, the policy will explain what data we collect, why we use it and how consent can be withdrawn.

## Ruch

Nie dodajemy scroll-jackingu ani klientowego obserwatora tylko dla efektu. Sekcje dostaną subtelny fade/slide przez CSS `animation-timeline: view()` wyłącznie wewnątrz `@supports` i `@media (prefers-reduced-motion: no-preference)`. Brak wsparcia oznacza kompletną stronę bez animacji.

Przy `prefers-reduced-motion: reduce` nie występuje przesunięcie, fade ani opóźnienie. Cała treść jest widoczna od pierwszego renderu. Akordeon nadal zmienia stan natychmiast, bez animacji wysokości.

## Struktura plików

- `apps/storefront/app/fonts.ts` — jedyne źródło konfiguracji fontów i zmiennych CSS.
- `apps/storefront/app/[locale]/layout.tsx` — konsumuje zestaw klas fontów.
- `apps/storefront/app/globals.css` — semantyczne tokeny LP, skala typograficzna, CTA, ruch i dark mode.
- `apps/storefront/components/landing-page.tsx` — nowy układ sekcji, bez zmiany danych ani przepływu formularza.
- `apps/storefront/components/landing-wireframes.tsx` — wariant dużego kalendarza hero i zachowanie pozostałych wizuali.
- `apps/storefront/components/faq-accordion.tsx` — dostępny akordeon FAQ.
- `apps/storefront/components/waitlist-form.tsx` — wyłącznie klasy wizualne CTA i kontrolek; logika bez zmian.
- `apps/storefront/messages/pl.json`, `apps/storefront/messages/en.json` — wyłącznie nowa sekcja FAQ.
- `apps/storefront/test/landing-page.test.tsx` — kontrakt sekcji, fontu, FAQ, bramek i niezmienionego copy.
- `apps/storefront/test/faq-accordion.test.tsx` — zachowanie `aria-expanded`, `aria-controls` i przełączania.
- `docs/dokumentacja/index.html` — wpis w dzienniku i wskazanie `app/fonts.ts` jako punktu podmiany.

## Testy i dowody

Implementacja będzie prowadzona test-first. Testy mają pilnować:

- dokładnie jednego h1,
- zachowania całego istniejącego copy oraz bramki disabled,
- obecności sekcji-oświadczenia bez wizuali,
- pięciu pytań FAQ w obu językach,
- `aria-expanded` i powiązania przycisk–panel,
- użycia wspólnego tokenu serif zamiast nazw fontów w komponentach,
- widocznej etykiety koncepcji hero,
- obecności reguły `prefers-reduced-motion`,
- braku zmian w kontrakcie i akcji waitlisty.

Weryfikacja uruchomieniowa obejmie `/pl` i `/en`, light/dark, mobile/desktop, rozwinięte FAQ oraz emulację reduced motion. Raport otrzyma zrzuty: hero, sekcja-oświadczenie, ciemna historia twórcy, rozwinięte FAQ i dark mode. Axe ma zgłosić zero naruszeń krytycznych; zmierzymy Lighthouse accessibility i performance. Kontrast ciemnej sekcji zostanie sprawdzony osobno.

Pełna bramka końcowa:

```text
ALLOW_INTEGRATION_SKIP=1 pnpm exec turbo run typecheck lint test build --force
```

Następnie gałąź zostanie opublikowana jako jeden PR o tytule `feat: restyling LP v1.1 + FAQ (EN+PL)`.

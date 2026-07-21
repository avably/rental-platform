# Paleta Avably w umowie PDF — projekt

## Cel i granice

Zamknąć dług Z6 przed wysyłką umów przez Z7: przeskórować dwustronicową umowę EN/PL na finalną paletę Avably bez zmiany publicznego API, kształtu `ContractPdfProps`, treści, kolejności sekcji ani determinizmu renderu. Zmiany obejmują wyłącznie `packages/pdf/**` i dokumentację.

## Wygląd

Dokument pozostaje na czystej bieli, bo jest przeznaczony do druku. Tekst główny używa ink `#0B1017`, tekst drugorzędny muted `#55616D`, obrysy `#7E8994`, a lekkie pola canvas `#F4F6F5`.

Nagłówek będzie pełnym ink-barem z białym tytułem i metadanymi. Numer umowy pozostanie w badge'u: limonka `#EAFFA4` z tekstem ink. Ten wariant zachowuje czytelny podział dokumentu w druku kolorowym i monochromatycznym, a limonka zawsze ma wymagany nośnik. `signal-strong` `#5F7500` zastąpi dawny ozdobny kolor w małych etykietach. Kropka `#A8C743` nie zostanie użyta, bo dokument nie osadza zatwierdzonego znaku. Nie powstaną gradienty ani cienie. Typografia i treść pozostają bez zmian.

## Kontrakt kolorów

Nowy test w pakiecie odczyta `docs/branding/2026-07-20-avably-faza-2-system.html`, wyciągnie zestaw sześciocyfrowych hexów z sekcji 01 (`#foundations`) i porówna z każdym hexem znalezionym pod `packages/pdf/src/**`. Dodatkowo wymusi zakaz `#D4A843` oraz `#1e293b` bez względu na wielkość liter. Jawna lista druku dopuści `#FFFFFF` jako czystą biel; czarna `#000000` nie jest potrzebna i nie będzie dopuszczona. Test ma podłogę wymaganych podstawowych kolorów, aby usunięcie wpisu z artefaktu nie skurczyło kontraktu bez sygnału.

## Testy i odbiór

Najpierw powstanie czerwony kontrakt kolorów, potem minimalna podmiana stałych i stylów. Istniejące asercje treści `unpdf` oraz snapshoty EN/PL pozostają bez zmian; snapshoty wolno odświeżyć tylko wtedy, gdy zmiana układu zmieni kolejność ekstrakcji. Po implementacji trzy mutacje udowodnią: zakaz starego akcentu, zakaz obcego hexu i czułość snapshotu na zmianę kwoty przykładowych propsów. Dwa realistyczne PDF-y EN/PL zostaną wyrenderowane do `.claude/zrzuty-pdf-avably/` poza śledzonym zakresem PR-u i obejrzane po rasteryzacji.

## Dokumentacja i ADR

Karta `@avably/pdf` opisze finalną paletę i regułę nośnika. Nowy wpis trafi na samą górę dziennika. ADR-061 nie powstaje: jest to wykonanie zatwierdzonego brandingu, nie nowa decyzja architektoniczna.
